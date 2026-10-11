/**
 * Tooltip system module — re-exports the public surface.
 */
export { isDetailTooltip } from "./content";
export type { TooltipContent } from "./content";
export { BaseTooltip } from "./base-tooltip";
export { Openp41geTooltip } from "./openp41ge-tooltip";
export { Openp41geTooltipDetail } from "./openp41ge-tooltip-detail";
export { Openp41geTooltipHost } from "./tooltip-host";
export { TooltipController, tooltipController } from "./tooltip-controller";
export type { TooltipHostLike } from "./tooltip-controller";
export { tooltipContent } from "./tooltip-directive";
