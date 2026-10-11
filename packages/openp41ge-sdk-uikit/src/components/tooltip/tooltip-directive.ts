/**
 * `tooltipContent(content)` — Lit async directive that attaches a tooltip to an
 * element, with per-element content. Used in templates as:
 *
 *   html`<button ${tooltipContent({ type: "simple", text: "Save" })}>…</button>`
 *
 * On connect it wires the element to TooltipController.attach; on re-render it
 * refreshes the registry content (so dynamic text stays current); on disconnect
 * it cleans up the listeners via TooltipController.detach.
 */
import { AsyncDirective } from "lit/async-directive.js";
import { directive } from "lit/directive.js";
import { nothing } from "lit";
import type { ElementPart } from "lit";
import { tooltipController } from "./tooltip-controller";
import type { TooltipContent } from "./content";

class TooltipContentDirective extends AsyncDirective {
  private _el: Element | null = null;

  override render(_content: TooltipContent): typeof nothing {
    return nothing;
  }

  override update(part: ElementPart, [content]: [TooltipContent]) {
    this._el = part.element;
    tooltipController.attach(part.element, content);
    return this.render(content);
  }

  protected override disconnected(): void {
    if (this._el) tooltipController.detach(this._el);
    this._el = null;
  }
}

const tooltipContentDirective = directive(TooltipContentDirective);

/** Attach a tooltip (simple or detail) to the element this directive is placed on. */
export const tooltipContent = (content: TooltipContent) => tooltipContentDirective(content);
