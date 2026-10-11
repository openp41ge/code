/**
 * <openp41ge-tooltip-host> — singleton display surface for the tooltip system.
 *
 * Owns the show/hide delays, the fade transition, viewport-edge flip/clamp
 * positioning, reposition-on-scroll/resize, and the ARIA wiring
 * (`role="tooltip"` + `aria-describedby` on the target). It is a fixed,
 * `pointer-events:none` box appended to `document.body` on first use (the same
 * inject-once pattern as the toast service), so tooltips never intercept clicks
 * or the title-bar drag.
 *
 * It is deliberately separate from TooltipController (which only registers
 * targets + listeners) — one reason to change each.
 */
import type { LitElement } from "lit";
import type { TooltipContent } from "./content";
import { Openp41geTooltip } from "./openp41ge-tooltip";
import { Openp41geTooltipDetail } from "./openp41ge-tooltip-detail";

const SHOW_DELAY = 120;
const HIDE_DELAY = 60;
const FADE_MS = 90;
const GAP = 6;
const MARGIN = 8;

type TooltipPanel = Openp41geTooltip | Openp41geTooltipDetail;

export class Openp41geTooltipHost extends HTMLElement {
  static instance: Openp41geTooltipHost | null = null;

  private _popup: TooltipPanel | null = null;
  private _popupType: TooltipContent["type"] | null = null;
  private _target: HTMLElement | null = null;
  private _content: TooltipContent | null = null;
  private _shown = false;
  private _seq = 0;
  // True once hide() has been requested, so a pending reveal (still awaiting
  // the async Lit paint) knows to bail instead of showing after the pointer left.
  private _dismissed = false;
  private _showTimer: ReturnType<typeof setTimeout> | null = null;
  private _hideTimer: ReturnType<typeof setTimeout> | null = null;
  private _fadeTimer: ReturnType<typeof setTimeout> | null = null;
  private _fadeInTimer: ReturnType<typeof setTimeout> | null = null;
  private _onScroll = (): void => this._repositionOrHide();
  private _onResize = (): void => this._repositionOrHide();

  /** Get (and lazily create) the singleton host element. */
  static get(): Openp41geTooltipHost {
    if (!Openp41geTooltipHost.instance) {
      let el = document.querySelector("openp41ge-tooltip-host") as Openp41geTooltipHost | null;
      if (!el) {
        // `new` (not createElement) so the instance carries its methods in any
        // environment (the jsdom custom-element stub doesn't upgrade elements).
        el = new Openp41geTooltipHost();
        el.style.cssText =
          "position:fixed;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:99999;";
        if (document.body) document.body.appendChild(el);
        else return el; // body not ready yet — attached on next call
      }
      Openp41geTooltipHost.instance = el;
    }
    return Openp41geTooltipHost.instance;
  }

  show(target: HTMLElement, content: TooltipContent): void {
    this._dismissed = false;
    this._target = target;
    this._content = content;
    if (this._hideTimer) {
      clearTimeout(this._hideTimer);
      this._hideTimer = null;
    }
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    if (this._fadeInTimer) {
      clearTimeout(this._fadeInTimer);
      this._fadeInTimer = null;
    }
    // Mouse entered the same target that is already shown (dynamic content,
    // e.g. "Close/Open left sidebar") — re-paint and reposition in place.
    if (this._shown && this._popup && this._popupType === content.type) {
      void this._paintPopup().then(() => {
        this._fade(this._popup!, 1, undefined, true);
      });
      return;
    }
    if (this._showTimer) clearTimeout(this._showTimer);
    this._showTimer = setTimeout(() => {
      this._showTimer = null;
      this._reveal();
    }, SHOW_DELAY);
  }

  hide(): void {
    this._dismissed = true;
    if (this._showTimer) {
      clearTimeout(this._showTimer);
      this._showTimer = null;
    }
    if (!this._shown) return;
    if (this._fadeTimer) clearTimeout(this._fadeTimer);
    if (this._fadeInTimer) {
      clearTimeout(this._fadeInTimer);
      this._fadeInTimer = null;
    }
    if (this._hideTimer) clearTimeout(this._hideTimer);
    this._hideTimer = setTimeout(() => {
      this._hideTimer = null;
      this._dismiss();
    }, HIDE_DELAY);
  }

  disconnectedCallback(): void {
    this._teardownReposition();
    this._popup?.remove();
    this._popup = null;
    this._popupType = null;
    this._shown = false;
    this._target = null;
    this._content = null;
    if (this._showTimer) clearTimeout(this._showTimer);
    if (this._hideTimer) clearTimeout(this._hideTimer);
    if (this._fadeTimer) clearTimeout(this._fadeTimer);
    if (this._fadeInTimer) clearTimeout(this._fadeInTimer);
  }

  // ── Show ────────────────────────────────────────────────────────────

  private _reveal(): void {
    if (!this._content || !this._target || this._dismissed) return;
    const popup = this._ensurePopup(this._content.type);
    // Show the box at opacity 0 FIRST (so it is measurable — a display:none
    // popup reports offsetWidth/Height 0, which would defeat the horizontal
    // clamp and the bottom-edge flip). Then position, and fade in on the next
    // frame so the opacity-0 frame paints before the transition starts.
    popup.style.display = "";
    popup.style.opacity = "0";
    // No CSS transition — opacity is driven by deterministic JS steps (below),
    // since a transition armed on a just-revealed element (display:none →
    // block) is unreliable: it can freeze at its start value and leave the
    // tooltip permanently at opacity 0.
    popup.style.transition = "none";
    void this._paintPopup().then(() => {
      if (this._dismissed || !this._target || !popup.isConnected) return;
      this._shown = true;
      this._target!.setAttribute("aria-describedby", popup.id);
      this._wireReposition();
      this._fade(popup, 1, undefined, true);
    });
  }

