import type { BrowserWindow } from "electron";
import { createLogger } from "openp41ge-core-logger";
import type { IDragGhostManager } from "../interfaces/drag-ghost-manager.js";

const log = createLogger("openp41ge", "drag-ghost-manager");

/**
 * Max scale the workspace-skeleton ghost springs up to on pick-up
 * (source size → source × LIFT_MAX_SCALE), so it reads as being "lifted off"
 * rather than teleported to the cursor.
 */
export const LIFT_MAX_SCALE = 1.08;
const LIFT_SPRING_MS = 220;
// Overshoot / spring easing: scales past the target then settles back.
const LIFT_SPRING_EASE = "cubic-bezier(0.34, 1.56, 0.64, 1)";

/**
 * Build the ghost body HTML for a captured bitmap snapshot.
 *
 * When `liftOff` is true the bitmap is rendered at `outerW×LIFT_MAX_SCALE`
 * (the largest frame, so nothing clips) and springs up from the source size
 * (scale `1/LIFT_MAX_SCALE`) to full size, anchored at the grab point so the
 * cursor stays on the spot the user grabbed. When `liftOff` is false the bitmap
 * is rendered 1:1 at its source size (the previous behaviour).
 *
 * `offsetX`/`offsetY` are the grab point in SOURCE-element coordinates.
 */
export function buildBitmapGhostHtml(
  dataUrl: string,
  width: number,
  height: number,
  inset: number,
  liftOff: boolean,
  offsetX: number,
  offsetY: number,
): string {
  const keyframes = liftOff
    ? `<style>@keyframes op41ge-lift{from{transform:scale(${1 / LIFT_MAX_SCALE})}to{transform:scale(1)}}</style>`
    : "";
  return `<!DOCTYPE html>
<html><head>${keyframes}</head><body style="margin:0;padding:0;background:transparent;cursor:grabbing;">${buildBitmapImgHtml(
    dataUrl,
    width,
    height,
    inset,
    liftOff,
    offsetX,
    offsetY,
  )}
</body></html>`;
}

/**
 * Build just the `<img>` body content for a captured bitmap. Used by both
 * `buildBitmapGhostHtml` (setBitmap swap) and `show` (a pre-captured bitmap), so
 * a workspace drag renders the real skeleton with the lift immediately.
 *
 * `offsetX`/`offsetY` are the grab point in SOURCE-element coordinates.
 */
export function buildBitmapImgHtml(
  dataUrl: string,
  width: number,
  height: number,
  inset: number,
  liftOff: boolean,
  offsetX: number,
  offsetY: number,
): string {
  const insetPx = Math.max(0, Math.round(inset) || 0);
  const outerW = Math.max(1, Math.round(width));
  const outerH = Math.max(1, Math.round(height));
  const scale = liftOff ? LIFT_MAX_SCALE : 1;
  // Inner (image) size — the inset trims the source element by `inset`px on
  // every side, and the margin re-inserts it so the window keeps its outer size.
  const innerW = Math.max(1, Math.round((outerW - insetPx * 2) * scale));
  const innerH = Math.max(1, Math.round((outerH - insetPx * 2) * scale));
  const margin = Math.round(insetPx * scale);
  const originX = Math.max(0, Math.round((offsetX - insetPx) * scale));
  const originY = Math.max(0, Math.round((offsetY - insetPx) * scale));
  const style = liftOff
    ? `display:block;width:${innerW}px;height:${innerH}px;transform-origin:${originX}px ${originY}px;animation:op41ge-lift ${LIFT_SPRING_MS}ms ${LIFT_SPRING_EASE} both;`
    : `display:block;width:${innerW}px;height:${innerH}px;`;
  return `<img src="${dataUrl}" alt="" style="${style}margin:${margin}px;" />`;
}

