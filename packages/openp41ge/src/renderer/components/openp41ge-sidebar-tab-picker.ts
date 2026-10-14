/**
 * <openp41ge-sidebar-tab-picker> — the sidebar's + picker: a filter field,
 * then the sidebar tabs in groups (System, Workspace, Logs; empty groups
 * hidden). A row (or Enter, for the first match) runs its action and closes
 * the picker; Escape or a click outside closes it. Styled like the title bar's
 * workspace picker.
 *
 * Positioned at (`x`, `y`) in the viewport (kept on screen). Renders into its
 * light DOM, with its styles added once to the document or shadow root it is
 * in.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { SIDEBAR_TAB_GROUPS, type SidebarTabGroup } from "../controllers/types";

/** One tab the picker offers. */
export interface SidebarTabPickerItem {
  readonly label: string;
  readonly group: SidebarTabGroup;
  /** Short text after the label (e.g. the sides it is already open on). */
  readonly badge?: string;
  readonly action: () => void;
}

const PANEL_WIDTH = 260;

const STYLE_ATTR = "data-openp41ge-sidebar-tab-picker";
const STYLES = `
openp41ge-sidebar-tab-picker .stp-mask { position: fixed; inset: 0; z-index: 9999; }
openp41ge-sidebar-tab-picker .stp-panel { position: fixed; z-index: 10000; width: ${PANEL_WIDTH}px; max-height: 70vh; display: flex; flex-direction: column; background: var(--bg-tertiary, #252526); border: 1px solid var(--border-divider, #3a3a3a); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); overflow: hidden; }
openp41ge-sidebar-tab-picker .stp-filter { flex: none; margin: 8px; padding: 6px 10px; border: 1px solid var(--border-divider, #333); border-radius: 5px; background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #d4d4d4); font-size: 12px; font-family: inherit; outline: none; }
openp41ge-sidebar-tab-picker .stp-filter:focus { border-color: var(--accent, #4fc1ff); }
openp41ge-sidebar-tab-picker .stp-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 8px; }
openp41ge-sidebar-tab-picker .stp-heading { padding: 8px 10px 4px; font-size: 10px; font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase; color: var(--text-muted, #888); }
openp41ge-sidebar-tab-picker .stp-row { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 5px; font-size: 13px; color: var(--text-primary, #ddd); cursor: pointer; white-space: nowrap; }
openp41ge-sidebar-tab-picker .stp-row:hover { background: color-mix(in srgb, var(--text-primary, #ddd) 12%, transparent); }
openp41ge-sidebar-tab-picker .stp-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
openp41ge-sidebar-tab-picker .stp-badge { flex-shrink: 0; margin-left: auto; padding: 0 6px; border-radius: 4px; background: var(--bg-active, #3f3f3f); font-size: 10px; color: var(--text-secondary, #aaa); }
openp41ge-sidebar-tab-picker .stp-empty { padding: 8px 10px; font-size: 12px; color: var(--text-muted, #888); font-style: italic; }
`;

export class Openp41geSidebarTabPicker extends LitElement {
  static override properties = { _query: { state: true } };

  /** Where the panel's top-left goes (viewport px). */
  x = 0;
  y = 0;
  items: readonly SidebarTabPickerItem[] = [];
  /** Called once the picker closes (picked or dismissed). */
  onclose: (() => void) | null = null;

  declare private _query: string;

  constructor() {
    super();
    this._query = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const root = this.getRootNode() as Document | ShadowRoot;
    const parent = root instanceof Document ? root.head : root;
    if (parent && !parent.querySelector(`style[${STYLE_ATTR}]`)) {
      const style = document.createElement("style");
      style.setAttribute(STYLE_ATTR, "");
      style.textContent = STYLES;
      parent.appendChild(style);
    }
  }

  override firstUpdated(): void {
    this.querySelector<HTMLInputElement>(".stp-filter")?.focus();
  }

  /** Close the picker (removing it). */
  close(): void {
    this.remove();
    this.onclose?.();
  }

  private _run(item: SidebarTabPickerItem): void {
    this.close();
    item.action();
  }

  /** The items the filter shows, in group order. */
  private _shown(): Array<[SidebarTabGroup, SidebarTabPickerItem[]]> {
    const q = this._query.trim().toLowerCase();
    const match = (i: SidebarTabPickerItem) => !q || i.label.toLowerCase().includes(q);
    return SIDEBAR_TAB_GROUPS.map((g): [SidebarTabGroup, SidebarTabPickerItem[]] => [
      g,
      this.items.filter((i) => i.group === g && match(i)),
    ]).filter(([, items]) => items.length > 0);
  }

  override render(): TemplateResult {
    const shown = this._shown();
    const left = Math.max(8, Math.min(this.x, window.innerWidth - PANEL_WIDTH - 8));
    return html`
      <div class="stp-mask" @mousedown=${() => this.close()}></div>
      <div
        class="stp-panel"
        role="dialog"
        aria-label="Open a sidebar tab"
        style="left:${left}px;top:${this.y}px"
      >
        <input
          class="stp-filter"
          placeholder="Find a tab…"
          spellcheck="false"
          .value=${this._query}
          @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Escape") {
              e.preventDefault();
              this.close();
            } else if (e.key === "Enter") {
              const first = shown[0]?.[1][0];
              if (!first) return;
              e.preventDefault();
              this._run(first);
            }
          }}
        />
        <div class="stp-list" role="listbox">
          ${
            shown.length === 0
              ? html`<div class="stp-empty">No tabs match.</div>`
              : shown.map(
                  ([group, items]) => html`
                    <div class="stp-group" role="group" aria-label=${group}>
                      <div class="stp-heading">${group}</div>
                      ${items.map(
                        (item) => html`
                          <div class="stp-row" role="option" @click=${() => this._run(item)}>
                            <span class="stp-label">${item.label}</span>
                            ${
                              item.badge
                                ? html`<span class="stp-badge">${item.badge}</span>`
                                : nothing
                            }
                          </div>
                        `,
                      )}
                    </div>
                  `,
                )
          }
        </div>
      </div>
    `;
  }
}

if (!customElements.get("openp41ge-sidebar-tab-picker")) {
  customElements.define("openp41ge-sidebar-tab-picker", Openp41geSidebarTabPicker);
}
