/**
 * <openp41ge-workspace-label> — the title bar's workspace name, a button that
 * opens the workspace picker.
 *
 * The picker lists every workspace (the window's own marked), filtered as you
 * type, and — when the window has one — a red "Close workspace" button.
 * Picking one replaces the
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

/** How long Close workspace is held (its background filling) before it closes. */
export const CLOSE_HOLD_MS = 900;

const STYLE_ATTR = "data-openp41ge-workspace-label";
const STYLES = `
openp41ge-workspace-label { position: relative; display: flex; align-items: center; height: 100%; }
openp41ge-workspace-label .wl-button { display: flex; align-items: center; gap: 4px; max-width: min(220px, calc((100vw - 270px) / 2)); height: 26px; padding: 0 8px; border: none; border-radius: 5px; background: transparent; color: var(--text-muted, #888); font-size: 12px; font-family: inherit; cursor: pointer; -webkit-app-region: no-drag; user-select: none; white-space: nowrap; }
openp41ge-workspace-label .wl-button:hover, openp41ge-workspace-label .wl-button[aria-expanded="true"] { background: var(--bg-hover, #2a2d2e); color: var(--text-primary, #ddd); }
openp41ge-workspace-label .wl-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
openp41ge-workspace-label .wl-mask { position: fixed; inset: 0; z-index: 9999; -webkit-app-region: no-drag; }
openp41ge-workspace-label .wl-panel { position: absolute; top: calc(100% + 4px); right: 0; z-index: 10000; width: 280px; max-height: 60vh; display: flex; flex-direction: column; background: var(--bg-tertiary, #252526); border: 1px solid var(--border-divider, #3a3a3a); border-radius: 8px; box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5); overflow: hidden; -webkit-app-region: no-drag; }
openp41ge-workspace-label .wl-filter { flex: none; margin: 8px; padding: 6px 10px; border: 1px solid var(--border-divider, #333); border-radius: 5px; background: var(--bg-primary, #1e1e1e); color: var(--text-primary, #d4d4d4); font-size: 12px; font-family: inherit; outline: none; }
openp41ge-workspace-label .wl-filter:focus { border-color: var(--accent, #4fc1ff); }
openp41ge-workspace-label .wl-list { flex: 1; min-height: 0; overflow-y: auto; padding: 0 8px 2px; }
openp41ge-workspace-label .wl-item { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-radius: 5px; font-size: 13px; color: var(--text-primary, #ddd); cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
openp41ge-workspace-label .wl-item:hover { background: color-mix(in srgb, var(--text-primary, #ddd) 12%, transparent); }
openp41ge-workspace-label .wl-item--current { font-weight: 600; }
openp41ge-workspace-label .wl-item-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
openp41ge-workspace-label .wl-active { flex-shrink: 0; margin-left: auto; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 600; letter-spacing: 0.04em; background: rgba(111, 200, 114, 0.16); color: #6fc872; }
openp41ge-workspace-label .wl-foot { flex: none; padding: 8px; }
openp41ge-workspace-label .wl-close { width: 100%; padding: 6px 10px; border: 1px solid color-mix(in srgb, var(--accent-error, #f44747) 35%, transparent); border-radius: 5px; background: color-mix(in srgb, var(--accent-error, #f44747) 8%, transparent); color: color-mix(in srgb, var(--accent-error, #f44747) 70%, var(--text-primary, #ddd)); font-size: 12px; font-family: inherit; cursor: pointer; }
openp41ge-workspace-label .wl-close:hover { background: color-mix(in srgb, var(--accent-error, #f44747) 16%, transparent); }
openp41ge-workspace-label .wl-close { position: relative; overflow: hidden; isolation: isolate; user-select: none; }
openp41ge-workspace-label .wl-close-label { position: relative; z-index: 1; }
openp41ge-workspace-label .wl-close-fill { position: absolute; z-index: 0; width: 0; height: 0; border-radius: 50%; pointer-events: none; background: color-mix(in srgb, var(--accent-error, #f44747) 32%, transparent); transform: translate(-50%, -50%) scale(0); transition: transform 180ms ease-out; }
openp41ge-workspace-label .wl-close.is-holding .wl-close-fill { transform: translate(-50%, -50%) scale(1); transition: transform ${CLOSE_HOLD_MS}ms linear; }
openp41ge-workspace-label .wl-empty { padding: 8px 10px; font-size: 12px; color: var(--text-muted, #888); font-style: italic; }
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
    this._cancelHold();
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
    this._cancelHold();
    this._open = false;
  }

  // ── Close workspace: a long press ─────────────────────────────────────

  private _holdTimer: ReturnType<typeof setTimeout> | null = null;

  /** Press: the background fills, as a circle growing from the press point
   *  to the button's farthest corner; full, the workspace closes. */
  private readonly _onCloseDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const button = e.currentTarget as HTMLElement;
    const fill = button.querySelector<HTMLElement>(".wl-close-fill");
    const r = button.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    const reach = Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
    if (fill) {
      fill.style.left = `${x}px`;
      fill.style.top = `${y}px`;
      fill.style.width = fill.style.height = `${reach * 2}px`;
    }
    this._cancelHold();
    button.classList.add("is-holding");
    this._holdTimer = setTimeout(() => {
      this._holdTimer = null;
      button.classList.remove("is-holding");
      void this._pick(null);
    }, CLOSE_HOLD_MS);
  };

  /** Release or leave before it is full: the fill drains, nothing closes. */
  private readonly _onCloseUp = (e: Event): void => {
    (e.currentTarget as HTMLElement).classList.remove("is-holding");
    this._cancelHold();
  };

  private _cancelHold(): void {
    if (this._holdTimer !== null) clearTimeout(this._holdTimer);
    this._holdTimer = null;
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
                      <span class="wl-item-name">${nameOf(w)}</span>
                      ${w.filePath === current ? html`<span class="wl-active">ACTIVE</span>` : nothing}
                    </div>
                  `,
                )
          }
        </div>
        ${
          current !== null
            ? html`<div class="wl-foot">
                <button
                  class="wl-close"
                  title="Press and hold to close the workspace"
                  @pointerdown=${this._onCloseDown}
                  @pointerup=${this._onCloseUp}
                  @pointerleave=${this._onCloseUp}
                  @pointercancel=${this._onCloseUp}
                >
                  <span class="wl-close-fill"></span>
                  <span class="wl-close-label">Close workspace</span>
                </button>
              </div>`
            : nothing
        }
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
        <span class="wl-name">${name}</span>
      </button>
      ${this._open ? this._panel() : nothing}
    `;
  }
}

if (!customElements.get("openp41ge-workspace-label")) {
  customElements.define("openp41ge-workspace-label", Openp41geWorkspaceLabel);
}
