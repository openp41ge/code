/**
 * <openp41ge-sidebar-tab-content> — a reusable sidebar-tab shell.
 *
 * Owns the two things every sidebar tab needs:
 *  1. A scrollable content region (the default slot) scrolled by the shared
 *     `OverlayScrollbar` (the same floating auto-hide scrollbar the built-in
 *     explorer uses), so callers never wire up `overflow:auto` themselves.
 *  2. A bottom bar (footer) that accepts imperatively-registered buttons via
 *     `registerBottomBarButton()` / `removeBottomBarButton()` /
 *     `clearBottomBarButtons()`. This lets a tab surface (or a controller)
 *     declare its footer actions without shipping its own bar HTML.
 *
 * Usage:
 *   <openp41ge-sidebar-tab-content>
 *     <my-tab-content></my-tab-content>   <!-- scrolls inside -->
 *   </openp41ge-sidebar-tab-content>
 *
 *   const el = …;
 *   const unreg = el.registerBottomBarButton({
 *     id: "settings",
 *     icon: "settings",
 *     title: "Settings",
 *     onClick: () => openSettings(),
 *   });
 */

import { LitElement, html, nothing, type PropertyValues } from "lit";
import { state } from "lit/decorators.js";
import { createRef, ref } from "lit/directives/ref.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { OverlayScrollbar } from "openp41ge-core-scrollbar";
import { iconRegistry, type IconName } from "../../icons/registry";
import { tooltipContent } from "../tooltip/tooltip-directive";

/** A single bottom-bar button definition registered against the element. */
export interface SidebarTabBarButton {
  /** Stable id. Re-registering the same id replaces the existing button. */
  readonly id: string;
  /** Optional icon from the shared icon registry. */
  readonly icon?: IconName;
  /** Optional short text label rendered beside the icon. */
  readonly label?: string;
  /** Tooltip (the app's tooltip) and accessible label; the accessible label
   *  defaults to `label` then `id`. */
  readonly title?: string;
  /** Draw a vertical separator immediately before this button (in addition to
   *  the automatic boxed separators). */
  readonly separatorBefore?: boolean;
  readonly onClick?: () => void;
}

const BAR_HEIGHT = 34;

/** Styles are inlined into `render()` (not `static styles`) following the
 *  same pattern as `openp41ge-icon` — the app's bundler applies these reliably
 *  to shadow roots across the one-copy runtime. */
const TAB_STYLES = `
  :host {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    overflow: hidden;
    background: var(--bg-secondary, var(--fe-bg, #1e1e1e));
    color: var(--text-primary, var(--text-secondary, #d4d4d4));
    font-family: var(--font-ui, system-ui, sans-serif);
  }

  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .content {
    height: 100%;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .bottom-bar {
    flex: none;
    display: flex;
    align-items: stretch;
    height: ${BAR_HEIGHT}px;
    /* border-box so the 1px top border is inside the 34px — matching the
       built-in explorer's sb-bottom-bar and the grid cell's openp41ge-bottom-bar
       (both 34px total). Without it the bar renders 35px (34px content + 1px
       border), 1px taller than the grid cell's bar. */
    box-sizing: border-box;
    padding: 0;
    border-top: 1px solid var(--border-divider, #333);
    background: var(--bg-secondary, #161616);
    color: var(--text-secondary, #999999);
    user-select: none;
  }

  .bar-group {
    flex: none;
    display: flex;
    align-items: stretch;
  }

  .spacer {
    flex: 1 1 auto;
  }

  .sep {
    width: 1px;
    height: 100%;
    background: var(--border-divider, #333);
  }

  /* Full-height, square footer buttons (matching the built-in explorer's
     .p41ge-icon-btn): they fill the whole bar vertically and their width
     equals their height. */
  .bar-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    aspect-ratio: 1 / 1;
    padding: 0;
    border: none;
    border-radius: 0;
    background: transparent;
    color: inherit;
    cursor: pointer;
    font: inherit;
    font-size: 11px;
    flex-shrink: 0;
    box-sizing: border-box;
  }

  /* Boxed buttons: every button carries a 1px separator on its left, and the
     last button caps the run on its right, so each tile is bounded by
     separator lines on both sides (and the bar's top border above). */
  .bar-btn {
    border-left: 1px solid var(--border-divider, #333);
  }

  .bar-btn:last-child {
    border-right: 1px solid var(--border-divider, #333);
  }

  /* The button run is docked against the sidebar's INNER edge, which already
     carries the sidebar's own 1px border. Drop the button border on that dock
     edge so it does not stack into a double border with the sidebar: the first
     button's left border for a right-docked sidebar, the last button's right
     border for a left-docked one. */
  .bottom-bar[data-docked="right"] .bar-btn:first-child {
    border-left: none;
  }

  .bottom-bar[data-docked="left"] .bar-btn:last-child {
    border-right: none;
  }

  .bar-btn:hover {
    color: var(--text-primary, #ffffff);
    background: var(--bg-hover, #2a2d2e);
  }

  .bar-btn:active {
    background: var(--bg-hover, #2a2d2e);
  }

  .bar-btn:focus-visible {
    outline: 1px solid var(--accent, #3772ff);
    outline-offset: -1px;
  }

  .bar-btn svg {
    display: block;
    flex: none;
  }
`;

