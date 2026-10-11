/**
 * Global native-scrollbar restyle for Openp41ge.
 *
 * Any scroll container that is NOT upgraded to the custom `OverlayScrollbar`
 * still gets a consistent look via these global `::-webkit-scrollbar` rules.
 * They match the overlay thumb:
 *
 * - SQUARE corners (no border radius).
 * - Thin, translucent thumb.
 * - A subtle faded/transparent inner border on the content-facing edge: a LEFT
 *   border for a vertical bar, a TOP border for a horizontal bar.
 * - Thumb brightens on hover.
 *
 * The custom OverlayScrollbar hides the native bar on its host via a scoped
 * `[data-overlay-scrollbar]` rule, so these global rules never fight it.
 *
 * Note: this deliberately does NOT set `scrollbar-width` — in current Chromium
 * `scrollbar-width: thin` switches to native thin scrollbars and ignores all
 * `::-webkit-scrollbar` custom styling, which is what we must avoid.
 */

let _installed = false;

export function installGlobalScrollbarStyles(): void {
  if (_installed) return;
  _installed = true;
  const id = "openp41ge-global-scrollbar-style";
  if (document.getElementById(id)) return;

  const s = document.createElement("style");
  s.id = id;
  s.textContent = `
    ::-webkit-scrollbar { width: 8px; height: 8px; }
    ::-webkit-scrollbar-track { background: transparent; box-sizing: border-box; }
    /* Faded/transparent content-facing edge on the WHOLE scroll zone (track),
       not just the thumb. */
    ::-webkit-scrollbar-track:vertical { border-left: 1px solid rgba(128,128,128,0.25); }
    ::-webkit-scrollbar-track:horizontal { border-top: 1px solid rgba(128,128,128,0.25); }
    ::-webkit-scrollbar-thumb {
      background: rgba(255,255,255,0.16);
      border-radius: 0;
      min-height: 28px;
    }
    ::-webkit-scrollbar-thumb:hover { background: rgba(255,255,255,0.34); }
    ::-webkit-scrollbar-thumb:active { background: rgba(255,255,255,0.46); }
    ::-webkit-scrollbar-corner { background: transparent; }
  `;
  document.head.appendChild(s);
}
