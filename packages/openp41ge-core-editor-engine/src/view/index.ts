/**
 * View barrel export.
 */

export { StringBuilder } from "./string-builder";
export { FastDomNode, createFastDomNode } from "./fast-dom-node";
export { RenderedLinesCollection } from "./view-layer";
export type { IRenderedLine, IRenderedLinesCollection } from "./view-layer";
export { ViewLines } from "./view-lines";
export type { IViewLinesEvent, ViewLinesConfig, ILineContentProvider } from "./view-lines";

export { computeWrapSegments } from "./word-wrap-helper";
export type { WrapSegment } from "./word-wrap-helper";

export { ScrollManager } from "./scroll-manager";
export type { ScrollState, ScrollEventHandler } from "./scroll-manager";

export { TokenSegmentAdjuster } from "./token-segment-adjuster";
export type { ITokenSegmentAdjuster } from "./token-segment-adjuster";

export { ViewportWrapColumnCalculator, ResizeObserverNotifier } from "./wrap-column-calculator";
export type { IWrapColumnCalculator, IViewportResizeNotifier } from "./wrap-column-calculator";