/**
 * Build the initial ghost HTML for a workspace skeleton drag before the captured
 * bitmap arrives. Renders a skeleton-sized card at the largest frame
 * (source × LIFT_MAX_SCALE) that springs up from the source size, so the ghost
 * lifts on the very first frame the user starts dragging — not only once the
 * async bitmap capture resolves.
 *
 * `offsetX`/`offsetY` are the grab point in SOURCE-element coordinates.
 */
export function buildWorkspaceGhostHtml(
  label: string,
  emoji: string,
  width: number,
  height: number,
  offsetX: number,
  offsetY: number,
): string {
  const scale = LIFT_MAX_SCALE;
  const outW = Math.max(1, Math.round(width * scale));
  const outH = Math.max(1, Math.round(height * scale));
  const originX = Math.round(offsetX * scale);
  const originY = Math.round(offsetY * scale);
  const emojiHtml = emoji
    ? `<span style="font-size:18px;line-height:1;flex-shrink:0">${emoji}</span>`
    : "";
  const nameHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100%;font-size:12px;color:#d4d4d4;font-family:'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${label}</span>`;
  return `<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;width:${outW}px;height:${outH}px;box-sizing:border-box;padding:8px;background:#1e1e1e;border:1px solid #3a3d3f;border-radius:6px;box-shadow:0 4px 12px rgba(0,0,0,0.3);outline:1px solid rgba(74,158,255,0.5);outline-offset:-1px;transform-origin:${originX}px ${originY}px;animation:op41ge-lift ${LIFT_SPRING_MS}ms ${LIFT_SPRING_EASE} both;">${emojiHtml}${nameHtml}</div>`;
}

/**
 * Manages a frameless BrowserWindow used as a drag ghost.
 *
 * The ghost follows the cursor outside the app window during drag-and-drop
 * operations. It has pointer-events: none so clicks pass through to windows
 * underneath.
 *
 * BrowserWindow constructor is injected to avoid ESM import issues
 * (Electron's main process module is available at the call site).
 */
export class DragGhostManager implements IDragGhostManager {
  private _ghost: BrowserWindow | null = null;
  private readonly _BrowserWindow: typeof BrowserWindow;
  private _contentW = 0;
  private _contentH = 0;
  private _offsetX = 0;
  private _offsetY = 0;
  /** The cursor's grab point within the source element (unscaled source coords).
   * Kept separate from `_offset*` because a lift scales the positioning offset. */
  private _srcOffsetX = 0;
  private _srcOffsetY = 0;
  /** True when the current ghost is a workspace skeleton (springs up on pick-up). */
  private _liftOff = false;
  /** When true the did-finish-load handler may reposition the window; after a
   * bitmap swap only `move()` should set the position (avoids a jump back to the
   * drag-start coordinate once the async capture resolves). */
  private _allowAutoPosition = true;
  /** True once the ghost page has loaded (did-finish-load fired). */
  private _pageLoaded = false;
  /** A skeleton swap that arrived before the page loaded; applied on load. */
  private _pendingSkeleton: (() => void) | null = null;
  /** The ghost content's current opacity (1 = opaque). Faded to let the drop
   *  indicator under the cursor show through while hovering a tab bar. */
  private _opacity = 1;

  constructor(BrowserWindowCtor: typeof BrowserWindow) {
    this._BrowserWindow = BrowserWindowCtor;
  }

