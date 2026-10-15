/**
 * workspace-bottom-bar.ts — reusable bottom bar for the workspace editor.
 *
 * A lit custom element (`<we-bottom-bar>`) modeled on the platform's status
 * bars (`fe-status-bar`): a right-aligned row of square, full-height icon
 * buttons. An optional left-hand status label can be supplied via the
 * `status` property.
 *
 * Buttons are **registered** into the bar via `addButton()` / `removeButton()`
 * (or supplied declaratively through the `buttons` property, which reconciles
 * through the same registry). `setStatus()` updates the left-hand label.
 *
 * Button styling mirrors the platform's `p41ge-icon-btn`:
 *   - SQUARE + FULL HEIGHT: each button is exactly the bar's 34px height.
 *   - A 1px vertical separator between adjacent buttons, plus a cap separator
 *     splitting the button group off from the empty remainder of the bar.
 *   - A button with `highlight` set renders its icon in the accent (e.g. blue
 *     for the Save button when there are unsaved changes).
 *   - A button that sits flush against the window's rounded corner is pushed
 *     8px in from that corner so its icon clears the rounded edge. The pad is
 *     re-derived on every style pass from the `--grid-edge-*-pad` custom
 *     properties the grid publishes on the cell (8px when the cell touches a
 *     rounded corner, 0px otherwise).
 */

import { html, LitElement, nothing, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

/** One registered button in the bar. */
export interface WorkspaceBottomBarButton {
  /** Stable id — re-adding with the same id replaces the button. */
  readonly id: string;
  /** SVG markup for the icon, rendered via `unsafeHTML`. */
  readonly icon: string;
  readonly title?: string;
  readonly onClick: () => void;
  readonly disabled?: boolean;
  /** Render the icon in the accent colour (e.g. blue Save when dirty). */
  readonly highlight?: boolean;
}

@customElement("we-bottom-bar")
export class WorkspaceBottomBar extends LitElement {
  /** Optional left-hand status text. */
  @property({ attribute: false }) status = "";

  /** The currently registered buttons (declarative path: set this to the full
   *  desired list, e.g. `.buttons=${[...]}`). */
  @property({ attribute: false }) buttons: WorkspaceBottomBarButton[] = [];

  /** Register (or replace) a button. */
  addButton(btn: WorkspaceBottomBarButton): void {
    const idx = this.buttons.findIndex((b) => b.id === btn.id);
    this.buttons =
      idx >= 0 ? this.buttons.map((b, i) => (i === idx ? btn : b)) : [...this.buttons, btn];
  }

  /** Remove a registered button by id. */
  removeButton(id: string): void {
    this.buttons = this.buttons.filter((b) => b.id !== id);
  }

  /** Set the left-hand status text (pass "" to hide it). */
  setStatus(text: string): void {
    this.status = text;
  }

  render(): TemplateResult {
    return html`
      <style>
        :host {
          display: block;
          flex-shrink: 0;
        }
        /* The bar is drawn on this inner element, not the host: document
           styles (the platform's global reset, \`* { border-width: 0 }\`)
           reach the host element and would remove its border, but not into
           the shadow root. */
        .wbb-bar {
          display: flex;
          align-items: stretch;
          height: 34px;
          /* The 1px top border is included so the bar is exactly 34px tall
             (platform chrome bars are 34px, border-box). */
          box-sizing: border-box;
          background: var(--bg-secondary, #161616);
          border-top: 1px solid var(--border-divider, #2a2a2a);
          color: var(--text-secondary, #999);
          font-size: 11px;
          user-select: none;
        }
        .wbb-status {
          flex: 1 1 auto;
          min-width: 0;
          display: flex;
          align-items: center;
          padding: 0 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          color: var(--text-secondary, #999);
        }
        /* Square, full-height icon buttons (34px = the bar height). */
        .wbb-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          /* Fill the bar's content height (33px = 34px minus the 1px border)
             and stay square via the aspect ratio — mirrors p41ge-icon-btn. */
          height: 100%;
          aspect-ratio: 1 / 1;
          padding: 0;
          border: none;
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
          -webkit-app-region: no-drag;
        }
        .wbb-btn:hover {
          background: var(--bg-hover, #2a2d2e);
          color: var(--text-primary, #fff);
        }
        .wbb-btn:disabled {
          opacity: 0.4;
          cursor: default;
        }
        .wbb-btn svg {
          display: block;
          width: 16px;
          height: 16px;
        }
        /* Push the button group right when there is no status label. */
        .wbb-btn:first-of-type {
          margin-left: auto;
        }
        /* Separator between adjacent buttons. */
        .wbb-btn + .wbb-btn {
          border-left: 1px solid var(--divider, #333);
        }
        /* Cap separator between the group's outer edge and the empty bar
           space. */
        .wbb-btn:first-of-type {
          border-left: 1px solid var(--divider, #333);
        }
        /* Highlighted button (unsaved Save / active JSON toggle): tint the
           icon with the accent colour. */
        .wbb-btn.is-highlighted {
          color: var(--accent, #4a9eff);
        }
        .wbb-btn.is-highlighted:hover {
          color: var(--accent, #4a9eff);
          background: var(--bg-hover, #2a2d2e);
        }
        /* The corner button: push the icon 8px in from the window's rounded
           corner. The grid publishes --grid-edge-right-pad (8px when this
           cell is flush with a rounded right corner, 0px otherwise), so the
           pad is re-derived on every style pass. */
        .wbb-btn:last-of-type {
          box-sizing: content-box;
          padding-right: var(--grid-edge-right-pad, 0px);
        }
      </style>
      <div class="wbb-bar">
        ${this.status ? html`<span class="wbb-status">${this.status}</span>` : nothing}
        ${this.buttons.map(
          (b) => html`
            <button
              type="button"
              class="wbb-btn ${b.highlight ? "is-highlighted" : ""}"
              title=${b.title ?? ""}
              ?disabled=${!!b.disabled}
              @click=${() => b.onClick()}
            >
              ${unsafeHTML(b.icon)}
            </button>
          `,
        )}
      </div>
    `;
  }
}