  private async _paintPopup(): Promise<void> {
    const popup = this._popup;
    const content = this._content;
    if (!popup || !content || !this._target) return;
    if (content.type === "detail") {
      const p = popup as Openp41geTooltipDetail;
      p.title = content.title;
      p.subtitle = content.subtitle;
    } else {
      const p = popup as Openp41geTooltip;
      p.text = content.text;
    }
    // Lit element updates are async — wait before measuring for placement.
    await (popup as LitElement).updateComplete;
    this._position(popup, this._target);
  }

  private _ensurePopup(type: TooltipContent["type"]): TooltipPanel {
    if (this._popup && this._popupType === type) return this._popup;
    this._popup?.remove();
    this._popup = type === "detail" ? new Openp41geTooltipDetail() : new Openp41geTooltip();
    this._popupType = type;
    this._popup.id = `openp41ge-tooltip-${++this._seq}`;
    this._popup.setAttribute("role", "tooltip");
    Object.assign(this._popup.style, {
      position: "fixed",
      zIndex: "99999",
      pointerEvents: "none",
      display: "none",
      opacity: "0",
      transition: "none",
      maxWidth: "380px",
    });
    this.appendChild(this._popup);
    return this._popup;
  }

  // ── Hide ────────────────────────────────────────────────────────────

  private _dismiss(): void {
    if (!this._popup) return;
    const popup = this._popup;
    if (this._fadeInTimer) {
      clearTimeout(this._fadeInTimer);
      this._fadeInTimer = null;
    }
    if (this._fadeTimer) {
      clearTimeout(this._fadeTimer);
      this._fadeTimer = null;
    }
    this._target?.removeAttribute("aria-describedby");
    this._teardownReposition();
    this._fade(popup, 0, () => {
      popup.style.display = "none";
      this._shown = false;
      this._target = null;
    });
  }

  // ── Fade ────────────────────────────────────────────────────────────

  /**
   * Drive opacity from its current inline value to `to` over FADE_MS using
   * deterministic setTimeout steps (16ms ≈ one frame), instead of a CSS
   * transition. CSS transitions on a just-revealed popup can freeze at their
   * start value in some compositors, leaving the tooltip permanently invisible;
   * stepping `style.opacity` is reflected immediately and always settles at
   * `to`. `fadeIn` selects which timer slot owns the loop so a hide can cancel
   * a fade-in (and vice-versa).
   */
  private _fade(popup: TooltipPanel, to: number, onDone?: () => void, fadeIn = false): void {
    const from = parseFloat(popup.style.opacity || "1");
    if (from === to) {
      onDone?.();
      return;
    }
    const start = Date.now();
    const step = (): void => {
      if (fadeIn && this._dismissed) return; // cancelled — pointer left
      const p = Math.min((Date.now() - start) / FADE_MS, 1);
      popup.style.opacity = String(from + (to - from) * p);
      if (p < 1) {
        this._scheduleFade(step, fadeIn);
      } else {
        popup.style.opacity = String(to);
        onDone?.();
      }
    };
    this._scheduleFade(step, fadeIn);
  }

  private _scheduleFade(step: () => void, fadeIn: boolean): void {
    const handle = setTimeout(step, 16);
    if (fadeIn) this._fadeInTimer = handle;
    else this._fadeTimer = handle;
  }

  // ── Positioning ─────────────────────────────────────────────────────

  private _position(popup: HTMLElement, target: HTMLElement): void {
    const tr = target.getBoundingClientRect();
    const pw = popup.offsetWidth;
    const ph = popup.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    let top = tr.bottom + GAP;
    const below = top + ph + MARGIN <= vh;
    if (!below) top = tr.top - GAP - ph; // flip above near bottom edge
    if (top < MARGIN) top = MARGIN;

    let left = tr.left;
    if (left + pw + MARGIN > vw) left = vw - pw - MARGIN;
    if (left < MARGIN) left = MARGIN;

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
    // Orients the tail and aligns it with the target's horizontal centre.
    popup.setAttribute("data-placement", below ? "below" : "above");
    const tailLeft = tr.left + tr.width / 2 - left;
    popup.style.setProperty("--tt-tail-left", `${Math.round(tailLeft)}px`);
  }

  private _wireReposition(): void {
    this._teardownReposition();
    window.addEventListener("scroll", this._onScroll, true);
    window.addEventListener("resize", this._onResize);
  }

  private _teardownReposition(): void {
    window.removeEventListener("scroll", this._onScroll, true);
    window.removeEventListener("resize", this._onResize);
  }

  private _repositionOrHide(): void {
    if (!this._shown || !this._target || !this._popup) return;
    if (!this._target.isConnected) {
      this._dismiss();
      return;
    }
    this._position(this._popup, this._target);
  }
}

if (!customElements.get("openp41ge-tooltip-host")) {
  customElements.define("openp41ge-tooltip-host", Openp41geTooltipHost);
}
