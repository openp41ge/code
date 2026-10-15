/**
 * <openp41ge-config-editor> — the platform's JSON settings editor, hosted as
 * the `config-editor` grid tab: one extension's config (AGENTS.md §2.9,
 * opened by `host.config.openEditor()` or the manager's Settings list), or,
 * for the id `openp41ge`, the platform's own global settings
 * (services/settings-sources.ts routes by id).
 *
 * It edits the user's values (what `config.json` stores under
 * `extensions.<extensionId>`) against the schema the extension registered:
 * the schema gives the editor its key tooltips and the faded defaults of
 * "Show default values". Edits are staged; Save sends the whole document to
 * main, which validates it against the schema (a refusal is shown, and the
 * edit kept). While there are no unsaved edits, a change made elsewhere (another
 * window, the file edited by hand) is picked up.
 *
 * It opens in a Form view of the settings (`<json-form>`, with the schema's
 * problems with the values under their fields); the JSON view (`<json-editor>`)
 * is a switch away, as in the workspace editor. Both edit the same staged
 * values.
 *
 * Bottom bar: Save and Reset on the left; on the right, in the JSON view, Show
 * default values and Sort keys, then the Form/JSON switch.
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import { state } from "lit/decorators.js";
import { tooltipContent } from "openp41ge-sdk-uikit";
import "openp41ge-sdk-uikit/json-editor";
import "openp41ge-sdk-uikit/json-form";
import {
  cloneDeep,
  mergeDefaults,
  pinnedPaths,
  setAt,
  sortJsonKeys,
  stripDefaults,
  type JsonPath,
} from "openp41ge-sdk-uikit/json-editor";
import { configErrors, mergeConfig, type ConfigSchema } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import type { ExtensionConfigBridge } from "../services/extension-configs";
import { settingsBridge, type PlatformConfigBridge } from "../services/settings-sources";
import { appServices } from "../app";
import {
  formIcon,
  jsonIcon,
  resetIcon,
  saveIcon,
  showDefaultsIcon,
  sortKeysIcon,
} from "./settings-icons";

const log = createLogger("openp41ge", "config-editor");

type Doc = Record<string, unknown>;

/** Main's error without Electron's "Error invoking remote method '…': Error: ". */
function refusal(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, "");
}

export class Openp41geConfigEditor extends LitElement {
  /** The extension whose config is edited. Set before connecting. */
  extensionId = "";
  /** Injectable for tests; defaults to the platform's settings sources. */
  bridge: ExtensionConfigBridge | null = null;

  @state() private _schema: ConfigSchema | null = null;
  @state() private _defaults: Doc = {};
  /** The staged document (the user's values, pins included). */
  @state() private _overrides: Doc | null = null;
  /** The last stored document (the dirty baseline). */
  @state() private _saved: Doc | null = null;
  @state() private _pinned = new Set<string>();
  @state() private _showDefaults = false;
  /** The Form view, or the JSON view. */
  @state() private _mode: "form" | "json" = "form";
  @state() private _loading = true;
  @state() private _saving = false;
  @state() private _error = "";

  private _offChanged: (() => void) | null = null;

  private _bridge(): ExtensionConfigBridge | null {
    if (this.bridge) return this.bridge;
    const extension = window.openp41ge?.extension?.config;
    const platform = window.openp41ge?.config;
    if (!extension || !platform) return extension ?? null;
    // Saves go through this window's config service: it updates this
    // window's cache and listeners (its JSON editors follow editor/json),
    // then the IPC, which reaches the other windows.
    const platformBridge = {
      ...(platform as unknown as PlatformConfigBridge),
      set: (key: string, value: unknown) => appServices.configService.set(key, value),
    };
    this.bridge = settingsBridge(extension, platformBridge);
    return this.bridge;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    const bridge = this._bridge();
    this._offChanged =
      bridge?.onChanged(({ extensionId }) => {
        if (extensionId === this.extensionId && !this._isDirty() && !this._saving) {
          void this._load();
        }
      }) ?? null;
    void this._load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._offChanged?.();
    this._offChanged = null;
  }

  private async _load(): Promise<void> {
    const bridge = this._bridge();
    try {
      const described = bridge ? await bridge.describe(this.extensionId) : null;
      if (described) {
        this._schema = described.schema;
        this._defaults = sortJsonKeys(described.defaults) as Doc;
        this._saved = cloneDeep(described.overrides);
        this._sync(cloneDeep(described.overrides));
      } else {
        this._schema = null;
      }
      this._error = "";
    } catch (err) {
      log.error(`config-editor load '${this.extensionId}' failed:`, err, { skipToast: true });
      this._error = `Failed to load the settings: ${refusal(err)}`;
    } finally {
      this._loading = false;
    }
  }

