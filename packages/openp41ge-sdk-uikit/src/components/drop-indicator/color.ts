/**
 * Shared blue for every drag/drop indicator (<drop-line>, <drag-line>,
 * <drop-box>). Keeping it in one place is what makes all the indicators read
 * as one visual family, no matter which of them is on screen.
 */
export const DROP_INDICATOR_COLOR = "rgb(74, 158, 255)";

/**
 * The two-line glow used by the solid <drop-line> insertion marker. Held in
 * one place so every drop line glows identically.
 */
export const DROP_LINE_GLOW = "0 0 8px rgba(74, 158, 255, 0.8), 0 0 16px rgba(74, 158, 255, 0.4)";
