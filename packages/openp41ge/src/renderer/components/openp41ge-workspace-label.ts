/**
 * <openp41ge-workspace-label> — the title bar's workspace name, a button that
 * opens the workspace picker (plans/2026-10-14-one-window.md, step 4).
 *
 * The picker lists every workspace (the window's own marked), filtered as you
 * type, and "No workspace" when the window has one. Picking one replaces the
 * window's workspace: the window reloads as a window of it. When the window
 * has unsaved files it asks first, since they would be lost.
 *
 * Test seam: the static `deps`.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { createLogger } from "openp41ge-core-logger";
import type { WorkspaceFileData } from "../../layout/types";
import { workspaceFileService } from "../services/workspace-file-service";
import { showConfirm } from "../confirm-service";
import { getWorkspace } from "../app";

const log = createLogger("openp41ge", "workspace-label");

const WORKSPACE_CHANGED_EVENT = "workspace-file-changed";

/** One workspace the picker offers. */
interface PickerWorkspace {
  readonly filePath: string;
  readonly data: WorkspaceFileData;
}

/** What the label reads and does (injectable for tests). */
export interface WorkspaceLabelDeps {
  /** The window's workspace: its file (null: none) and name. */
  current(): { path: string | null; name: string };
  list(): Promise<readonly PickerWorkspace[]>;
  /** Replace the window's workspace (null: none). */
  switchTo(path: string | null): Promise<boolean>;
  /** How many files open in this window have unsaved changes. */
  unsavedFiles(): number;
  confirm(message: string, detail: string): Promise<boolean>;
}

const DEFAULT_DEPS: WorkspaceLabelDeps = {
  current: () => ({
    path: window.openp41ge?.workspace?.getWorkspacePath?.() ?? null,
    name: workspaceFileService.openWorkspaceName,
  }),
  list: () => workspaceFileService.listWorkspaces(),
  switchTo: async (path) =>
    (await window.openp41ge?.windowManager?.switchWorkspace?.(path)) ?? false,
  unsavedFiles: () => {
    const ws = getWorkspace();
    const winId = window.openp41ge?.workspace?.getWindowId?.();
    const win = ws?.windows.find((w) => w.id === winId);
    if (!ws || !win) return 0;
    return win.grid.placements
      .flatMap((p) => p.tabIds)
      .filter((id) => ws.editorTabs[id]?.config?.isDirty === true).length;
  },
  confirm: (message, detail) =>
    showConfirm({ message, detail, confirmLabel: "Switch", confirmStyle: "danger" }),
};

const nameOf = (w: PickerWorkspace): string => w.data.name?.trim() || "Unnamed";

const STYLE_ATTR = "data-openp41ge-workspace-label";
const STYLES = `
openp41ge-workspace-label { position: relative; display: flex; align-items: center; height: 100%; }
openp41ge-workspace-label .wl-button { display: flex; align-items: center; gap: 4px; max-width: min(220px, calc((100vw - 270px) / 2)); height: 26px; padding: 0 8px; border: none; border-radius: 5px; background: transparent; color: var(--text-muted, #888); font-size: 12px; font-family: inherit; cursor: pointer; -webkit-app-region: no-drag; user-select: none; white-space: nowrap; }
openp41ge-workspace-label .wl-button:hover, openp41ge-workspace-label .wl-button[aria-expanded="true"] { background: var(--bg-hover, #2a2d2e); color: var(--text-primary, #ddd); }
openp41ge-workspace-label .wl-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
openp41ge-workspace-label .wl-caret { flex: none; font-size: 9px; opacity: 0.7; }
openp41ge-workspace-label .wl-mask { position: fixed; inset: 0; z-index: 9999; -webkit-app-region: no-drag; }
openp41ge-workspace-label .wl-panel { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10000; width: 280px; max-height: 60vh; display: flex; flex-direction: column; background: var(--bg-tertiary, #252526); border: 1px solid var(--border-divider, #3a3a3a); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); overflow: hidden; -webkit-app-region: no-drag; }
openp41ge-workspace-label .wl-filter { flex: none; margin: 8px; padding: 6px 10px; border: 1px solid var(--border-divider, #333); border-radius: 5px; background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #d4d4d4); font-size: 12px; font-family: inherit; outline: none; }
openp41ge-workspace-label .wl-filter:focus { border-color: var(--accent, #4fc1ff); }
openp41ge-workspace-label .wl-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 0 6px; }
openp41ge-workspace-label .wl-item { display: flex; align-items: center; gap: 8px; padding: 6px 14px; font-size: 13px; color: var(--text-primary, #ddd); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
openp41ge-workspace-label .wl-item:hover { background: var(--bg-hover, #2a2d2e); }
openp41ge-workspace-label .wl-item--current { font-weight: 600; }
openp41ge-workspace-label .wl-item--current::after { content: "✓"; margin-left: auto; color: var(--accent, #4fc1ff); }
openp41ge-workspace-label .wl-item--none { border-top: 1px solid var(--border-divider, #333); margin-top: 6px; padding-top: 8px; color: var(--text-secondary, #aaa); }
openp41ge-workspace-label .wl-empty { padding: 8px 14px; font-size: 12px; color: var(--text-muted, #888); font-style: italic; }
`;

