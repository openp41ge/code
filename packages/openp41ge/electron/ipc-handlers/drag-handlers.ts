/**
 * Drag ghost IPC handlers — start, move, end, cross-window forwarding, hit-test.
 *
 * Cross-window drag flow:
 *   1. Source window calls drag:start → main process tracks active session,
 *      broadcasts drag-active to ALL OTHER windows
 *   2. Source window calls drag:move on POSITION events → moves main ghost
 *   3. Other windows receive drag-active → on mousemove, check if cursor is
 *      over a drop target → show grid ghost overlay locally
 *   4. Mouseup fires in the TARGET window → that window calls drag:get-active
 *      to get the drag data → resolves local target → dispatches workspace op →
 *      calls drag:end-session to clean up the source window
 *   5. Mouseup fires in the SOURCE window → normal orchestrator flow →
 *      calls drag:end → broadcasts drag-inactive to all windows
 */

import { ipcMain, BrowserWindow, screen, type WebContents } from "electron";
import type { DragGhostManager } from "../../src/main/index.js";
import { openp41geWindows } from "../window-manager.js";
import { computeGhostShowWindows, containsPoint } from "../drag-ghost-target.js";

// ─── Session tracking ─────────────────────────────────────────────────────

interface ActiveDragSession {
  sourceWinId: string;
  label: string;
  dragData: {
    tabId: string;
    winId: string;
    worksetId: string;
    type: string;
    title?: string;
    filePath?: string;
    [key: string]: unknown;
  };
}

let _activeSession: ActiveDragSession | null = null;
let _cursorPollInterval: ReturnType<typeof setInterval> | null = null;
// The DragGhostManager instance (set in registerDragHandlers) — used to keep
// the ghost following the cursor globally.
let _dragGhost: DragGhostManager | null = null;

function _startCursorPoll(): void {
  _stopCursorPoll();
  // Poll cursor screen position at ~60fps and broadcast to all windows.
  // This is necessary because no renderer process receives continuous
  // mousemove events during a cross-window drag — macOS delivers mouse
  // events only to the capturing window, and the target window only gets
  // the entry event.
  _cursorPollInterval = setInterval(() => {
    if (!_activeSession) {
      _stopCursorPoll();
      return;
    }
    const pos = screen.getCursorScreenPoint();
    // Keep the main-process ghost following the cursor globally, so a drag can
    // visually leave the window (the source renderer only gets moves in-window).
    _dragGhost?.move(pos.x, pos.y);

    // While the cursor is still over the SOURCE window, the source is on top
    // (it initiated the drag and holds focus), so no other window should paint
    // a cross-window drop indicator. An overlaid window's grid bounds can
    // overlap the cursor even when the source is the window actually under the
    // pointer — e.g. a source window overlapping another one. Only when the
    // cursor leaves the
    // source do we forward its position to a target window; every other window
    // gets an explicit clear so a stale indicator is never left showing.
    const sourceBw = _activeSession ? openp41geWindows.get(_activeSession.sourceWinId) : undefined;
    const sourceBounds = sourceBw && !sourceBw.isDestroyed() ? sourceBw.getBounds() : null;
    const sourceWc = sourceBw && !sourceBw.isDestroyed() ? sourceBw.webContents : null;
    const showIds = computeGhostShowWindows(
      sourceBounds,
      [...openp41geWindows]
        .filter(([, bw]) => !bw.isDestroyed())
        .map(([id, bw]) => ({ id, bounds: bw.getBounds() })),
      pos,
    );
    for (const [sid, bw] of openp41geWindows) {
      if (bw.isDestroyed()) continue;
      if (sourceWc && bw.webContents === sourceWc) continue;
      bw.webContents.send(
        "openp41ge:drag-ghost",
        JSON.stringify({ screenX: pos.x, screenY: pos.y, clear: !showIds.has(sid) }),
      );
    }
  }, 50);
}

function _stopCursorPoll(): void {
  if (_cursorPollInterval !== null) {
    clearInterval(_cursorPollInterval);
    _cursorPollInterval = null;
  }
}

/** Broadcast drag-active/inactive to all windows except the sender. */
function _broadcastDragState(active: boolean, exclude: WebContents | null): void {
  const type = _activeSession?.dragData?.type ?? null;
  const payload = JSON.stringify({ active, type });
  for (const [, bw] of openp41geWindows) {
    if (bw.isDestroyed()) continue;
    if (exclude && bw.webContents === exclude) continue;
    bw.webContents.send("openp41ge:drag-state", payload);
  }
}