  private _sync(overrides: Doc): void {
    this._overrides = overrides;
    this._pinned = pinnedPaths(overrides, this._defaults);
  }

  private _editorValue(): Doc {
    if (!this._overrides) return {};
    return this._showDefaults
      ? (mergeDefaults(this._overrides, this._defaults) as Doc)
      : this._overrides;
  }

  private _onChange(e: CustomEvent): void {
    const value = (e.detail as { value: Doc }).value;
    this._sync(
      this._showDefaults
        ? ((stripDefaults(value, this._defaults, this._pinned) ?? {}) as Doc)
        : value,
    );
  }

  /** "Overwrite" on a faded default row: pin that value into the document. */
  private _onOverwrite(e: CustomEvent): void {
    const detail = e.detail as { path: JsonPath; value: unknown };
    if (!this._overrides || !detail?.path?.length) return;
    const next = cloneDeep(this._overrides);
    setAt(next, detail.path, detail.value);
    this._sync(next);
  }

  private _isDirty(): boolean {
    return JSON.stringify(this._overrides) !== JSON.stringify(this._saved);
  }

  private async _save(): Promise<void> {
    const bridge = this._bridge();
    if (!this._overrides || !bridge) return;
    this._saving = true;
    const doc = sortJsonKeys(this._overrides) as Doc;
    try {
      await bridge.set(this.extensionId, doc);
      this._saved = cloneDeep(doc);
      this._sync(doc);
      this._error = "";
    } catch (err) {
      this._error = refusal(err);
    } finally {
      this._saving = false;
    }
  }

  private _reset(): void {
    if (this._saved) this._sync(cloneDeep(this._saved));
    this._error = "";
  }

  /** The tab's cell (its tab bar and content): the form's drawers cover it. */
  private _cell(): HTMLElement | null {
    return (
      this.closest<HTMLElement>(".grid-cell") ?? this.closest<HTMLElement>("openp41ge-sidebar")
    );
  }