export class Openp41geWorkspaceLabel extends LitElement {
  static override properties = {
    _open: { state: true },
    _workspaces: { state: true },
    _query: { state: true },
  };

  /** Test seam: replaces the defaults when set. */
  static deps: WorkspaceLabelDeps | null = null;

  declare private _open: boolean;
  declare private _workspaces: readonly PickerWorkspace[];
  declare private _query: string;

  constructor() {
    super();
    this._open = false;
    this._workspaces = [];
    this._query = "";
  }

  private get _deps(): WorkspaceLabelDeps {
    return Openp41geWorkspaceLabel.deps ?? DEFAULT_DEPS;
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
    document.addEventListener(WORKSPACE_CHANGED_EVENT, this._onUpdate);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(WORKSPACE_CHANGED_EVENT, this._onUpdate);
  }

  private _onUpdate = (): void => {
    this.requestUpdate();
  };

  private async _toggle(): Promise<void> {
    if (this._open) {
      this._close();
      return;
    }
    this._query = "";
    this._open = true;
    try {
      this._workspaces = await this._deps.list();
    } catch (err) {
      log.error("workspace picker could not list workspaces:", err, { skipToast: true });
      this._workspaces = [];
    }
    await this.updateComplete;
    this.querySelector<HTMLInputElement>(".wl-filter")?.focus();
  }

  private _close(): void {
    this._open = false;
  }

  private async _pick(path: string | null): Promise<void> {
    const { path: current } = this._deps.current();
    this._close();
    if (path === current) return;
    const unsaved = this._deps.unsavedFiles();
    if (unsaved > 0) {
      const files = unsaved === 1 ? "1 file has" : `${unsaved} files have`;
      const ok = await this._deps.confirm(
        "Switch workspace and lose unsaved changes?",
        `${files} unsaved changes in this window. Switching closes them without saving.`,
      );
      if (!ok) return;
    }
    try {
      await this._deps.switchTo(path);
    } catch (err) {
      log.error("workspace switch failed:", err);
    }
  }

  private _panel(): TemplateResult {
    const { path: current } = this._deps.current();
    const q = this._query.trim().toLowerCase();
    const shown = q
      ? this._workspaces.filter((w) => nameOf(w).toLowerCase().includes(q))
      : this._workspaces;
    return html`
      <div class="wl-mask" @mousedown=${() => this._close()}></div>
      <div class="wl-panel" role="dialog" aria-label="Choose a workspace">
        <input
          class="wl-filter"
          placeholder="Find a workspace…"
          spellcheck="false"
          .value=${this._query}
          @input=${(e: Event) => (this._query = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => {
            if (e.key === "Escape") {
              e.preventDefault();
              this._close();
            } else if (e.key === "Enter" && shown.length > 0) {
              e.preventDefault();
              void this._pick(shown[0].filePath);
            }
          }}
        />
        <div class="wl-list" role="listbox">
          ${
            shown.length === 0
              ? html`<div class="wl-empty">No workspaces match.</div>`
              : shown.map(
                  (w) => html`
                    <div
                      class="wl-item ${w.filePath === current ? "wl-item--current" : ""}"
                      role="option"
                      aria-selected=${w.filePath === current}
                      @click=${() => void this._pick(w.filePath)}
                    >
                      ${nameOf(w)}
                    </div>
                  `,
                )
          }
          ${
            current !== null && !q
              ? html`<div
                  class="wl-item wl-item--none"
                  role="option"
                  @click=${() => void this._pick(null)}
                >
                  No workspace
                </div>`
              : nothing
          }
        </div>
      </div>
    `;
  }

  override render(): TemplateResult {
    const { name } = this._deps.current();
    return html`
      <button
        class="wl-button"
        aria-haspopup="dialog"
        aria-expanded=${this._open}
        title="Switch workspace"
        @click=${() => void this._toggle()}
      >
        <span class="wl-name">${name}</span><span class="wl-caret">▾</span>
      </button>
      ${this._open ? this._panel() : nothing}
    `;
  }
}

if (!customElements.get("openp41ge-workspace-label")) {
  customElements.define("openp41ge-workspace-label", Openp41geWorkspaceLabel);
}
