/**
 * Openp41geTabsEventHandler — translates openp41ge-core-tabs CustomEvents into
 * Openp41ge command-bus operations.
 *
 * Listens on `document` for bubbling events from <tab-grid> and <tab-bar>
 * components, then dispatches the corresponding workspace operations
 * (e.g., reorderTabsInCell, moveTabBetweenCells, activateTabInCell).
 */

import type { ICommandBus } from "../interfaces/command-bus";
import type { TabMountManager } from "./tab-mount-manager";
import type { Workspace } from "../../layout/types.js";
import { TabActivationHistory } from "./tab-activation-history";
import { translateGridOpen } from "./grid-open-translators";
import { getAppTypeRegistration } from "../apps/app-registry";
import { extensionTabLabel } from "../components/grid-tab-decorations";

type CleanupFn = () => void;

export class Openp41geTabsEventHandler {
  /** Per-window last focused column, updated by grid-focus-col events. */
  static lastFocusedCol: Record<string, number> = {};

  /** Get the last focused column for a window, falling back to 0. */
  static getLastFocusedCol(winId: string): number {
    return Openp41geTabsEventHandler.lastFocusedCol[winId] ?? 0;
  }
  private _commandBus: ICommandBus | null = null;
  private _mountManager: TabMountManager | null = null;
  private _workspaceState: {
    getWorkspace: () => Workspace | null;
  } | null = null;
  private _cleanups: CleanupFn[] = [];
  init(
    commandBus: ICommandBus,
    mountManager?: TabMountManager,
    workspaceState?: { getWorkspace: () => Workspace | null },
  ): void {
    this._commandBus = commandBus;
    this._mountManager = mountManager ?? null;
    this._workspaceState = workspaceState ?? null;
    this._registerListeners();
  }

  destroy(): void {
    for (const cleanup of this._cleanups) cleanup();
    this._cleanups = [];
    this._commandBus = null;
  }

