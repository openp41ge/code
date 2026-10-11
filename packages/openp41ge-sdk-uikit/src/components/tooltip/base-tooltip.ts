/**
 * Shared light-DOM base for tooltip panel variants.
 *
 * Both `<openp41ge-tooltip>` and `<openp41ge-tooltip-detail>` extend this so
 * they present the same host-facing contract (a single render surface the
 * TooltipHost can create, position and fade). Light DOM (no shadow root) keeps
 * the popup host-agnostic and lets the host manage its box via inline styles.
 */
import { LitElement, html } from "lit";

/**
 * Panel styling + tail.
 *
 * Tail: the host tags the popup with `data-placement="below" | "above"` and a
 * `--tt-tail-left` CSS variable aligned to the target's horizontal centre; two
 * stacked pseudo-elements draw a 1px-outlined triangle on the correct edge,
 * clamped inside the panel.
 *
 * (Opacity is left to the host — it drives the fade with deterministic JS steps
 * rather than a CSS transition, which can freeze at its start value when the
 * popup flips `display:none → block`.)
 */
export const TOOLTIP_STYLES = html`
  <style>
    .tt-panel {
      position: relative;
    }
    .tt-panel::before,
    .tt-panel::after {
      content: "";
      position: absolute;
      width: 0;
      height: 0;
      border-style: solid;
      left: max(8px, min(var(--tt-tail-left, 16px), calc(100% - 8px)));
      transform: translateX(-50%);
    }
    /* Tooltip below the target: tail on the TOP edge, apex pointing UP. */
    [data-placement="below"] .tt-panel::before {
      top: -8px;
      border-width: 0 7px 8px 7px;
      border-color: transparent transparent var(--border-color, #3a3a3a) transparent;
    }
    [data-placement="below"] .tt-panel::after {
      top: -7px;
      border-width: 0 6px 7px 6px;
      border-color: transparent transparent var(--bg-dropdown, #1e1e1e) transparent;
    }
    /* Tooltip above the target: tail on the BOTTOM edge, apex pointing DOWN. */
    [data-placement="above"] .tt-panel::before {
      bottom: -8px;
      border-width: 8px 7px 0 7px;
      border-color: var(--border-color, #3a3a3a) transparent transparent transparent;
    }
    [data-placement="above"] .tt-panel::after {
      bottom: -7px;
      border-width: 7px 6px 0 6px;
      border-color: var(--bg-dropdown, #1e1e1e) transparent transparent transparent;
    }
  </style>
`;

export abstract class BaseTooltip extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }
}
