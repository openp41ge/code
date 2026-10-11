/**
 * TooltipController — singleton that registers tooltip targets and forwards
 * enter/leave/focus events to a TooltipHost.
 *
 * The controller keeps a WeakMap<Element, TooltipContent> so re-rendered / GC'd
 * elements never leak. It depends on a narrow `TooltipHostLike` interface
 * (`show`/`hide` only), injected via a settable public `_host` default so tests
 * can substitute a fake host (model-based DI convention).
 */
import type { TooltipContent } from "./content";
import { Openp41geTooltipHost } from "./tooltip-host";

/** The narrow host contract the controller needs (ISP — two methods only). */
export interface TooltipHostLike {
  show(target: HTMLElement, content: TooltipContent): void;
  hide(): void;
}

export class TooltipController {
  private _registry = new WeakMap<Element, TooltipContent>();
  private _shownEl: Element | null = null;

  /** Settable default host (DI). Resolves to the singleton lazily on first use. */
  public _host: TooltipHostLike | null = null;

  constructor(host?: TooltipHostLike) {
    this._host = host ?? null;
  }

  private _hostInstance(): TooltipHostLike {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
    return (this._host ??= Openp41geTooltipHost.get());
  }

  attach(el: Element, content: TooltipContent): void {
    if (this._registry.has(el)) {
      // Re-attached while possibly visible (dynamic Open/Close text) — refresh.
      this._registry.set(el, content);
      if (this._shownEl === el) this._hostInstance().show(el as HTMLElement, content);
      return;
    }
    this._registry.set(el, content);
    el.addEventListener("mouseenter", this._onEnter);
    el.addEventListener("mouseleave", this._onLeave);
    el.addEventListener("focusin", this._onEnter);
    el.addEventListener("focusout", this._onLeave);
  }

  detach(el: Element): void {
    if (!this._registry.delete(el)) return;
    el.removeEventListener("mouseenter", this._onEnter);
    el.removeEventListener("mouseleave", this._onLeave);
    el.removeEventListener("focusin", this._onEnter);
    el.removeEventListener("focusout", this._onLeave);
    if (this._shownEl === el) {
      this._shownEl = null;
      this._hostInstance().hide();
    }
  }

  private _onEnter = (e: Event): void => {
    const el = e.currentTarget as Element;
    this._shownEl = el;
    const content = this._registry.get(el);
    if (content) this._hostInstance().show(el as HTMLElement, content);
  };

  private _onLeave = (): void => {
    this._shownEl = null;
    this._hostInstance().hide();
  };
}

/** Default singleton for the app. */
export const tooltipController = new TooltipController();
