/**
 * <openp41ge-settings-list> — the Settings sidebar tab: every
 * settings schema there is, each described by its schema's `description`. The
 * platform's own settings ("Platform") come first, then each active extension
 * that registered a schema, by name. A click
 * opens one as a settings editor tab in the manager grid (a preview), a
 * double-click pins it (`onOpen(id, pinned)`).
 *
 * The list follows the active extensions (as they load and reload).
 */

import { LitElement, html, nothing, type TemplateResult } from "lit";
import type { ActiveExtensionSummary } from "openp41ge-sdk";
import { configEditorTitle } from "../apps/config-editor/title";
import { getActiveExtensions, onExtensionsChanged } from "../services/extension-contributions";
import {
  PLATFORM_SETTINGS_ID,
  settingsBridge,
  type PlatformConfigBridge,
} from "../services/settings-sources";

/** One listed settings schema. */
interface SettingsEntry {
  readonly id: string;
  readonly name: string;
  readonly detail: string;
}

/** What the list reads (injectable for tests). */
export interface SettingsListDeps {
  activeExtensions(): readonly ActiveExtensionSummary[];
  /** The settings schema registered under `id` (null: none). */
  describe(id: string): Promise<{ readonly description?: string } | null>;
  onExtensionsChanged(fn: () => void): () => void;
}

const DEFAULT_DEPS: SettingsListDeps = {
  activeExtensions: () => getActiveExtensions(),
  describe: async (id) => {
    const extension = window.openp41ge?.extension?.config;
    const platform = window.openp41ge?.config;
    if (!extension || !platform) return null;
    try {
      const described = await settingsBridge(
        extension,
        platform as unknown as PlatformConfigBridge,
      ).describe(id);
      return described?.schema ?? null;
    } catch {
      return null;
    }
  },
  onExtensionsChanged: (fn) => onExtensionsChanged(fn),
};

/** A settings schema's name in the list: its tab title without "Settings". */
function nameOf(id: string): string {
  return configEditorTitle(id).replace(/ Settings$/, "");
}

export class Openp41geSettingsList extends LitElement {
  static override properties = { _entries: { state: true } };

  /** Open a settings schema's editor (`pinned`: a double-click). */
  onOpen: ((id: string, pinned: boolean) => void) | null = null;
  /** When set, rows are platform drag sources with this id. */
  dragSourceId: string | null = null;
  /** Injectable for tests. */
  deps: SettingsListDeps = DEFAULT_DEPS;

  declare private _entries: readonly SettingsEntry[];
  private _off: (() => void) | null = null;
  private _seq = 0;

  constructor() {
    super();
    this._entries = [{ id: PLATFORM_SETTINGS_ID, name: nameOf(PLATFORM_SETTINGS_ID), detail: "" }];
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._off = this.deps.onExtensionsChanged(() => void this._load());
    void this._load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._off?.();
    this._off = null;
  }

  private async _load(): Promise<void> {
    const seq = ++this._seq;
    const ids = [PLATFORM_SETTINGS_ID, ...this.deps.activeExtensions().map((e) => e.id)];
    const described = await Promise.all(
      ids.map(async (id): Promise<SettingsEntry | null> => {
        const schema = await this.deps.describe(id);
        return schema ? { id, name: nameOf(id), detail: schema.description ?? "" } : null;
      }),
    );
    if (seq !== this._seq) return;
    const [platform, ...extensions] = described;
    const entries = extensions
      .filter((e): e is SettingsEntry => e !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
    this._entries = [platform ?? this._entries[0], ...entries];
  }

  override render(): TemplateResult {
    return html`
      <style>
        openp41ge-settings-list {
          display: block;
        }
        .sl-list {
          list-style: none;
          margin: 0;
          padding: 0;
        }
        /* Rows are separated as the Workspaces tab's rows are. */
        .sl-row {
          padding: 8px 12px;
          cursor: pointer;
          user-select: none;
          border-bottom: 1px solid var(--divider, #2f3031);
        }
        .sl-row:hover {
          background: var(--bg-hover, rgba(255, 255, 255, 0.05));
        }
        .sl-name {
          font-size: 13px;
          line-height: 18px;
          color: var(--text, #ddd);
        }
        .sl-detail {
          font-size: 11px;
          line-height: 15px;
          color: var(--text-secondary, #999);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
      </style>
      <ul class="sl-list">
        ${this._entries.map(
          (entry) =>
            html`<li
              class="sl-row"
              data-settings-id=${entry.id}
              data-drag-source-id=${this.dragSourceId ?? nothing}
              title=${`Open ${entry.name} settings`}
              @click=${() => this.onOpen?.(entry.id, false)}
              @dblclick=${() => this.onOpen?.(entry.id, true)}
            >
              <div class="sl-name">${entry.name}</div>
              <div class="sl-detail">${entry.detail}</div>
            </li>`,
        )}
      </ul>
    `;
  }
}

if (!customElements.get("openp41ge-settings-list")) {
  customElements.define("openp41ge-settings-list", Openp41geSettingsList);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-settings-list": Openp41geSettingsList;
  }
}