  private _onKeyDown(e: KeyboardEvent): void {
    // An open drawer blocks the cell, Save included.
    if ((e.currentTarget as { drawersOpen?: boolean } | null)?.drawersOpen) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      void this._save();
    }
  }

  /** The schema's problems with the staged values merged over the defaults
   *  (what Save checks), by path (`a.b[0]`). */
  private _formErrors(): Array<{ path: string; message: string }> {
    if (!this._schema || !this._overrides) return [];
    const merged = mergeConfig(this._defaults, this._overrides);
    return configErrors(this._schema, merged).map((message) => {
      const at = message.indexOf(": ");
      return { path: at > 0 ? message.slice(0, at) : "", message };
    });
  }

  private _body(): TemplateResult {
    if (this._loading) return html`<p class="cfe-note">Loading…</p>`;
    if (!this._schema) {
      return html`<p class="cfe-note">${this.extensionId} has no settings.</p>`;
    }
    if (this._mode === "form") {
      return html`<div class="cfe-editor cfe-editor--form">
        <json-form
          .schema=${this._schema}
          .value=${this._overrides ?? {}}
          .defaults=${this._defaults}
          .errors=${this._formErrors()}
          .drawerArea=${this._cell()}
          @json-form-change=${(e: CustomEvent) => this._sync((e.detail as { value: Doc }).value)}
          @keydown=${(e: KeyboardEvent) => this._onKeyDown(e)}
        ></json-form>
      </div>`;
    }
    return html`<div class="cfe-editor">
      <json-editor
        .value=${this._editorValue()}
        .defaults=${this._defaults}
        .showDefaults=${this._showDefaults}
        .explicitPaths=${[...this._pinned]}
        .schema=${this._schema}
        @json-editor-change=${(e: CustomEvent) => this._onChange(e)}
        @json-editor-overwrite=${(e: CustomEvent) => this._onOverwrite(e)}
        @keydown=${(e: KeyboardEvent) => this._onKeyDown(e)}
      ></json-editor>
    </div>`;
  }

  override render(): TemplateResult {
    const dirty = this._isDirty();
    const editable = !!this._schema && !!this._overrides;
    return html`
      <style>
        openp41ge-config-editor {
          display: block;
          height: 100%;
        }
        .cfe-pane {
          box-sizing: border-box;
          height: 100%;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--settings-pane-bg, var(--bg-primary, #161616));
          color: var(--text-primary, #ccc);
          font-size: 13px;
        }
        .cfe-editor {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .cfe-editor > json-editor {
          flex: 1;
          min-height: 0;
        }
        /* The form scrolls itself, so its drawers cover the pane. */
        .cfe-editor--form > json-form {
          flex: 1;
          min-height: 0;
          --jf-padding: 16px;
        }
        .cfe-note {
          flex: 1;
          margin: 0;
          padding: 12px;
          color: var(--text-secondary, #999);
        }
        .cfe-note--error {
          flex: 0 0 auto;
          padding: 6px 12px;
          white-space: pre-wrap;
          color: var(--danger, #f44336);
        }
        .cfe-footer {
          flex: 0 0 auto;
          display: flex;
          align-items: center;
          height: 34px;
          box-sizing: border-box;
          border-top: 1px solid var(--divider, #333);
          background: var(--bg-surface, #161616);
        }
        .cfe-spacer {
          flex: 1 1 auto;
        }
        .cfe-btn {
          height: 100%;
          aspect-ratio: 1 / 1;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0;
          border: none;
          border-left: 1px solid var(--border-divider, #2d2d2d);
          border-radius: 0;
          background: transparent;
          color: var(--text-secondary, #999);
          cursor: pointer;
        }
        .cfe-btn--rsep {
          border-left: none;
          border-right: 1px solid var(--border-divider, #2d2d2d);
        }
        .cfe-btn:hover:not([disabled]) {
          background: var(--bg-active, #37373d);
          color: var(--text-primary, #ddd);
        }
        .cfe-btn[disabled] {
          cursor: default;
        }
        .cfe-btn--on,
        .cfe-btn--dirty {
          color: var(--accent, #569cd6);
        }
        .cfe-btn svg {
          width: 14px;
          height: 14px;
          fill: currentColor;
        }
        /* The corner button: push the icon 8px in from the window's rounded
           corner. The grid (and a sidebar) publishes --grid-edge-right-pad:
           8px when this tab is flush with a rounded right corner, else 0px. */
        .cfe-btn:last-child {
          box-sizing: content-box;
          padding-right: var(--grid-edge-right-pad, 0px);
        }
        /* Outline icons (the JSON switch's braces) are drawn with stroke. */
        .cfe-btn svg[stroke] {
          fill: none;
        }
      </style>
      <div class="cfe-pane">
        ${this._body()}
        ${this._error ? html`<p class="cfe-note cfe-note--error">${this._error}</p>` : nothing}
        <div class="cfe-footer">
          <button
            class="cfe-btn cfe-btn--rsep ${dirty ? "cfe-btn--dirty" : ""}"
            type="button"
            aria-label="Save settings"
            ?disabled=${!editable || this._saving}
            @click=${() => void this._save()}
            ${tooltipContent({ type: "simple", text: "Save" })}
          >
            ${saveIcon()}
          </button>
          <button
            class="cfe-btn cfe-btn--rsep"
            type="button"
            aria-label="Reset settings"
            ?disabled=${!dirty}
            @click=${() => this._reset()}
            ${tooltipContent({ type: "simple", text: "Reset" })}
          >
            ${resetIcon()}
          </button>
          <span class="cfe-spacer"></span>
          ${
            this._mode === "json"
              ? html`<button
                    class="cfe-btn ${this._showDefaults ? "cfe-btn--on" : ""}"
                    type="button"
                    aria-label="Show default values"
                    aria-pressed="${this._showDefaults}"
                    ?disabled=${!editable}
                    @click=${() => (this._showDefaults = !this._showDefaults)}
                    ${tooltipContent({ type: "simple", text: "Show default values" })}
                  >
                    ${showDefaultsIcon()}
                  </button>
                  <button
                    class="cfe-btn"
                    type="button"
                    aria-label="Sort keys"
                    ?disabled=${!editable}
                    @click=${() =>
                      this._overrides && this._sync(sortJsonKeys(this._overrides) as Doc)}
                    ${tooltipContent({ type: "simple", text: "Sort keys" })}
                  >
                    ${sortKeysIcon()}
                  </button>`
              : nothing
          }
          ${this._viewButton("form", "Form view", formIcon())}
          ${this._viewButton("json", "JSON view", jsonIcon())}
        </div>
      </div>
    `;
  }

  /** A bottom-bar button that opens a view; pressed while it is open. */
  private _viewButton(mode: "form" | "json", label: string, icon: TemplateResult): TemplateResult {
    const on = this._mode === mode;
    return html`<button
      class="cfe-btn ${on ? "cfe-btn--on" : ""}"
      type="button"
      aria-label=${label}
      aria-pressed="${on}"
      ?disabled=${!this._schema}
      @click=${() => (this._mode = mode)}
      ${tooltipContent({ type: "simple", text: label })}
    >
      ${icon}
    </button>`;
  }

  override createRenderRoot(): HTMLElement {
    return this; // Light DOM, like the other settings editors
  }
}

if (!customElements.get("openp41ge-config-editor")) {
  customElements.define("openp41ge-config-editor", Openp41geConfigEditor);
}
declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-config-editor": Openp41geConfigEditor;
  }
}
