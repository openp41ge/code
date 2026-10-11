/**
 * <openp41ge-workspace-tab-demo> — an animated skeleton of the app's
 * Workspaces tab, used on the "Creating and opening a workspace" Welcome
 * slide. It shows the tab's toolbar (search) above a workspace-list row
 * (mini-window thumbnail, name, repository, worktrees and an open chevron),
 * with a bottom bar across the window holding the "New workspace" button.
 *
 * It also drives a card carousel of the five creation steps in the sibling
 * `.wm-window-copy` (the numbered list): the active step sits centred and the
 * others are invisible, with the cards crossfading between dwells. A set of
 * segmented dots counts down each dwell — the active step's dot widens and
 * fills — and the matching part of the skeleton lights up in sync: the
 * "New workspace" button, then the name, the repository, the worktrees, then
 * the thumbnail "opening". The carousel has forward/back controls plus tappable
 * dots to move between steps on demand.
 *
 * The animation only runs while the page is settled on screen: the
 * window-manager sets `active = true` once the slide has finished sliding in
 * and `false` as soon as it starts leaving, so no timers or animations run
 * while the page is hidden. With reduced motion it shows the built workspace
 * card with the steps stacked instead of crossfading.
 */

import { html, LitElement, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";

const STEPS = 5;
const DWELL = 6000; // ms each step stays centred

export class Openp41geWorkspaceTabDemo extends LitElement {
  @state() private _step = 0;
  @state() private _static = false;
  private _timer: ReturnType<typeof setTimeout> | undefined;
  private _raf = 0;
  private _dots: { root: HTMLDivElement; fill: HTMLDivElement }[] = [];
  private _running = false;

  /** Whether the step animation should be cycling (the page is visible). */
  get active(): boolean {
    return this._running;
  }
  set active(value: boolean) {
    if (this._running === value) return;
    this._running = value;
    if (value) this._start();
    else this._stop();
  }

  override firstUpdated(): void {
    // Tag the stage so the sibling numbered list renders as a carousel only
    // on this slide, mirroring how the levels demo tags its stage.
    this.parentElement?.classList.add("wm-creating");
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stop();
  }

  /** Begin cycling once the page is settled and visible. */
  private _start(): void {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // Reduced motion: show the built workspace and the steps stacked.
      this._static = true;
      this._step = STEPS - 1;
      this.parentElement?.classList.add("wm-carousel-static");
      this._apply();
      return;
    }
    if (this._dots.length === 0) this._createControls();
    this._step = 0;
    this._cycle();
  }

  /** Stop all timers and frame callbacks (page left the screen). */
  private _stop(): void {
    clearTimeout(this._timer);
    cancelAnimationFrame(this._raf);
  }

  /** Apply the current step, start its dwell, and schedule the advance. */
  private _cycle(): void {
    this._apply();
    this._startProgress();
    this._scheduleNext();
  }

  /** Jump to a step on demand (control arrows or a tap on a dot). */
  private _goTo(index: number): void {
    this._step = ((index % STEPS) + STEPS) % STEPS;
    this._cycle();
  }

  /** Schedule the next auto-advance after the dwell. */
  private _scheduleNext(): void {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => {
      this._step = (this._step + 1) % STEPS;
      this._cycle();
    }, DWELL);
  }

  /** Animate the active dot's fill over the dwell, driving it each frame. */
  private _startProgress(): void {
    cancelAnimationFrame(this._raf);
    const dot = this._dots[this._step];
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
    const cards = this.parentElement?.querySelectorAll<HTMLElement>(".wm-window-copy > ol > li");
    if (cards) {
      const a = this._step;
      cards.forEach((card, i) => {
        card.classList.remove("wm-card-active", "wm-card-enter", "wm-card-exit");
        if (i === a) card.classList.add("wm-card-active");
        else if (i === (a + 1) % STEPS) card.classList.add("wm-card-enter");
        else card.classList.add("wm-card-exit");
      });
    }

    // Mark the active segment dot and reset every fill for the new dwell.
    this._dots.forEach((dot, i) => {
      dot.fill.style.width = "0";
      dot.root.classList.toggle("wm-carousel-dot--active", i === this._step);
    });
  }

  /** Build the segmented-dot indicator and forward/back controls. */
  private _createControls(): void {
    const copy = this.parentElement?.querySelector<HTMLElement>(".wm-window-copy");
    if (!copy) return;
    const row = document.createElement("div");
    row.className = "wm-carousel-controls";

    const prev = document.createElement("button");
    prev.className = "wm-carousel-prev";
    prev.setAttribute("aria-label", "Previous step");
    prev.innerHTML = "\u2039";
    prev.addEventListener("click", () => this._goTo(this._step - 1));

    const dots = document.createElement("div");
    dots.className = "wm-carousel-dots";
    this._dots = [];
    for (let i = 0; i < STEPS; i++) {
      const dot = document.createElement("div");
      dot.className = "wm-carousel-dot";
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-label", `Go to step ${i + 1}`);
      dot.addEventListener("click", () => this._goTo(i));
      const fill = document.createElement("div");
      fill.className = "wm-carousel-dot-fill";
      dot.appendChild(fill);
      dots.appendChild(dot);
      this._dots.push({ root: dot, fill });
    }

    const next = document.createElement("button");
    next.className = "wm-carousel-next";
    next.setAttribute("aria-label", "Next step");
    next.innerHTML = "\u203a";
    next.addEventListener("click", () => this._goTo(this._step + 1));

    row.append(prev, dots, next);
    copy.appendChild(row);
  }

  private _wsRow(animated: boolean) {
    const s = this._step;
    const shown = (n: number) => !animated || this._static || s >= n;
    const hl = (n: number) => animated && !this._static && s === n;
    return html`
      <div class="row ${shown(1) ? "show" : ""}">
        <div class="thumb ${hl(4) ? "open" : ""}">
          <div class="thumb-chrome">
            <span class="thumb-dot"></span><span class="thumb-dot"></span
            ><span class="thumb-dot"></span>
          </div>
          <div class="thumb-body">
            <div class="thumb-side"></div>
            <div class="thumb-grid">
              <span class="thumb-cell"></span><span class="thumb-cell"></span
              ><span class="thumb-cell"></span>
            </div>
          </div>
        </div>
        <div class="info">
          <span class="title ${hl(1) ? "hl" : ""}"></span>
          <div class="meta ${shown(2) ? "show" : ""} ${hl(2) ? "hl" : ""}">
            <span class="repo"></span>
          </div>
          <div class="pills ${shown(3) ? "show" : ""} ${hl(3) ? "hl" : ""}">
            <span class="wt"></span><span class="wt"></span>
          </div>
        </div>
        <span class="chev ${hl(4) ? "hl" : ""}">›</span>
      </div>
    `;
  }

  override render(): TemplateResult {
    const s = this._step;
    // Blue highlight: exactly one step lights its matching element.
    const hl = (n: number): boolean => !this._static && s === n;
    return html`
      <style>
        :host {
          display: block;
        }
        .demo {
          height: 540px;
          display: flex;
          flex-direction: column;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          border-radius: 9px;
          overflow: hidden;
        }
        /* Small caption above the workspaces-tab skeleton. */
        .demo-caption {
          text-align: center;
          font-style: italic;
          font-size: 12px;
          color: var(--text-muted, #777);
          margin-bottom: 6px;
        }
        .toolbar {
          height: 34px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
        }
        .search {
          width: 150px;
          height: 14px;
          border-radius: 7px;
          background: var(--bg-active, #37373d);
          flex-shrink: 0;
        }
        /* Bottom bar of the window holds the "New workspace" action. */
        .bottom-bar {
          height: 30px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 0 12px;
          background: var(--bg-secondary, #161616);
          border-top: 1px solid var(--divider, #333);
        }
        .add {
          width: 28px;
          height: 20px;
          border-radius: 6px;
          background: var(--bg-active, #37373d);
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--text-secondary, #999);
          font-size: 12px;
          margin-left: auto;
          flex-shrink: 0;
          transition:
            background-color 0.4s ease,
            color 0.4s ease;
        }
        /* "New workspace" button — lights blue in step 1. */
        .add.hl {
          background: var(--accent, #79c0ff);
          color: #1e1e1e;
        }
        .list {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          padding: 10px 8px 4px;
        }
        .row {
          flex: 1;
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px 4px;
          border-bottom: 1px solid var(--divider, #2f3031);
          opacity: 0;
          transition: opacity 0.5s ease;
        }
        .row.show {
          opacity: 1;
        }
        /* Mini workspace-window thumbnail. */
        .thumb {
          position: relative;
          width: 132px;
          height: 78px;
          flex-shrink: 0;
          border-radius: 6px;
          background: var(--bg-secondary, #161616);
          border: 1px solid var(--divider, #444);
          overflow: hidden;
          display: flex;
          flex-direction: column;
          transition:
            border-color 0.4s ease,
            box-shadow 0.4s ease;
        }
        .thumb-chrome {
          height: 12px;
          flex-shrink: 0;
          background: var(--bg, #1e1e1e);
          border-bottom: 1px solid var(--divider, #333);
          display: flex;
          align-items: center;
          gap: 3px;
          padding: 0 5px;
        }
        .thumb-dot {
          width: 4px;
          height: 4px;
          border-radius: 50%;
          background: var(--text-secondary, #999);
          opacity: 0.55;
        }
        .thumb-body {
          flex: 1;
          min-height: 0;
          display: flex;
          gap: 3px;
          padding: 4px;
        }
        .thumb-side {
          width: 22px;
          flex-shrink: 0;
          border-radius: 3px;
          background: var(--bg, #1e1e1e);
        }
        .thumb-grid {
          flex: 1;
          min-width: 0;
          display: flex;
          gap: 3px;
        }
        .thumb-cell {
          flex: 1 1 8px;
          min-width: 0;
          border-radius: 3px;
          background: var(--bg-active, #2c2c31);
        }
        /* The workspace "opens" — thumbnail pulses blue in step 5. */
        .thumb.open {
          border-color: var(--accent, #79c0ff);
          animation: open-pulse 2.5s ease-in-out infinite;
        }
        @keyframes open-pulse {
          0%,
          100% {
            box-shadow: 0 0 0 2px rgba(86, 156, 214, 0);
          }
          50% {
            box-shadow: 0 0 0 3px rgba(86, 156, 214, 0.45);
          }
        }
        .info {
          flex: 1;
          min-width: 0;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        /* Workspace name. */
        .title {
          width: 92px;
          height: 11px;
          border-radius: 5px;
          background: var(--bg-active, #3a3a42);
          transition: background-color 0.4s ease;
        }
        .title.hl {
          background: var(--accent, #79c0ff);
        }
        /* Repository line. */
        .meta {
          display: flex;
          align-items: center;
          opacity: 0;
          transition: opacity 0.45s ease;
        }
        .meta.show {
          opacity: 1;
        }
        .meta .repo {
          width: 64px;
          height: 8px;
          border-radius: 4px;
          background: var(--bg-active, #383840);
          transition: background-color 0.4s ease;
        }
        .meta.show.hl .repo,
        .meta.hl .repo {
          background: var(--accent, #79c0ff);
        }
        /* Worktree chips. */
        .pills {
          display: flex;
          align-items: center;
          gap: 6px;
          opacity: 0;
          transition: opacity 0.45s ease;
        }
        .pills.show {
          opacity: 1;
        }
        .pills .wt {
          width: 26px;
          height: 10px;
          border-radius: 5px;
          background: var(--bg-active, #3a3a42);
          transition: background-color 0.4s ease;
        }
        .pills .wt:nth-child(2) {
          width: 18px;
        }
        .pills.hl .wt {
          background: var(--accent, #79c0ff);
        }
        .chev {
          flex-shrink: 0;
          font-size: 15px;
          color: var(--text-tertiary, #777);
          transition: color 0.4s ease;
        }
        .chev.hl {
          color: var(--accent, #79c0ff);
        }
      </style>
      <div class="demo-caption">Workspaces tab</div>
      <div class="demo">
        <div class="toolbar">
          <span class="search"></span>
        </div>
        <div class="list">
          ${this._wsRow(false)} ${this._wsRow(false)} ${this._wsRow(false)} ${this._wsRow(true)}
        </div>
        <div class="bottom-bar">
          <span class="add ${hl(0) ? "hl" : ""}">＋</span>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-workspace-tab-demo", Openp41geWorkspaceTabDemo);