  private _registerListeners(): void {
    // ── Tab bar reorder ─────────────────────────────────────────────
    this._on("tab-bar-reorder", (detail) => {
      const { winId, col, fromIndex, toIndex } = detail as {
        winId: string;
        col: number;
        fromIndex: number;
        toIndex: number;
      };
      this._dispatch("reorderTabsInCell", winId, 0, col, fromIndex, toIndex);
    });

    // ── Tab bar cross-cell move ─────────────────────────────────────
    this._on("tab-bar-move-cell", (detail) => {
      const { sourceWinId, tabId, targetWinId, targetCol, dropIndex } = detail as {
        sourceWinId: string;
        tabId: string;
        targetWinId: string;
        targetCol: number;
        dropIndex: number;
      };
      this._dispatch(
        "moveTabBetweenCells",
        sourceWinId,
        tabId,
        targetWinId,
        0,
        targetCol,
        dropIndex,
      );
    });

    // ── Grid split (tab dropped on column boundary) ─────────────────
    this._on("grid-split", (detail) => {
      const { winId, tabId, splitCol, splitLeft } = detail as {
        winId: string;
        tabId: string;
        splitCol: number;
        splitLeft: boolean;
      };
      this._dispatch("splitTabFromCell", winId, tabId, splitCol, splitLeft);
    });

    // ── Grid move (tab dropped into another cell) ───────────────────
    this._on("grid-move", (detail) => {
      const { sourceWinId, tabId, targetWinId, targetCol, insertAt } = detail as {
        sourceWinId: string;
        tabId: string;
        targetWinId: string;
        targetCol: number;
        insertAt?: number;
      };
      this._dispatch(
        "moveTabBetweenCells",
        sourceWinId,
        tabId,
        targetWinId,
        0,
        targetCol,
        insertAt ?? -1,
      );
    });

    // ── Grid activate (tab dropped on itself — same cell) ──────────
    this._on("grid-activate", (detail) => {
      const { winId, tabId, col } = detail as { winId: string; tabId: string; col?: number };

      TabActivationHistory.pushActivation(winId, tabId);
      this._dispatch("activateTabInCell", winId, tabId);
      this._mountManager?.activateTab(tabId);
      if (col !== undefined) {
        Openp41geTabsEventHandler.lastFocusedCol[winId] = col;
      }
    });

    // ── Grid focus col (clicked content area in a cell) ────────────
    this._on("grid-focus-col", (detail) => {
      const { winId, col } = detail as { winId: string; col: number };
      if (winId && col !== undefined) {
        Openp41geTabsEventHandler.lastFocusedCol[winId] = col;
      }
    });

    // ── Grid remove (duplicate file path detected) ──────────────────
    this._on("grid-remove", (detail) => {
      const { winId, tabId } = detail as { winId: string; tabId: string };
      this._dispatch("removeTabFromCell", winId, tabId);
    });

    // ── Grid open tab (file/repo drop on cell center or boundary) ──
    this._on("grid-open-tab", (detail) => {
      const {
        winId: eventWinId,
        tabType: _tabType,
        tabConfig,
        targetCol,
        isBoundary,
        splitCol,
        splitLeft,
        pinned,
        insertAt,
        nextToTabId,
        tabKey,
      } = detail as {
        winId?: string;
        tabType: string;
        tabConfig: {
          filePath: string;
          repoName?: string;
          branch?: string;
          hash?: string;
          shortHash?: string;
          source?: string;
          system?: string;
          chatId?: string;
        };
        targetCol: number;
        isBoundary?: boolean;
        splitCol?: number;
        splitLeft?: boolean;
        pinned?: boolean;
        /** Tab-bar index for a drop on a cell's tab bar (typed payload drops). */
        insertAt?: number;
        /** Open in the column right of this tab (made if missing), replacing
         *  the preview there — an extension's `placement: "next-column"`. */
        nextToTabId?: string;
        /** The tab's identity (`OpenTabRequest.key`). */
        tabKey?: string;
      };
      const winId = eventWinId || this._findWinId();
      if (!winId) return;

      // Translate the drop into how this app type opens (built-in apps have
      // app-specific open data; any other registered app type — e.g. an
      // extension surface — opens generically with the drop's tabConfig).
      const spec = translateGridOpen(
        _tabType,
        (tabConfig ?? {}) as Record<string, unknown>,
        (appType, config) => {
          const reg = getAppTypeRegistration(appType);
          if (!reg) return undefined;
          return extensionTabLabel(appType, config)?.title ?? reg.label;
        },
        tabKey,
      );
      if (!spec) return;

      // Mark the landing column as the last focused column for follow-up
      // opens. For boundary drops the new column is at splitCol when
      // splitLeft, else splitCol + 1. A next-column open leaves focus with
      // the tab that opened it.
      if (!nextToTabId)
        Openp41geTabsEventHandler.lastFocusedCol[winId] = isBoundary
          ? (splitLeft ?? true)
            ? (splitCol ?? targetCol)
            : (splitCol ?? targetCol) + 1
          : targetCol;

      // Trailing optional args are omitted when absent (they cross a JSON IPC
      // boundary, where undefined becomes null).
      const tail = (...args: unknown[]): unknown[] => {
        let end = args.length;
        while (end > 0 && args[end - 1] === undefined) end--;
        return args.slice(0, end);
      };

      if (nextToTabId) {
        this._dispatch(
          "openTabInNextCell",
          winId,
          nextToTabId,
          _tabType,
          spec.title,
          spec.filePath,
          spec.pinned ?? pinned ?? false,
          ...tail(spec.config),
        );
      } else if (isBoundary) {
        this._dispatch(
          "splitFileOpen",
          winId,
          _tabType,
          spec.title,
          spec.filePath,
          splitCol ?? targetCol,
          splitLeft ?? true,
          ...tail(spec.config),
        );
      } else {
        this._dispatch(
          "actionOpenFile",
          winId,
          _tabType,
          spec.title,
          spec.filePath,
          targetCol,
          spec.pinned ?? pinned ?? true,
          // `insertAt` = dropped on the tab bar: open (or move an existing tab
          // for the file) at that position.
          ...tail(spec.config, typeof insertAt === "number" ? insertAt : undefined),
        );
      }
    });

    // ── Grid pin (tab pinned via double-click or pin button) ─────
    this._on("grid-pin", (detail) => {
      const {
        winId,
        tabId,
        pinned: isPinned,
        ephemeral: _ephemeral,
      } = detail as {
        winId: string;
        tabId: string;
        pinned: boolean;
        ephemeral?: boolean;
      };
      if (!winId || !tabId) return;

      const ws = this._workspaceState?.getWorkspace();
      if (!ws) return;
      const win = ws.windows.find((w) => w.id === winId);
      if (!win) return;
      const pl = win.grid.placements.find((p) => (p.tabIds as string[]).includes(tabId));
      if (!pl) return;

      // Pin a preview tab (from preview double-click)
      if (isPinned) {
        this._dispatch("pinTabInCell", winId, pl.position.col, tabId);
      }
    });

    // ── Tab close button clicks ───────────────────────────────────
    this._onClick(".tab-close", (el) => {
      const tabId = el.getAttribute("data-close-tab-id");
      if (!tabId) return;
      const tabBar = el.closest("tab-bar") as (HTMLElement & { winId?: string }) | null;
      if (!tabBar) return;
      const winId = tabBar.winId;
      if (!winId) return;
      this._dispatch("removeTabFromCell", winId, tabId);
    });
  }

  /**
   * Listen for a CustomEvent on document.
   */
  private _on(eventName: string, handler: (detail: unknown) => void): void {
    const listener = (e: Event) => {
      handler((e as CustomEvent).detail);
    };
    document.addEventListener(eventName, listener);
    this._cleanups.push(() => document.removeEventListener(eventName, listener));
  }

  /**
   * Listen for click events matching a selector.
   */
  private _onClick(selector: string, handler: (el: HTMLElement) => void): void {
    const listener = (e: Event) => {
      const target = (e.target as HTMLElement).closest(selector);
      if (!(target instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();
      handler(target);
    };
    document.addEventListener("click", listener);
    this._cleanups.push(() => document.removeEventListener("click", listener));
  }

  private _dispatch(fn: string, ...args: unknown[]): void {
    this._commandBus?.dispatch(fn, ...args);
  }

  private _findWinId(): string {
    const grid = document.querySelector("tab-grid");
    if (grid) return (grid as HTMLElement & { winId?: string }).winId || "";
    return "";
  }
}