  show(
    label: string,
    screenX: number,
    screenY: number,
    emoji?: string,
    tabWidth?: number,
    tabHeight?: number,
    offsetX?: number,
    offsetY?: number,
    isFile?: boolean,
    bitmapDataUrl?: string,
    dragType?: string,
  ): void {
    this.hide();

    this._liftOff = dragType === "workspace";
    this._allowAutoPosition = true;
    this._pageLoaded = false;
    this._pendingSkeleton = null;

    // Store the unscaled grab point, then scale the positioning offset for a lift
    // so the cursor stays on the grab point in the (larger) lifted content.
    this._srcOffsetX = offsetX ?? Math.round((tabWidth ?? 110) / 2);
    this._srcOffsetY = offsetY ?? Math.round((tabHeight ?? 35) / 2);
    const liftScale = this._liftOff ? LIFT_MAX_SCALE : 1;
    this._offsetX = this._srcOffsetX * liftScale;
    this._offsetY = this._srcOffsetY * liftScale;

    // Use tab dimensions if provided, otherwise use defaults. A lift sizes the
    // window to the largest frame (source × LIFT_MAX_SCALE) so the sprung-up
    // content never clips.
    const ghostW = tabWidth ?? 110;
    const ghostH = tabHeight ?? 35;
    const winW = Math.max(1, Math.round(ghostW * liftScale));
    const winH = Math.max(1, Math.round(ghostH * liftScale));
    // When dimensions are explicit (files and tabs always pass the element's
    // size) we can make the window VISIBLE immediately at that size instead of
    // waiting for did-finish-load — a fast drag can otherwise mousedown+release
    // and hide the ghost before its content ever loads, so it never appears.
    const showImmediately = typeof tabWidth === "number" || typeof tabHeight === "number";

    const initialX = screenX - this._offsetX;
    const initialY = screenY - this._offsetY;
    const ghost = new this._BrowserWindow({
      width: winW,
      height: winH,
      x: isFinite(initialX) ? initialX : 0,
      y: isFinite(initialY) ? initialY : 0,
      frame: false,
      transparent: true,
      roundedCorners: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      focusable: false,
      show: false, // shown immediately (below) or after content load when no dims
    });

    ghost.setIgnoreMouseEvents(true, { forward: true });

    // Seed the assumed size with the explicit/fallback dims so move() always has
    // sane bounds even before content loads (otherwise a fast drag would move a
    // 0×0 window). The did-finish-load measure overwrites these with the real size.
    this._contentW = winW;
    this._contentH = winH;

    if (showImmediately) {
      ghost.show();
    }

    const escapedLabel = label
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    const escapedEmoji = emoji
      ? emoji
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
      : "";

    const emojiHtml = escapedEmoji
      ? `<span style="margin-right:6px;flex-shrink:0;font-size:14px;line-height:1">${escapedEmoji}</span>`
      : "";
    const nameHtml = `<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0">${escapedLabel}</span>`;

    const isFileGhost = !!isFile;
    const rowHtml = `<div style="display:flex;align-items:center;gap:7px;height:${ghostH}px;min-width:160px;padding:0 9px;background:#1e1e1e;border:1px solid #3a3d3f;border-radius:4px;box-shadow:0 4px 12px rgba(0,0,0,0.3);outline:1px solid rgba(74,158,255,0.5);outline-offset:-1px;font-size:12px;color:#d4d4d4;letter-spacing:0.02em;white-space:nowrap;box-sizing:border-box;font-family:'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#4a9eff" stroke-width="1.3" shape-rendering="geometricPrecision" style="flex-shrink:0"><path d="M4 1h6l3 3v10H4z"/><path d="M10 1v3h3"/></svg>
${nameHtml}</div>`;
    const pillHtml = `<div style="display:flex;align-items:center;gap:6px;width:${ghostW}px;height:${ghostH}px;padding:0 14px;background:#1e1e1e;border:1px solid #2a2a2a;border-radius:6px;outline:1px solid #4a9eff;outline-offset:-2px;font-size:12px;color:#e0e0e0;white-space:nowrap;letter-spacing:0.02em;box-sizing:border-box;font-family:'Roboto',-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">${emojiHtml}${nameHtml}</div>`;

    // A captured bitmap of the actual dragged element is the most faithful
    // ghost: render the PNG at the exact source element size and let the window
    // adopt those dimensions. Falls back to the file-row / pill HTML otherwise.
    const innerHtml = bitmapDataUrl
      ? `<img src="${bitmapDataUrl}" alt="" style="display:block;width:${ghostW}px;height:${ghostH}px;" />`
      : this._liftOff
        ? buildWorkspaceGhostHtml(
            escapedLabel,
            escapedEmoji,
            ghostW,
            ghostH,
            this._srcOffsetX,
            this._srcOffsetY,
          )
        : isFileGhost
          ? rowHtml
          : pillHtml;

    const liftKeyframes = this._liftOff
      ? `<style>@keyframes op41ge-lift{from{transform:scale(${1 / LIFT_MAX_SCALE})}to{transform:scale(1)}}</style>`
      : "";

    const html = `<!DOCTYPE html>
<html><head>${liftKeyframes}</head><body style="margin:0;padding:0;background:transparent;cursor:grabbing;">${innerHtml}
</body></html>`;

    ghost.webContents.on("did-finish-load", () => {
      if (ghost.isDestroyed()) return;
      // Re-apply any target opacity (e.g. a tab-bar hover that dimmed the ghost
      // before its content finished loading) now that the body exists.
      if (this._opacity !== 1) this._applyOpacity(this._opacity);
      // Measure the content and resize the window to match exactly
      ghost.webContents
        .executeJavaScript(
          `JSON.stringify({w:document.body.scrollWidth,h:document.body.scrollHeight})`,
        )
        .then((json) => {
          if (ghost.isDestroyed()) return;
          const { w, h } = JSON.parse(json);
          const cw = Math.ceil(w);
          const ch = Math.ceil(h);
          this._contentW = cw;
          this._contentH = ch;
          const boundsX = isFinite(screenX - this._offsetX) ? screenX - this._offsetX : 0;
          const boundsY = isFinite(screenY - this._offsetY) ? screenY - this._offsetY : 0;
          try {
            const cur = ghost.getBounds();
            ghost.setBounds({
              x: this._allowAutoPosition ? boundsX : cur.x,
              y: this._allowAutoPosition ? boundsY : cur.y,
              width: cw,
              height: ch,
            });
          } catch (err) {
            // setBounds can throw if the window is closing. Swallow.
            log.debug("drag ghost setBounds failed (window closing):", err);
          }
          // Only show after the window is correctly sized (no-op when already
          // visible via the immediate show path).
          if (!ghost.isDestroyed()) {
            ghost.show();
          }
          // Now that the page has painted, apply any skeleton swap that arrived
          // before the load (inject in-place, no navigation) so the ghost never
          // goes blank while the cursor is already dragging.
          this._pageLoaded = true;
          const pending = this._pendingSkeleton;
          this._pendingSkeleton = null;
          if (pending) pending();
        })
        .catch(() => {
          if (!ghost.isDestroyed()) {
            ghost.show();
          }
          this._pageLoaded = true;
          const pending = this._pendingSkeleton;
          this._pendingSkeleton = null;
          if (pending) pending();
        });
    });

    ghost.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

    this._ghost = ghost;
    ghost.on("closed", () => {
      if (this._ghost === ghost) this._ghost = null;
    });
  }