export class SidebarTabContent extends LitElement {
  /** Imperatively-registered bottom-bar buttons. */
  @state() private _buttons: SidebarTabBarButton[] = [];

  private _viewportRef = createRef<HTMLElement>();
  private _contentRef = createRef<HTMLElement>();
  private _scrollbar: OverlayScrollbar | null = null;

  /** Which window edge this sidebar is docked to. The bottom-bar buttons are
   *  aligned to the INSIDE edge (the edge facing the grid): the right edge for
   *  a left sidebar, the left edge for a right sidebar. Detected from this
   *  element's position (see `_updateDock`); default "right" pre-layout. */
  private _docked: "left" | "right" = "right";

  private _onResize = (): void => {
    this._updateDock();
  };

  createRenderRoot() {
    return this.attachShadow({ mode: "open" });
  }

  connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener("resize", this._onResize);
  }

  render() {
    const buttons = this._buttons.map((b) => this._renderButton(b));
    // Dock the button run against the bar's INSIDE edge. For a right-docked
    // sidebar that's the left edge (run first, spacer after); for a
    // left-docked sidebar it's the right edge (spacer first, run at the end).
    const dockLeft = this._docked === "right";
    return html`
      <style>
        ${TAB_STYLES}
      </style>
      <div class="viewport" part="viewport" ${ref(this._viewportRef)}>
        <div class="content" part="content" ${ref(this._contentRef)}>
          <slot></slot>
        </div>
      </div>
      <div class="bottom-bar" part="bottom-bar" data-docked=${this._docked}>
        ${dockLeft ? nothing : html`<span class="spacer"></span>`}
        <div class="bar-group" part="bar-group">${buttons}</div>
        ${dockLeft ? html`<span class="spacer"></span>` : nothing}
      </div>
    `;
  }

  protected firstUpdated(_changed: PropertyValues): void {
    super.firstUpdated(_changed);
    this._updateDock();
    this._attachScrollbar();
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener("resize", this._onResize);
    this._scrollbar?.destroy();
    this._scrollbar = null;
  }

  /**
   * Register a bottom-bar button. Registering an existing `id` replaces the
   * prior button in place. Returns an unregister function.
   */
  registerBottomBarButton(spec: SidebarTabBarButton): () => void {
    const idx = this._buttons.findIndex((b) => b.id === spec.id);
    if (idx >= 0) {
      const next = this._buttons.slice();
      next[idx] = spec;
      this._buttons = next;
    } else {
      this._buttons = [...this._buttons, spec];
    }
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.removeBottomBarButton(spec.id);
    };
  }

  /** Remove a previously-registered bottom-bar button by id. */
  removeBottomBarButton(id: string): void {
    const idx = this._buttons.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const next = this._buttons.slice();
    next.splice(idx, 1);
    this._buttons = next;
  }

  /** Remove every registered bottom-bar button. */
  clearBottomBarButtons(): void {
    if (this._buttons.length) this._buttons = [];
  }

  private _renderButton(b: SidebarTabBarButton) {
    const svg = b.icon ? iconRegistry[b.icon]?.(14) : null;
    const label = b.title ?? b.label ?? b.id;
    return html`
      ${b.separatorBefore ? html`<span class="sep" aria-hidden="true"></span>` : nothing}
      <button
        type="button"
        class="bar-btn"
        part="bar-button"
        aria-label=${label}
        ${b.title ? tooltipContent({ type: "simple", text: b.title }) : nothing}
        @click=${() => b.onClick?.()}
      >
        ${svg ? html`${unsafeHTML(svg)}` : nothing}
        ${b.label ? html`<span>${b.label}</span>` : nothing}
      </button>
    `;
  }

  private _attachScrollbar(): void {
    const content = this._contentRef.value;
    const viewport = this._viewportRef.value;
    if (!content || this._scrollbar) return;
    this._scrollbar = OverlayScrollbar.attach(content, {
      axis: "vertical",
      container: viewport ?? undefined,
      autoHide: true,
      autoHideDelay: 600,
      // Keep the thumb the same width as its track: the track strip is drawn
      // at the hover size, so match it so the thumb is flush with it at rest
      // (same choice the built-in explorer makes).
      size: 10,
      hoverSize: 10,
      styleTarget: this.shadowRoot ?? undefined,
    });
  }

  /** Recompute which window edge this sidebar is docked to. */
  private _updateDock(): void {
    const r = this.getBoundingClientRect();
    if (!r.width) return;
    const next = r.left + r.width / 2 < window.innerWidth / 2 ? "left" : "right";
    if (next !== this._docked) {
      this._docked = next;
      this.requestUpdate();
    }
  }
}

if (!customElements.get("openp41ge-sidebar-tab-content")) {
  customElements.define("openp41ge-sidebar-tab-content", SidebarTabContent);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-sidebar-tab-content": SidebarTabContent;
  }
}
