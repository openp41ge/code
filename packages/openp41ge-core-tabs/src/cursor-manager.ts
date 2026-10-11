/**
 * CursorManager — injects drag cursor style during drag.
 */

const CURSOR_STYLE_ID = "openp41ge-drag-cursor";

export class CursorManager {
  enable(): void {
    if (document.getElementById(CURSOR_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = CURSOR_STYLE_ID;
    style.textContent = `
      * { cursor: grabbing !important; }
      iframe, object, embed { pointer-events: none !important; }
    `;
    document.head.appendChild(style);
  }

  disable(): void {
    const style = document.getElementById(CURSOR_STYLE_ID);
    if (style) style.remove();
  }
}
