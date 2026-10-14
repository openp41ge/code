/**
 * <json-form> — a settings form built from a config's JSON Schema.
 *
 * One labelled field per property, in schema order (required settings with no
 * default first): a toggle for a boolean, a number input (bounded by
 * `minimum` / `maximum`), a menu for an `enum`, a text input (masked for
 * `"secret": true`), an editable list for an array of values, cards for an
 * array of objects (one accordion segment per item: open it to edit, move
 * it, remove it) and a group for an object. A shape it cannot edit points to
 * the JSON view and shows its value.
 *
 * `value` is the user's values only (what is stored); `defaults` the schema's
 * defaults. An unset field shows its default, faded; editing sets it, and
 * Reset removes it. Every edit emits `json-form-change` (`JSON_FORM_CHANGE`)
 * with the full user values. The form never validates or saves: the host
 * does, and passes problems back as `errors` (`{ path, message }`, `path` as
 * `a.b[0]`), shown under their fields.
 *
 * Theming: CSS custom properties only (`--bg-primary`, `--bg-secondary`,
 * `--text-primary`, `--text-secondary`, `--accent`, `--divider`, `--font-ui`,
 * `--font-mono`, plus `--jf-*`). No app or Electron imports: the browser runs
 * it in a plain page.
 */

import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { cloneDeep, type JsonPath } from "../json-editor/json-tree";
import { renderMarkdown } from "../json-editor/md-render";
import "../components/openp41ge-toggle";
import {
  formFields,
  resetField,
  setFieldValue,
  type FormField,
  type JsonFormError,
  type ListItemKind,
} from "./form-model";

/** Emitted after every edit; `detail.value` is the full user values. */
export const JSON_FORM_CHANGE = "json-form-change";

const UP_ICON = html`<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
  <path d="M440-160v-487L216-423l-56-57 320-320 320 320-56 57-224-224v487h-80Z" />
</svg>`;
const DOWN_ICON = html`<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
  <path d="M440-800v487L216-537l-56 57 320 320 320-320-56-57-224 224v-487h-80Z" />
</svg>`;
const REMOVE_ICON = html`<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
  <path
    d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"
  />
</svg>`;

/** A DOM id for a field (unique within the form's shadow root). */
const idFor = (key: string): string => `jf-${key.replace(/[^A-Za-z0-9_-]/g, "-")}`;

/** A new list item of `kind`. */
function newListItem(kind: ListItemKind): unknown {
  switch (kind.kind) {
    case "boolean":
      return false;
    case "number":
      return 0;
    case "enum":
      return kind.options?.[0] ?? null;
    default:
      return "";
  }
}

/** An item of a list of objects: titled by its first non-empty text. */
function itemTitle(fields: readonly FormField[], index: number): string {
  for (const f of fields) {
    if ((f.kind === "string" || f.kind === "enum") && typeof f.value === "string" && f.value) {
      return f.value;
    }
  }
  return `Item ${index + 1}`;
}

@customElement("json-form")
export class JsonFormElement extends LitElement {
  /** The config's JSON Schema (an object schema). */
  @property({ attribute: false }) schema: unknown = null;
  /** The user's values only (what is stored). */
  @property({ attribute: false }) value: unknown = undefined;
  /** The schema's defaults. */
  @property({ attribute: false }) defaults: unknown = null;
  /** Problems to show beside fields. */
  @property({ attribute: false }) errors: readonly JsonFormError[] = [];
  @property({ type: Boolean, reflect: true }) readonly = false;

  /** The values being edited: `value`, then each edit applied. */
  @state() private _value: Record<string, unknown> = {};
  /** Open items of lists of objects, by key (`hosts[0]`). */
  @state() private _open: ReadonlySet<string> = new Set();

  override willUpdate(changed: Map<string, unknown>): void {
    if (changed.has("value")) {
      const v = this.value;
      this._value =
        v !== null && typeof v === "object" && !Array.isArray(v)
          ? (cloneDeep(v) as Record<string, unknown>)
          : {};
    }
  }

  // ── Edits ─────────────────────────────────────────────────────────────

