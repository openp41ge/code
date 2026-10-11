/**
 * <openp41ge-sidebar-demo> — an animated mock of a workspace window showing
 * the sidebars sliding out and back in, on a loop.
 *
 * The loop walks through these stages:
 *   1. window closed (both sidebars collapsed into the empty grid)
 *   2. left sidebar slides out
 *   3. …pause…
 *   4. right sidebar slides out
 *   5. …pause…
 *   6. one sidebar is resized wider via its drag bar
 *   7. …pause…
 *   8. everything slides closed again, then the loop restarts
 *
 * The mock window's outer width never changes: the sidebars are absolutely
 * positioned clipping windows that take space from the (empty) grid area.
 * Under `prefers-reduced-motion` the mock freezes with both sidebars open.
 */

import { html, LitElement, type TemplateResult } from "lit";

const ROW_COUNT = 3;

/** A timeline checkpoint. `lw`/`rw` are the left/right sidebar widths as a
 *  fraction of the body width (0 = collapsed). `bar` is whether the drag bar
 *  is drawn. Between checkpoints values lerp linearly. */
interface Checkpoint {
  t: number;
  lw: number;
  rw: number;
  bar: boolean;
}

/** One full cycle of the demo, in milliseconds. */
const LOOP = 16000;

/** The wider width a sidebar takes after the resize step (fraction of body). */
const RESIZED = 0.45;

const TIMELINE: Checkpoint[] = [
  { t: 0, lw: 0, rw: 0, bar: false },
  { t: 1600, lw: 0, rw: 0, bar: false },
  { t: 2200, lw: 0.3, rw: 0, bar: false },
  { t: 3300, lw: 0.3, rw: 0, bar: false },
  { t: 4300, lw: 0.3, rw: 0.3, bar: false },
  { t: 6400, lw: 0.3, rw: 0.3, bar: false },
  { t: 7200, lw: 0.45, rw: 0.3, bar: true },
  { t: 8300, lw: 0.45, rw: 0.3, bar: true },
  { t: 9300, lw: 0.45, rw: 0, bar: false },
  { t: 10300, lw: 0, rw: 0, bar: false },
  { t: 16000, lw: 0, rw: 0, bar: false },
];

export class Openp41geSidebarDemo extends LitElement {
  private _raf = 0;
  private _start = 0;
  private _left!: HTMLElement;
  private _right!: HTMLElement;
  private _bar!: HTMLElement;

