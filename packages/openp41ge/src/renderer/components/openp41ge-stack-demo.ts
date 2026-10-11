/**
 * <openp41ge-stack-demo> — a static mock of the workspace window skeleton
 * with its left explorer sidebar open. The sidebar shows the two-level model
 * (Repository → Worktree): several repositories at the top level, each with
 * 1+ worktrees indented beneath. Used on the "levels" Welcome slide.
 *
 * It also drives a carousel of the three explainer cards in the sibling
 * `.wm-window-copy` (Workspace / Repository / Worktree): the active card sits
 * centred and the others are invisible, with the cards crossfading between
 * dwells. A set of segmented dots under the card counts down each dwell
 * (~20s) — the active slide's dot widens and fills up, then the cards fade and
 * the matching part of the skeleton — the workspace button in the title bar,
 * the repository rows, then the worktree rows — lights up in sync. Everything
 * starts grey and turns blue only while highlighted. The carousel also has
 * forward/back controls plus tappable dots to move between slides on demand.
 *
 * The carousel only runs while the levels page is settled on screen: the
 * window-manager sets `active = true` once the page has finished sliding in,
 * and `false` as soon as it starts leaving, so no timers or animations run
 * while the page is hidden.
 */

import { html, LitElement, type TemplateResult } from "lit";

const DWELL = 20000; // ms each card stays centred