  /**
   * Swap the ghost's content to a captured bitmap in-place (same window, no
   * destroy/recreate) so the already-visible row-style ghost is upgraded to the
   * pixel-accurate source snapshot without any window-churn flicker.
   *
   * `width`/`height` are the ghost's OUTER dimensions (the whole dragged element
   * bounds); `inset` trims that area by `inset`px on every side and draws the
   * image inset within the window, so a border/edge clip is excluded while the
   * ghost keeps aligned with the cursor offset.
   */
  setBitmap(dataUrl: string, width: number, height: number, inset = 0): void {
    if (!this._ghost || this._ghost.isDestroyed()) return;
    const insetPx = Math.max(0, Math.round(inset) || 0);
    const outerW = Math.max(1, Math.round(width));
    const outerH = Math.max(1, Math.round(height));
    const scale = this._liftOff ? LIFT_MAX_SCALE : 1;
    const srcOffsetX = this._srcOffsetX;
    const srcOffsetY = this._srcOffsetY;
    this._contentW = Math.max(1, Math.round(outerW * scale));
    this._contentH = Math.max(1, Math.round(outerH * scale));
    // show() already sized the window for a lift (source × LIFT_MAX_SCALE) and
    // set the scaled offset, so the window is already positioned on the grab
    // point; just keep the offset scaled so move() tracks with it. No grow here.
    if (this._liftOff) {
      this._offsetX = srcOffsetX * scale;
      this._offsetY = srcOffsetY * scale;
    }
    // The in-place swap below must NOT re-anchor the window back to the
    // drag-start coordinate (move() owns the position now).
    this._allowAutoPosition = false;
    // Inject just the <img> element (the placeholder page already carries the
    // @keyframes + cursor styles). Injecting via document.body.innerHTML avoids
    // a loadURL navigation that would tear down the placeholder before it paints
    // and leave the ghost blank until the PNG decodes.
    const html = buildBitmapImgHtml(
      dataUrl,
      outerW,
      outerH,
      insetPx,
      this._liftOff,
      srcOffsetX,
      srcOffsetY,
    );
    const ghost = this._ghost;
    const apply = () => {
      if (ghost && !ghost.isDestroyed()) {
        ghost.webContents
          .executeJavaScript(`document.body.innerHTML = ${JSON.stringify(html)};`)
          .catch(() => {
            /* page could be closing; keep whatever is painted */
          });
      }
    };
    if (this._pageLoaded) {
      apply();
    } else {
      this._pendingSkeleton = apply;
    }
  }