export function registerDragHandlers(dragGhost: DragGhostManager): void {
  _dragGhost = dragGhost;
  // ── Drag lifecycle ──────────────────────────────────────────────────────

  ipcMain.on("openp41ge:drag-start", (_event, data: string) => {
    const parsed = JSON.parse(data);
    const {
      label,
      screenX,
      screenY,
      emoji,
      tabId,
      winId,
      worksetId,
      tabWidth,
      tabHeight,
      offsetX,
      offsetY,
      dragType,
      filePath,
      captureRect,
      inset,
      payloadData,
    } = parsed;

    // Show the ghost IMMEDIATELY (synchronous, row-styled for files / git
    // entries) so even a very quick drag gets visible feedback. Blocking on
    // capturePage first meant a fast drag could end (drag.end hides the ghost)
    // before the slow capture resolved -> no drag element at all.
    const isRowStyle = dragType === "file" || dragType === "payload";
    dragGhost.show(
      label,
      screenX,
      screenY,
      emoji,
      tabWidth,
      tabHeight,
      offsetX,
      offsetY,
      isRowStyle,
      undefined,
      dragType,
    );
    // Track the active drag session for cross-window drops
    const sender = _event.sender;
    for (const [sid, bw] of openp41geWindows) {
      if (bw.webContents === sender) {
        const type = dragType || "tab";
        _activeSession = {
          sourceWinId: sid,
          label,
          dragData: {
            tabId: tabId || "",
            winId: winId || sid,
            worksetId: worksetId || sid,
            type,
            title: label,
            ...(type === "file" && filePath ? { filePath } : {}),
            // Persist an extension's typed payload drag (payload, sourceId,
            // contexts, crossWindow) verbatim so the TARGET window can resolve
            // it — the renderer validates the payload before using it.
            ...(type === "payload" && payloadData && typeof payloadData === "object"
              ? { ...(payloadData as Record<string, unknown>), type: "payload" }
              : {}),
          },
        };
        break;
      }
    }

    // Async upgrade: capture a pixel-accurate bitmap of the source element
    // (a tab, a row) and swap it into the ghost in-place — only if the
    // drag is still ACTIVE (the session object identity is unchanged), otherwise
    // the drag already ended and we must not resurrect a ghost after drag.end.
    if (
      captureRect &&
      typeof captureRect.x === "number" &&
      typeof captureRect.y === "number" &&
      typeof captureRect.width === "number" &&
      typeof captureRect.height === "number" &&
      !sender.isDestroyed()
    ) {
      const session = _activeSession;
      void (async () => {
        try {
          const img = await sender.capturePage({
            x: Math.round(captureRect.x),
            y: Math.round(captureRect.y),
            width: Math.round(captureRect.width),
            height: Math.round(captureRect.height),
          });
          if (!img || img.isEmpty()) return;
          if (_activeSession === session && !sender.isDestroyed()) {
            // In-place bitmap swap — the row-style ghost is already visible and
            // must NOT be destroyed/recreated (that would flicker or vanish on
            // a fast drag). Just reload this ghost's content with the snapshot.
            dragGhost.setBitmap(
              img.toDataURL(),
              typeof tabWidth === "number" ? tabWidth : Math.round(captureRect.width),
              typeof tabHeight === "number" ? tabHeight : Math.round(captureRect.height),
              typeof inset === "number" ? inset : 0,
            );
          }
        } catch {
          // capturePage can reject if the window is closing — keep the
          // row-styled ghost already on screen.
        }
      })();
    }
  });

  // ── Drag activation (threshold met) ──────────────────────────────────────
  // Broadcast drag-active to other windows only when the drag threshold is
  // met (not on mousedown alone). This prevents stale _remoteDragActive state
  // if the user clicks a tab without dragging.
  ipcMain.on("openp41ge:drag-activate", (_event) => {
    _broadcastDragState(true, _event.sender);
    // Start polling cursor position — the only reliable source of
    // continuous cursor coordinates during a cross-window drag.
    _startCursorPoll();
  });

  ipcMain.on("openp41ge:drag-move", (_event, data: string) => {
    const { screenX, screenY } = JSON.parse(data);
    dragGhost.move(screenX, screenY);
  });

  // Fade the ghost content so the drop indicator under the cursor shows through
  // while hovering a tab bar (0–1; animates quickly via a CSS transition).
  ipcMain.on("openp41ge:drag-opacity", (_event, opacity: unknown) => {
    if (typeof opacity === "number" && Number.isFinite(opacity)) {
      dragGhost.setOpacity(opacity);
    }
  });

  ipcMain.on("openp41ge:drag-end", () => {
    _stopCursorPoll();
    dragGhost.hide();
    _activeSession = null;
    _broadcastDragState(false, null);
  });

  // ── End a drag session from a target window (cross-window drop) ────────
  ipcMain.on("openp41ge:drag-end-session", () => {
    if (_activeSession) {
      const bw = openp41geWindows.get(_activeSession.sourceWinId);
      if (bw && !bw.isDestroyed()) {
        bw.webContents.send("openp41ge:drag-end-session");
      }
    }
    _stopCursorPoll();
    dragGhost.hide();
    _activeSession = null;
    _broadcastDragState(false, null);
  });

  // ── Cross-window ghost forwarding ────────────────────────────────────────

  ipcMain.on("openp41ge:drag-ghost-show", (_event, data: string) => {
    const parsed = JSON.parse(data);
    const bw = openp41geWindows.get(parsed.targetWinId);
    if (bw && !bw.isDestroyed()) {
      bw.webContents.send(
        "openp41ge:drag-ghost",
        JSON.stringify({
          screenX: parsed.screenX,
          screenY: parsed.screenY,
          label: parsed.label || _activeSession?.label || "Tab",
        }),
      );
    }
  });

  ipcMain.on("openp41ge:drag-ghost-hide", (_event, data: string) => {
    const parsed = JSON.parse(data);
    const bw = openp41geWindows.get(parsed.targetWinId);
    if (bw && !bw.isDestroyed()) {
      bw.webContents.send("openp41ge:drag-ghost-hide");
    }
  });

  // ── Forward ghost cursor position from source to all other windows ───────
  // The source window's orchestrator fires CROSS events when the cursor
  // leaves valid drop targets. We forward screenX/screenY so every window
  // can show a ghost at the correct position. Skip forwarding while the
  // cursor is still over the source window — an overlaid window must not
  // light up a drop indicator for a cursor that has not left the source yet.
  ipcMain.on("openp41ge:drag-ghost-forward", (_event, data: string) => {
    const sender = _event.sender;
    let parsed: { screenX: number; screenY: number };
    try {
      parsed = JSON.parse(data);
    } catch {
      return;
    }
    if (!_activeSession) return;
    const sourceBw = openp41geWindows.get(_activeSession.sourceWinId);
    const sourceBounds = sourceBw && !sourceBw.isDestroyed() ? sourceBw.getBounds() : null;
    if (sourceBounds && containsPoint(sourceBounds, { x: parsed.screenX, y: parsed.screenY })) {
      return;
    }
    const payload = JSON.stringify({ ...parsed, clear: false });
    for (const [, bw] of openp41geWindows) {
      if (bw.webContents !== sender && !bw.isDestroyed()) {
        bw.webContents.send("openp41ge:drag-ghost", payload);
      }
    }
  });

  // ── Cross-window: get active drag session ────────────────────────────────
  ipcMain.handle("openp41ge:drag-get-active", async () => {
    if (!_activeSession) return null;
    return {
      sourceWinId: _activeSession.sourceWinId,
      label: _activeSession.label,
      dragData: _activeSession.dragData,
    };
  });

  // ── Cross-window drag check (resolve drop target in another window) ─────

  ipcMain.handle("openp41ge:drag-check", async (_event, data: string) => {
    const parsed = JSON.parse(data);
    const { screenX, screenY } = parsed;
    const allWindows = BrowserWindow.getAllWindows();

    for (const bw of allWindows) {
      const bounds = bw.getBounds();
      if (
        screenX >= bounds.x &&
        screenX <= bounds.x + bounds.width &&
        screenY >= bounds.y &&
        screenY <= bounds.y + bounds.height
      ) {
        let targetOpenp41geWinId: string | null = null;
        for (const [sid, existing] of openp41geWindows) {
          if (existing === bw) {
            targetOpenp41geWinId = sid;
            break;
          }
        }
        if (!targetOpenp41geWinId) continue;

        const clientX = screenX - bounds.x;
        const clientY = screenY - bounds.y;

        try {
          const result = await _resolveDropInWindow(bw, clientX, clientY);
          return { target: result, windowId: targetOpenp41geWinId };
        } catch {
          return null;
        }
      }
    }
    return null;
  });
}

