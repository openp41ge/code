/**
 * Drop-indicator module — the shared blue drag/drop indicators.
 *
 * A single color family (see `color.ts`) backs three shapes so every drag &
 * drop indicator in the app reads as one consistent visual language:
 *   - <drop-line>  solid blue glowing insertion marker (drop here).
 *   - <drag-line>  translucent blue hover affordance (you can drag this).
 *   - <drop-box>   blue-bordered, transparent drop-zone box.
 */
export { DropLine } from "./drop-line";
export { DragLine } from "./drag-line";
export { DropBox } from "./drop-box";
export type { DropFadeDirection } from "./drop-box";
export { DROP_INDICATOR_COLOR, DROP_LINE_GLOW } from "./color";