  private _commit(next: Record<string, unknown>): void {
    this._value = next;
    this.dispatchEvent(
      new CustomEvent(JSON_FORM_CHANGE, {
        detail: { value: cloneDeep(next) },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _set(path: JsonPath, v: unknown): void {
    this._commit(setFieldValue(this._value, this.defaults, path, v));
  }

  private _reset(path: JsonPath): void {
    this._commit(resetField(this._value, path));
  }

  /** Set a list (of values or objects) to `list`. */
  private _setList(f: FormField, list: unknown[]): void {
    this._set(f.path, list);
  }

  private _toggleOpen(key: string): void {
    const open = new Set(this._open);
    if (open.has(key)) open.delete(key);
    else open.add(key);
    this._open = open;
  }

  /** Keep items open across a move (`from` ↔ `to`) or a removal (`to` null). */
  private _reindexOpen(f: FormField, from: number, to: number | null, length: number): void {
    const isOpen = (i: number) => this._open.has(`${f.key}[${i}]`);
    const was = Array.from({ length }, (_, i) => isOpen(i));
    const now = [...was];
    if (to === null) now.splice(from, 1);
    else [now[from], now[to]] = [was[to], was[from]];
    const open = new Set([...this._open].filter((k) => !k.startsWith(`${f.key}[`)));
    now.forEach((o, i) => o && open.add(`${f.key}[${i}]`));
    this._open = open;
  }

  // ── Render ────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    const fields = formFields(this.schema, this._value, this.defaults, this.errors);
    return html`<div class="jf">${fields.map((f) => this._field(f))}</div>`;
  }

  private _field(f: FormField): TemplateResult {
    if (f.kind === "group") return this._group(f);
    const id = idFor(f.key);
    const faded = !f.set && f.hasDefault;
    const labelled = f.kind !== "list" && f.kind !== "objects" && f.kind !== "unsupported";
    return html`
      <div class="jf-field ${faded ? "jf-default" : ""}" data-key=${f.key}>
        <div class="jf-head">
          ${
            labelled
              ? html`<label class="jf-label" for=${id}>${f.label}</label>`
              : html`<span class="jf-label" id=${id}>${f.label}</span>`
          }
          ${f.required ? html`<span class="jf-required">Required</span>` : nothing}
          ${
            f.set && !this.readonly && f.kind !== "unsupported"
              ? html`<button
                  type="button"
                  class="jf-reset"
                  aria-label="Reset ${f.label}"
                  title="Use the default"
                  @click=${() => this._reset(f.path)}
                >
                  Reset
                </button>`
              : nothing
          }
        </div>
        ${this._description(f)} ${this._control(f, id)}
        ${f.error ? html`<div class="jf-error" role="alert">${f.error}</div>` : nothing}
      </div>
    `;
  }

  private _description(f: FormField): TemplateResult | typeof nothing {
    return f.description
      ? html`<div class="jf-description">${unsafeHTML(renderMarkdown(f.description))}</div>`
      : nothing;
  }

  private _group(f: FormField): TemplateResult {
    return html`
      <fieldset class="jf-group" data-key=${f.key}>
        <legend class="jf-label">${f.label}</legend>
        ${this._description(f)}
        ${f.error ? html`<div class="jf-error" role="alert">${f.error}</div>` : nothing}
        ${(f.fields ?? []).map((child) => this._field(child))}
      </fieldset>
    `;
  }

  private _control(f: FormField, id: string): TemplateResult {
    const placeholder = f.hasDefault ? "" : "Not set";
    switch (f.kind) {
      case "boolean":
        return html`<openp41ge-toggle
          id=${id}
          .checked=${f.value === true}
          .label=${f.label}
          ?disabled=${this.readonly}
          @change=${(e: CustomEvent<{ checked: boolean }>) => this._set(f.path, e.detail.checked)}
        ></openp41ge-toggle>`;
      case "number":
        return this._numberInput(id, f.value, f, (v) =>
          v === undefined ? this._reset(f.path) : this._set(f.path, v),
        );
      case "enum":
        return this._select(id, f.value, f.options ?? [], !f.set && !f.hasDefault, (v) =>
          v === undefined ? this._reset(f.path) : this._set(f.path, v),
        );
      case "string":
      case "secret":
        return html`<input
          class="jf-input"
          id=${id}
          type=${f.kind === "secret" ? "password" : "text"}
          autocomplete=${f.kind === "secret" ? "off" : nothing}
          spellcheck="false"
          placeholder=${placeholder}
          .value=${typeof f.value === "string" ? f.value : ""}
          ?disabled=${this.readonly}
          @input=${(e: Event) => {
            const text = (e.target as HTMLInputElement).value;
            // Clearing a setting with no default removes it.
            if (text === "" && !f.hasDefault) this._reset(f.path);
            else this._set(f.path, text);
          }}
        />`;
      case "list":
        return this._list(f);
      case "objects":
        return this._objects(f);
      default:
        return html`
          <p class="jf-note">Edit this in the JSON view.</p>
          ${
            f.value === undefined
              ? nothing
              : html`<pre class="jf-json">${JSON.stringify(f.value, null, 2)}</pre>`
          }
        `;
    }
  }

  private _numberInput(
    id: string,
    value: unknown,
    limits: { integer?: boolean; minimum?: number; maximum?: number; hasDefault?: boolean },
    onChange: (v: number | undefined) => void,
  ): TemplateResult {
    return html`<input
      class="jf-input jf-number"
      id=${id}
      type="number"
      min=${limits.minimum ?? nothing}
      max=${limits.maximum ?? nothing}
      step=${limits.integer ? "1" : "any"}
      placeholder=${limits.hasDefault === false ? "Not set" : ""}
      .value=${typeof value === "number" ? String(value) : ""}
      ?disabled=${this.readonly}
      @input=${(e: Event) => {
        const text = (e.target as HTMLInputElement).value;
        if (text === "") return onChange(undefined);
        const n = Number(text);
        if (!Number.isNaN(n)) onChange(n);
      }}
    />`;
  }

  private _select(
    id: string,
    value: unknown,
    options: readonly unknown[],
    withEmpty: boolean,
    onChange: (v: unknown) => void,
  ): TemplateResult {
    const selected = options.findIndex((o) => JSON.stringify(o) === JSON.stringify(value));
    return html`<select
      class="jf-input"
      id=${id}
      ?disabled=${this.readonly}
      @change=${(e: Event) => {
        const idx = (e.target as HTMLSelectElement).value;
        onChange(idx === "" ? undefined : options[Number(idx)]);
      }}
    >
      ${withEmpty ? html`<option value="" ?selected=${selected < 0}>Not set</option>` : nothing}
      ${options.map(
        (o, i) =>
          html`<option value=${String(i)} ?selected=${i === selected}>
            ${typeof o === "string" ? o : JSON.stringify(o)}
          </option>`,
      )}
    </select>`;
  }

  /** A list of values: one control per item, with Remove; Add at the end. */
  private _list(f: FormField): TemplateResult {
    const list = Array.isArray(f.value) ? f.value : [];
    const kind = f.item!;
    const edit = (i: number, v: unknown) => {
      const next = [...list];
      next[i] = v;
      this._setList(f, next);
    };
    return html`
      <div class="jf-list" role="group" aria-labelledby=${idFor(f.key)}>
        ${list.map((item, i) => {
          const id = idFor(`${f.key}[${i}]`);
          const control =
            kind.kind === "boolean"
              ? html`<openp41ge-toggle
                  id=${id}
                  .checked=${item === true}
                  .label=${`${f.label} item ${i + 1}`}
                  ?disabled=${this.readonly}
                  @change=${(e: CustomEvent<{ checked: boolean }>) => edit(i, e.detail.checked)}
                ></openp41ge-toggle>`
              : kind.kind === "number"
                ? this._numberInput(id, item, { integer: kind.integer }, (v) => edit(i, v ?? 0))
                : kind.kind === "enum"
                  ? this._select(id, item, kind.options ?? [], false, (v) => edit(i, v))
                  : html`<input
                      class="jf-input"
                      id=${id}
                      type="text"
                      spellcheck="false"
                      aria-label=${`${f.label} item ${i + 1}`}
                      .value=${typeof item === "string" ? item : ""}
                      ?disabled=${this.readonly}
                      @input=${(e: Event) => edit(i, (e.target as HTMLInputElement).value)}
                    />`;
          return html`<div class="jf-list-item">
            ${control}
            <button
              type="button"
              class="jf-icon-btn jf-x"
              aria-label="Remove item ${i + 1} of ${f.label}"
              title="Remove"
              ?disabled=${this.readonly}
              @click=${() =>
                this._setList(
                  f,
                  list.filter((_, j) => j !== i),
                )}
            >
              ${REMOVE_ICON}
            </button>
          </div>`;
        })}
        <button
          type="button"
          class="jf-add"
          aria-label="Add to ${f.label}"
          ?disabled=${this.readonly}
          @click=${() => this._setList(f, [...list, newListItem(kind)])}
        >
          ＋ Add
        </button>
      </div>
    `;
  }

  /** A list of objects: a card with one accordion segment per item. */
  private _objects(f: FormField): TemplateResult {
    const list = Array.isArray(f.value) ? f.value : [];
    const items = f.items ?? [];
    const move = (i: number, d: number) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      this._reindexOpen(f, i, i + d, list.length);
      this._setList(f, next);
    };
    const remove = (i: number) => {
      this._reindexOpen(f, i, null, list.length);
      this._setList(
        f,
        list.filter((_, j) => j !== i),
      );
    };
    const add = () => {
      const open = new Set(this._open);
      open.add(`${f.key}[${list.length}]`);
      this._open = open;
      this._setList(f, [...list, {}]);
    };
    return html`
      <div class="jf-card" role="group" aria-labelledby=${idFor(f.key)}>
        ${items.map((fields, i) => {
          const key = `${f.key}[${i}]`;
          const open = this._open.has(key);
          const n = i + 1;
          return html`<div class="jf-seg ${open ? "jf-seg--open" : ""}">
            <div
              class="jf-seg-head"
              role="button"
              tabindex="0"
              aria-expanded=${open}
              @click=${() => this._toggleOpen(key)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  this._toggleOpen(key);
                }
              }}
            >
              <span class="jf-chev" aria-hidden="true">›</span>
              <span class="jf-seg-title">${itemTitle(fields, i)}</span>
              <span class="jf-seg-actions" @click=${(e: Event) => e.stopPropagation()}>
                <button
                  type="button"
                  class="jf-icon-btn"
                  aria-label="Move item ${n} of ${f.label} up"
                  title="Move up"
                  ?disabled=${this.readonly || i === 0}
                  @click=${() => move(i, -1)}
                >
                  ${UP_ICON}
                </button>
                <button
                  type="button"
                  class="jf-icon-btn"
                  aria-label="Move item ${n} of ${f.label} down"
                  title="Move down"
                  ?disabled=${this.readonly || i === items.length - 1}
                  @click=${() => move(i, 1)}
                >
                  ${DOWN_ICON}
                </button>
                <button
                  type="button"
                  class="jf-icon-btn jf-x"
                  aria-label="Remove item ${n} of ${f.label}"
                  title="Remove"
                  ?disabled=${this.readonly}
                  @click=${() => remove(i)}
                >
                  ${REMOVE_ICON}
                </button>
              </span>
            </div>
            ${
              open
                ? html`<div class="jf-seg-body">${fields.map((child) => this._field(child))}</div>`
                : nothing
            }
          </div>`;
        })}
        <button
          type="button"
          class="jf-add jf-addrow"
          aria-label="Add to ${f.label}"
          ?disabled=${this.readonly}
          @click=${add}
        >
          ＋ Add
        </button>
      </div>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      color: var(--text-primary, #ddd);
      font-family: var(--font-ui, system-ui, sans-serif);
      font-size: 12px;
    }
    .jf {
      display: flex;
      flex-direction: column;
      gap: 14px;
    }
    .jf-field {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .jf-head {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 20px;
    }
    .jf-label {
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary, #ddd);
    }
    .jf-required {
      padding: 0 6px;
      border-radius: 999px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      background: color-mix(in srgb, var(--accent, #569cd6) 16%, transparent);
      color: var(--accent, #569cd6);
    }
    .jf-reset {
      margin-left: auto;
      padding: 1px 8px;
      border: 1px solid var(--divider, #333);
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary, #999);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .jf-reset:hover {
      color: var(--text-primary, #ddd);
      border-color: var(--text-secondary, #999);
    }
    .jf-description {
      color: var(--text-secondary, #999);
      font-size: 11px;
      line-height: 1.45;
    }
    .jf-description p {
      margin: 0;
    }
    .jf-description code {
      font-family: var(--font-mono, ui-monospace, monospace);
    }
    /* A description is help text: its headings and code blocks stay small. */
    .jf-description :is(h1, h2, h3, h4, h5, h6) {
      margin: 6px 0 2px;
      font-size: 12px;
      font-weight: 600;
      color: var(--text-primary, #ddd);
    }
    .jf-description pre {
      margin: 4px 0;
      padding: 6px 8px;
      overflow: auto;
      border-radius: 4px;
      background: var(--jf-input-bg, var(--bg-secondary, #2a2a2a));
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 11px;
      line-height: 1.4;
    }
    .jf-description p + p {
      margin-top: 4px;
    }
    /* Inputs are cards, as in the workspace editor: full width, a
       background, no outline. */
    .jf-input {
      box-sizing: border-box;
      width: 100%;
      padding: 5px 8px;
      border: none;
      border-radius: 4px;
      background: var(--jf-input-bg, var(--bg-tertiary, #222));
      color: var(--text-primary, #ddd);
      font: inherit;
      font-size: 12px;
    }
    .jf-input:focus {
      outline: none;
      background: var(--jf-input-focus-bg, color-mix(in srgb, var(--bg-tertiary, #222) 92%, #fff));
    }
    .jf-input:disabled {
      opacity: 0.6;
    }
    /* An unset field shows its default, faded. */
    .jf-default > .jf-input,
    .jf-default > openp41ge-toggle {
      opacity: 0.55;
    }
    .jf-default > .jf-input:focus {
      opacity: 1;
    }
    .jf-error {
      color: var(--jf-error, #f44747);
      font-size: 11px;
    }
    .jf-note {
      margin: 0;
      color: var(--text-secondary, #999);
      font-size: 11px;
      font-style: italic;
    }
    .jf-json {
      margin: 0;
      padding: 6px 8px;
      overflow: auto;
      border-radius: 4px;
      background: var(--jf-input-bg, var(--bg-tertiary, #222));
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 11px;
      color: var(--text-secondary, #999);
    }
    .jf-group {
      margin: 0;
      padding: 10px 12px 12px;
      border: 1px solid var(--divider, #333);
      border-radius: 6px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .jf-group > legend {
      padding: 0 4px;
    }
    .jf-list {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .jf-list-item {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .jf-list-item .jf-input {
      flex: 1;
    }
    .jf-icon-btn {
      flex-shrink: 0;
      box-sizing: border-box;
      width: 22px;
      height: 22px;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      border-radius: 4px;
      background: var(--jf-button-bg, #3a3a3a);
      color: var(--text-secondary, #999);
      cursor: pointer;
    }
    .jf-icon-btn svg {
      width: 14px;
      height: 14px;
    }
    .jf-icon-btn:hover:not([disabled]) {
      background: color-mix(in srgb, var(--accent, #569cd6) 22%, #2a2a2a);
      color: var(--accent, #569cd6);
    }
    .jf-x:hover:not([disabled]) {
      background: #4a2f2f;
      color: var(--jf-error, #f44747);
    }
    .jf-icon-btn[disabled] {
      opacity: 0.35;
      cursor: default;
    }
    .jf-add {
      align-self: flex-start;
      padding: 3px 8px;
      border: none;
      border-radius: 4px;
      background: transparent;
      color: var(--text-secondary, #999);
      font: inherit;
      font-size: 11px;
      cursor: pointer;
    }
    .jf-add:hover:not([disabled]) {
      background: var(--jf-hover, rgba(255, 255, 255, 0.06));
      color: var(--text-primary, #ddd);
    }
    .jf-add[disabled] {
      opacity: 0.35;
      cursor: default;
    }
    /* Lists of objects: the workspace editor's accordion card. */
    .jf-card {
      border: 1px solid var(--divider, #333);
      border-radius: 6px;
      background: var(--jf-card-bg, var(--bg-secondary, #222));
      overflow: hidden;
    }
    .jf-card > .jf-seg + .jf-seg,
    .jf-card > .jf-addrow {
      border-top: 1px solid var(--divider, #2a2a2a);
    }
    .jf-seg-head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      cursor: pointer;
      user-select: none;
    }
    .jf-seg-head:hover {
      background: var(--jf-hover, rgba(255, 255, 255, 0.04));
    }
    .jf-seg-head:focus-visible {
      outline: 1px solid var(--accent, #569cd6);
      outline-offset: -1px;
    }
    .jf-chev {
      flex-shrink: 0;
      width: 14px;
      text-align: center;
      color: var(--text-secondary, #999);
      transition: transform 0.15s ease;
    }
    .jf-seg--open .jf-chev {
      transform: rotate(90deg);
    }
    .jf-seg-title {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .jf-seg-actions {
      display: flex;
      gap: 2px;
    }
    .jf-seg-body {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 4px 12px 12px 30px;
    }
    .jf-addrow {
      align-self: stretch;
      width: 100%;
      text-align: left;
      border-radius: 0;
      padding: 6px 8px 6px 30px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "json-form": JsonFormElement;
  }
}