  move(screenX: number, screenY: number): void {
    if (this._ghost && !this._ghost.isDestroyed()) {
      const x = screenX - this._offsetX;
      const y = screenY - this._offsetY;
      if (isFinite(x) && isFinite(y)) {
        try {
          this._ghost.setBounds({
            x: Math.round(x),
            y: Math.round(y),
            width: this._contentW,
            height: this._contentH,
          });
        } catch (err) {
          // setBounds can throw if the window enters a closing/destroyed state
          // between the isDestroyed() check above and this call. Swallow.
          log.debug("drag ghost setBounds failed (window destroyed):", err);
        }
      }
    }
  }

  /**
   * Set the ghost's content opacity, animating quickly to the new value.
   *
   * The drag ghost floats above the drop indicator under the cursor, so while
   * hovering a tab bar the indicator can be hard to see. Dimming the ghost to
   * ~33% lets the indicator show through. The opacity is applied to the ghost
   * page's <body> with a CSS transition (persists across in-place bitmap swaps,
   * since `setBitmap` only rewrites the body's children, never the body node),
   * giving a smooth fade in both directions. The native window stays
   * transparent/always-on-top, so only the content fades.
   */
  setOpacity(opacity: number): void {
    const o = Math.max(0, Math.min(1, opacity));
    this._opacity = o;
    this._applyOpacity(o);
  }

  private _applyOpacity(opacity: number): void {
    if (!this._ghost || this._ghost.isDestroyed()) return;
    const js = `document.body.style.transition="opacity 120ms ease";document.body.style.opacity=${JSON.stringify(
      String(opacity),
    )};`;
    this._ghost.webContents.executeJavaScript(js).catch(() => {
      /* page could be closing; the ghost is being hidden */
    });
  }

  hide(): void {
    if (this._ghost && !this._ghost.isDestroyed()) {
      this._ghost.close();
    }
    this._ghost = null;
    this._contentW = 0;
    this._contentH = 0;
    this._offsetX = 0;
    this._offsetY = 0;
    this._srcOffsetX = 0;
    this._srcOffsetY = 0;
    this._liftOff = false;
    this._allowAutoPosition = true;
    this._pageLoaded = false;
    this._pendingSkeleton = null;
    this._opacity = 1;
  }

  isActive(): boolean {
    return this._ghost !== null && !this._ghost.isDestroyed();
  }
}