export class Openp41geStackDemo extends LitElement {
  private _active = 0;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _raf = 0;
  private _dots: { root: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private _running = false;

  /** Whether the carousel should be cycling (the levels page is visible). */
  get active(): boolean {
    return this._running;
  }
  set active(value: boolean) {
    if (this._running === value) return;
    this._running = value;
    if (value) this._start();
    else this._stop();
  }

  override render(): TemplateResult {
    return html`
      <style>
        :host {
          display: block;
        }
        .demo {
          height: 300px;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          border-radius: 9px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }
        .chrome {
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 8px;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-secondary, #999);
          opacity: 0.45;
        }
        .cbtn {
          width: 11px;
          height: 11px;
          border-radius: 3px;
          background: var(--bg-active, #37373d);
          flex-shrink: 0;
          transition: background-color 0.4s ease;
        }
        /* The workspace button — a wider button near the right of the title
           bar. Lights blue while the Workspace card is active. */
        .cbtn--label {
          width: 22px;
          background: var(--bg-active, #37373d);
        }
        .cbtn--label.hl {
          background: var(--accent, #79c0ff);
        }
        .spacer {
          flex: 1;
        }
        .body {
          flex: 1;
          min-height: 0;
          display: flex;
          gap: 3px;
          padding: 8px;
        }
        /* Left explorer sidebar holding the repository / worktree tree. */
        .side {
          width: 132px;
          flex-shrink: 0;
          overflow: hidden;
          border-radius: 5px;
          background: var(--bg-secondary, #161616);
          padding: 5px;
          display: flex;
          flex-direction: column;
          gap: 9px;
        }
        .branch {
          display: flex;
          flex-direction: column;
          gap: 3px;
        }
        .repo {
          display: flex;
          align-items: center;
          gap: 7px;
          min-height: 16px;
          padding: 3px 3px;
          border-radius: 4px;
          transition: background-color 0.4s ease;
        }
        .wt {
          display: flex;
          align-items: center;
          gap: 5px;
          min-height: 14px;
          padding: 3px 3px 3px 14px;
          border-radius: 4px;
          transition: background-color 0.4s ease;
        }
        /* Grey by default; light up blue while their card is highlighted. */
        .repo.hl,
        .wt.hl {
          background: rgba(86, 156, 214, 0.2);
        }
        .repo-icon {
          width: 9px;
          height: 9px;
          border-radius: 3px;
          background: var(--text-tertiary, #777);
          flex-shrink: 0;
          transition: background-color 0.4s ease;
        }
        .wt-icon {
          width: 7px;
          height: 7px;
          border-radius: 3px;
          background: var(--text-tertiary, #777);
          flex-shrink: 0;
          transition: background-color 0.4s ease;
        }
        .repo.hl .repo-icon,
        .wt.hl .wt-icon {
          background: var(--accent, #79c0ff);
        }
        .repo .bar,
        .wt .bar {
          height: 5px;
          border-radius: 3px;
          background: var(--bg-active, #3a3a42);
          flex: 1;
          max-width: 72px;
        }
        .wt .bar {
          max-width: 54px;
        }
        /* Small caption above the workspace-window skeleton. */
        .demo-caption {
          text-align: center;
          font-style: italic;
          font-size: 12px;
          color: var(--text-muted, #777);
          margin-bottom: 6px;
        }
      </style>
      <div class="demo-caption">Workspace window</div>
      <div class="demo">
        <div class="chrome">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="cbtn"></span><span class="cbtn"></span><span class="cbtn"></span>
          <span class="spacer"></span>
          <span class="cbtn cbtn--label"></span>
          <span class="cbtn"></span>
        </div>
        <div class="body">
          <div class="side">
            <div class="branch">
              <div class="repo"><span class="repo-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
            </div>
            <div class="branch">
              <div class="repo"><span class="repo-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
            </div>
            <div class="branch">
              <div class="repo"><span class="repo-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
              <div class="wt"><span class="wt-icon"></span><span class="bar"></span></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  override firstUpdated(): void {
    // Tag the stage so the sibling explainer paragraphs render as a carousel
    // only on this slide (other workspace-window demos keep plain copy text).
    this.parentElement?.classList.add("wm-levels");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stop();
  }

  /** Build the segmented-dot indicator and forward/back controls. */
  private _createControls(): void {
    const copy = this.parentElement?.querySelector<HTMLElement>(".wm-window-copy");
    if (!copy) return;
    const row = document.createElement("div");
    row.className = "wm-carousel-controls";

    const prev = document.createElement("button");
    prev.className = "wm-carousel-prev";
    prev.setAttribute("aria-label", "Previous card");
    prev.innerHTML = "\u2039";
    prev.addEventListener("click", () => this._goTo(this._active - 1));

    const dots = document.createElement("div");
    dots.className = "wm-carousel-dots";
    this._dots = [];
    for (let i = 0; i < 3; i++) {
      const dot = document.createElement("div");
      dot.className = "wm-carousel-dot";
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", `Go to card ${i + 1}`);
      dot.addEventListener("click", () => this._goTo(i));
      const fill = document.createElement("div");
      fill.className = "wm-carousel-dot-fill";
      dot.appendChild(fill);
      dots.appendChild(dot);
      this._dots.push({ root: dot, fill });
    }

    const next = document.createElement("button");
    next.className = "wm-carousel-next";
    next.setAttribute("aria-label", "Next card");
    next.innerHTML = "\u203a";
    next.addEventListener("click", () => this._goTo(this._active + 1));

    row.append(prev, dots, next);
    copy.appendChild(row);
  }

  /** Begin cycling once the levels page is settled and visible. */
  private _start(): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.parentElement?.classList.add("wm-carousel-static");
      return;
    }
    if (this._dots.length === 0) this._createControls();
    this._cycle();
  }

  /** Stop all timers and frame callbacks (page left the screen). */
  private _stop(): void {
    clearTimeout(this._timer);
    cancelAnimationFrame(this._raf);
  }

  /** Centre the active card for DWELL ms, then advance to the next one. */
  private _cycle(): void {
    this._apply();
    this._startProgress();
    this._scheduleNext();
  }

  /** Jump to a slide on demand (control arrows or a tap on a dot). */
  private _goTo(index: number): void {
    this._active = ((index % 3) + 3) % 3;
    this._cycle();
  }

  /** Schedule the next auto-advance after the dwell. */
  private _scheduleNext(): void {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._active = (this._active + 1) % 3;
      this._cycle();
    }, DWELL);
  }

  /** Animate the active dot's fill over the dwell, driving it each frame. */
  private _startProgress(): void {
    cancelAnimationFrame(this._raf);
    const dot = this._dots[this._active];
    if (!dot) return;
    const start = performance.now();
    const tick = (now: number): void => {
      const p = Math.min(1, (now - start) / DWELL);
      dot.fill.style.width = `${(p * 100).toFixed(3)}%`;
      if (p < 1) this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  /** Place the cards in the carousel and sync the skeleton highlight. */
  private _apply(): void {
    const root = this.renderRoot;
    root
      .querySelectorAll<HTMLElement>(".cbtn--label, .repo, .wt")
      .forEach((el) => el.classList.remove("hl"));
    const sel = [".cbtn--label", ".repo", ".wt"][this._active];
    if (sel) root.querySelectorAll(sel).forEach((el) => el.classList.add("hl"));

    const cards = this.parentElement?.querySelectorAll<HTMLElement>(".wm-window-copy > p");
    if (cards) {
      const a = this._active;
      cards.forEach((card, i) => {
        card.classList.remove("wm-card-active", "wm-card-enter", "wm-card-exit", "wm-level-active");
        if (i === a) card.classList.add("wm-card-active", "wm-level-active");
        else if (i === (a + 1) % 3) card.classList.add("wm-card-enter");
        else card.classList.add("wm-card-exit");
      });
    }

    // Mark the active segment dot and reset every fill for the new dwell.
    this._dots.forEach((dot, i) => {
      dot.fill.style.width = "0";
      dot.root.classList.toggle("wm-carousel-dot--active", i === this._active);
    });
  }
}

customElements.define("openp41ge-stack-demo", Openp41geStackDemo);