// ─── Drop resolution helpers ──────────────────────────────────────────────

async function _resolveDropInWindow(
  bw: BrowserWindow,
  clientX: number,
  clientY: number,
): Promise<Record<string, unknown> | null> {
  const js = `
    (() => {
      const el = document.elementFromPoint(${clientX}, ${clientY});
      if (!el || !(el instanceof HTMLElement)) return null;

      const tabBar = el.closest('tab-bar');
      if (tabBar && tabBar.dropTarget && tabBar.winId) {
        const barEl = tabBar.barElement;
        if (!barEl) return { type: 'tab-bar', winId: tabBar.winId, col: tabBar.col, dropIndex: 0 };
        const barRect = barEl.getBoundingClientRect();
        const relX = ${clientX} - barRect.left;
        const tabButtons = barEl.querySelectorAll('[data-tab-id]');
        let dropIndex = tabButtons.length;
        for (let i = 0; i < tabButtons.length; i++) {
          const btnRect = tabButtons[i].getBoundingClientRect();
          const btnMid = btnRect.left - barRect.left + btnRect.width / 2;
          if (relX < btnMid) { dropIndex = i; break; }
        }
        return { type: 'tab-bar', winId: tabBar.winId, col: tabBar.col, dropIndex };
      }

      const grid = el.closest('tab-grid');
      if (grid && grid.dropTarget && grid.winId) {
        const gridRect = grid.getBoundingClientRect();
        const relX = ${clientX} - gridRect.left;
        const cols = grid.cols || 1;

        // Use same boundary detection as computeDropTarget to keep ghost
        // preview and actual drop target in sync.
        var gridWidth = gridRect.width;
        var fraction = relX / gridWidth;

        if (cols <= 0) {
          return { type: 'grid-move', winId: grid.winId, col: 0 };
        }

        if (cols === 1) {
          var edgeThreshold = Math.min(0.15, 1 / 3);
          if (fraction <= edgeThreshold) {
            return { type: 'grid-split', winId: grid.winId, splitCol: 0, splitLeft: true };
          }
          if (fraction >= 1 - edgeThreshold) {
            return { type: 'grid-split', winId: grid.winId, splitCol: 0, splitLeft: false };
          }
          return { type: 'grid-move', winId: grid.winId, col: 0 };
        }

        // For cols > 1, compute dividers and classify
        var cellWidth = gridWidth / cols;
        var mouseCol = Math.min(Math.floor(relX / cellWidth), cols - 1);

        // Check left edge of grid (boundaryIndex = 0)
        if (fraction < 0.15) {
          return { type: 'grid-split', winId: grid.winId, splitCol: 0, splitLeft: true };
        }

        // Check right edge of grid (boundaryIndex = cols)
        if (fraction > 1 - 0.15) {
          return { type: 'grid-split', winId: grid.winId, splitCol: cols - 1, splitLeft: false };
        }

        // Check internal boundaries
        // Left edge of cell N → boundary between N-1 and N.
        // splitLeft=true  → new column at same position N (before existing N).
        // Right edge of cell N → boundary between N and N+1.
        // splitLeft=false → new column at N+1 (after existing N).
        var colFraction = (relX % cellWidth) / cellWidth;
        if (colFraction < 0.15) {
          // Near left edge of mouseCol → split col to the left
          return { type: 'grid-split', winId: grid.winId, splitCol: mouseCol, splitLeft: true };
        }
        if (colFraction > 0.85) {
          // Near right edge of mouseCol → split col to the right
          return { type: 'grid-split', winId: grid.winId, splitCol: mouseCol, splitLeft: false };
        }

        return { type: 'grid-move', winId: grid.winId, col: mouseCol };
      }

      return null;
    })()
  `;

  const result = await bw.webContents.executeJavaScript(js);
  return result as Record<string, unknown> | null;
}