  private _reduced =
    typeof window !== "undefined" &&
    !!window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  override connectedCallback(): void {
    super.connectedCallback();
    if (this._reduced) return;
    this._start = performance.now();
    const tick = (now: number): void => {
      this._apply(now);
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    cancelAnimationFrame(this._raf);
  }

  private _apply(now: number): void {
    const root = this.renderRoot;
    this._left = this._left ?? (root.querySelector(".side--left") as HTMLElement);
    this._right = this._right ?? (root.querySelector(".side--right") as HTMLElement);
    this._bar = this._bar ?? (root.querySelector(".dragbar") as HTMLElement);
    if (!this._left || !this._right) return;

    const c = this._sample((now - this._start) % LOOP);
    this._left.style.width = `${Math.round(c.lw * 100)}%`;
    this._right.style.width = `${Math.round(c.rw * 100)}%`;
    if (this._bar) this._bar.style.opacity = c.bar ? "1" : "0";
  }

  private _sample(t: number): { lw: number; rw: number; bar: boolean } {
    const pts = TIMELINE;
    let a = pts[pts.length - 1];
    let b = pts[0];
    for (let i = 0; i < pts.length; i++) {
      if (t < pts[i].t) {
        a = pts[(i - 1 + pts.length) % pts.length];
        b = pts[i];
        break;
      }
    }
    const span = b.t - a.t || 1;
    const k = Math.min(1, Math.max(0, (t - a.t) / span));
    return {
      lw: a.lw + (b.lw - a.lw) * k,
      rw: a.rw + (b.rw - a.rw) * k,
      bar: b.bar,
    };
  }

  private _rows(): TemplateResult {
    return html`
      ${Array.from({ length: ROW_COUNT }, (_, i) => {
        const head = i === 0;
        return html`
          <div class="row">
            <span class="row-icon"></span>
            <span class="row-bar ${head ? "row-bar--head" : ""}"></span>
          </div>
        `;
      })}
    `;
  }

  override render(): TemplateResult {
    const staticOpen = this._reduced ? `${Math.round(RESIZED * 100)}%` : "0%";
    return html`
      <style>
        :host {
          display: block;
        }
        .demo {
          width: 100%;
          height: 178px;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          border-radius: 9px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 10px 24px rgba(0, 0, 0, 0.35);
        }
        .chrome {
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 10px;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-secondary, #999);
          opacity: 0.55;
        }
        .cbtn {
          width: 11px;
          height: 11px;
          border-radius: 3px;
          background: var(--bg-active, #37373d);
          flex-shrink: 0;
        }
        .cbtn--label {
          width: 22px;
        }
        .spacer {
          flex: 1;
        }
        .body {
          flex: 1;
          min-height: 0;
          position: relative;
        }
        /* The sidebars slide over an empty body; nothing else is drawn, so
           only the sidebar panels are visible. Each sidebar is a clipping
           window over a fixed-width inner, so the
           width can collapse to zero (slide out) and grow back cleanly,
           without the window itself ever changing width. */
        .side {
          position: absolute;
          top: 8px;
          bottom: 8px;
          width: 0;
        }
        .side--left {
          left: 8px;
        }
        .side--right {
          right: 8px;
        }
        .clip {
          position: relative;
          height: 100%;
          overflow: hidden;
          background: var(--bg-secondary, #161616);
          border-radius: 6px;
        }
        .inner {
          position: absolute;
          top: 0;
          left: 0;
          height: 100%;
          width: 100%;
          padding: 9px 9px;
          display: flex;
          flex-direction: column;
          gap: 8px;
          box-sizing: border-box;
        }
        .tab {
          width: 18px;
          height: 9px;
          border-radius: 4.5px;
          background: var(--accent, #79c0ff);
          flex-shrink: 0;
        }
        .tabs {
          display: flex;
          gap: 4px;
          flex-shrink: 0;
        }
        .row {
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .row-icon {
          width: 7px;
          height: 7px;
          border-radius: 2px;
          background: var(--accent, #79c0ff);
          opacity: 0.5;
          flex-shrink: 0;
        }
        .row-bar {
          flex: 1;
          max-width: 90px;
          height: 5px;
          border-radius: 2px;
          background: var(--bg-active, #37373d);
        }
        /* The drag bar sits at the left sidebar's inner edge. */
        .dragbar {
          position: absolute;
          right: -3px;
          top: 0;
          bottom: 0;
          width: 3px;
          background: var(--accent, #79c0ff);
          border-radius: 2px;
          opacity: 0;
        }
        @media (prefers-reduced-motion: reduce) {
          .side--left,
          .side--right {
            width: ${staticOpen};
          }
          .dragbar {
            opacity: 0;
          }
        }
      </style>
      <div class="demo">
        <div class="chrome">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="cbtn"></span><span class="cbtn"></span><span class="cbtn"></span>
          <span class="spacer"></span>
          <span class="cbtn cbtn--label"></span><span class="cbtn"></span>
        </div>
        <div class="body">
          <div class="side side--left">
            <div class="clip">
              <div class="inner">
                <div class="tabs">
                  <div class="tab"></div>
                  <div class="tab"></div>
                </div>
                ${this._rows()}
              </div>
            </div>
            <div class="dragbar"></div>
          </div>
          <div class="side side--right">
            <div class="clip">
              <div class="inner">
                <div class="tabs">
                  <div class="tab"></div>
                  <div class="tab"></div>
                  <div class="tab"></div>
                </div>
                ${this._rows()}
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-sidebar-demo", Openp41geSidebarDemo);
