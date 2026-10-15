/**
 * <json-form> — a settings form built from a config's JSON Schema.
 *
 * One labelled field per property, in schema order (required settings with no
 * default first): a toggle for a boolean, a number input (bounded by
 * `minimum` / `maximum`), a menu for an `enum`, a text input (masked for
 * `"secret": true`). Every object and array is a card (its title, its
 * description and what it holds: "3 properties · 1 set") that opens a drawer
 * from the right with it as a form: an object's fields; an array of values
 * as an editable list; an array of objects as a card per item (move,
 * remove, add); a map (an object whose keys are the user's) as a card per
 * object entry or a row per value, with add under a new key, rename and
 * remove (an entry its defaults have can only be edited). Drawers stack:
 * the front one is 80% of the form's width, the one behind it 90%, older
 * ones hidden; one mask and one shadow for the stack. A string with
 * `x-keysOf` is a menu of its sibling map's keys, and the map marks that
 * entry Default (with Make default on the others). A shape it cannot edit
 * points to the JSON view and shows its value.
 *
 * The form scrolls itself (padded by `--jf-padding`), so its drawers cover
 * what is in view: give it a height to fill. A host can give the drawers a
 * larger area to cover (`drawerArea`, e.g. the tab's whole cell, tab bar
 * included); they block it until dismissed (Tab does nothing in them).
 * `drawersOpen` says whether one is open. Nothing in the form is in the tab
 * order or shows a focus outline.
 *
 * `value` is the user's values only (what is stored); `defaults` the schema's
 * defaults. An unset field shows its default, faded; editing sets it, and
 * Reset (on every setting with a default, greyed out while unset) removes
 * it. Every edit emits `json-form-change` (`JSON_FORM_CHANGE`)
 * with the full user values. The form never validates or saves: the host
 * does, and passes problems back as `errors` (`{ path, message }`, `path` as
 * `a.b[0]`), shown under their fields.
 *
 * Theming: CSS custom properties only (`--bg-primary`, `--bg-secondary`,
 * `--text-primary`, `--text-secondary`, `--accent`, `--divider`, `--font-ui`,
 * `--font-mono`, plus `--jf-*`). No app or Electron imports: the browser runs
 * it in a plain page.
 */

import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { repeat } from "lit/directives/repeat.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { live } from "lit/directives/live.js";
import {
  cloneDeep,
  getAt,
  mergeDefaults,
  pinnedPaths,
  setAt,
  stripDefaults,
  type JsonPath,
} from "../json-editor/json-tree";
import { schemaAtPath } from "../json-editor/json-tooltip";
import "../json-editor/json-editor";
import { renderMarkdown } from "../json-editor/md-render";
import "../components/openp41ge-toggle";
import "../components/openp41ge-select";
import { focusLineLayer } from "../components/tabs/focus-line";
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

const RESET_ICON = html`<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true">
  <path
    d="M440-122q-121-15-200.5-105.5T160-440q0-66 26-126.5T260-674l57 57q-38 34-57.5 79T240-440q0 88 56 155.5T440-203v81Zm80 0v-81q87-16 143.5-83T720-440q0-100-70-170t-170-70h-3l44 44-56 56-140-140 140-140 56 56-44 44h3q134 0 227 93t93 227q0 121-79.5 211.5T520-122Z"
  />
</svg>`;

/** JSON view, { } (the Settings tab's icon; drawn with stroke). */
const JSON_ICON = html`<svg
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path
    d="M6 3.5C5 3.5 4.5 4 4.5 5v1c0 .8-.4 1.2-1.5 1.5 1.1.3 1.5.7 1.5 1.5v1c0 1 .5 1.5 1.5 1.5"
  />
  <path
    d="M10 3.5c1 0 1.5.5 1.5 1.5v1c0 .8.4 1.2 1.5 1.5-1.1.3-1.5.7-1.5 1.5v1c0 1-.5 1.5-1.5 1.5"
  />
</svg>`;

/** Settings whose control sits on one row, with Reset at its right. */
const ROW_KINDS: readonly string[] = ["boolean", "number", "enum", "string", "secret"];

/** Settings shown as a card that opens a drawer (objects and arrays). */
const CARD_KINDS: readonly string[] = ["group", "list", "objects", "map"];

/** What a card opens: the drawer's title and its body. */
interface DrawerTarget {
  readonly label: string;
  /** Where its value is in the settings (for its JSON view). */
  readonly path: JsonPath;
  readonly body: () => TemplateResult;
}

/** An open drawer: its key, what it shows, and its rendered body. */
interface OpenDrawer {
  readonly key: string;
  readonly target: DrawerTarget;
  readonly body: TemplateResult;
}

/** `n` and the noun for it: `1 entry`, `3 entries`. */
const count = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A list's items, named by their kind. */
const ITEM_NOUNS: Record<string, [string, string]> = {
  string: ["string", "strings"],
  number: ["number", "numbers"],
  boolean: ["boolean", "booleans"],
  enum: ["value", "values"],
};

/** The errors on a field and everything in it. */
function errorCount(f: FormField): number {
  let n = f.error ? 1 : 0;
  for (const child of f.fields ?? []) n += errorCount(child);
  for (const entry of f.entries ?? []) n += errorCount(entry);
  for (const item of f.items ?? []) for (const child of item) n += errorCount(child);
  return n;
}

/** A number as typed: optional sign, digits, a fraction, an exponent. */
const NUMBER_TEXT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const INTEGER_TEXT = /^[-+]?\d+$/;

/** The number `text` is (a whole one when `integer`), or null. */
function parseNumber(text: string, integer: boolean): number | null {
  const t = text.trim();
  if (!(integer ? INTEGER_TEXT : NUMBER_TEXT).test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** What a number field asks for when its text is not one. */
const numberHint = (integer: boolean): string =>
  integer ? "Enter a whole number" : "Enter a number";

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
  /** The element the drawers cover (by default the form): a host passes
   *  its tab's cell so they cover its tab bar too. */
  @property({ attribute: false }) drawerArea: HTMLElement | null = null;

  /** Whether a drawer is open (the host holds its own shortcuts meanwhile). */
  get drawersOpen(): boolean {
    return this._drawers.length > 0;
  }

  /** The values being edited: `value`, then each edit applied. */
  @state() private _value: Record<string, unknown> = {};
  /** The open drawers, back to front, by the key of what each shows
   *  (`editor`, `hosts[0]`, `providers.vllm`). */
  @state() private _drawers: readonly string[] = [];
  /** The open drawers showing their JSON view (the rest show the form). */
  @state() private _jsonViews: ReadonlySet<string> = new Set();
  /** The key being typed in each map's Add row, by the map's key. */
  @state() private _newKeys: ReadonlyMap<string, string> = new Map();
  /** Items added from a list's empty card, by key, with their list's path:
   *  one still empty when its drawer closes is removed again. */
  private _drafts = new Map<string, { list: JsonPath; index: number }>();
  /** The control to focus after the next render (an item just added). */
  private _focusNext: string | null = null;
  /** What is typed in each number field being edited, by its id: it stays as
   *  typed (a number is stored as soon as it is one; other text is not, and
   *  is marked) until the field is left. */
  @state() private _numberText: ReadonlyMap<string, string> = new Map();
  /** The maps' paths in the last render (their entries are never pruned). */
  private _maps: JsonPath[] = [];
  /** What each card rendered this time opens, by its key. */
  private _targets = new Map<string, DrawerTarget>();
  /** How many of `_drawers` still had something to show at the last render. */
  private _shown = 0;
  /** Follows `drawerArea`'s size while a drawer is open. */
  private _areaObserver: ResizeObserver | null = null;
  private readonly _onWindowResize = (): void => this.requestUpdate();

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._watchArea(false);
  }

  /** While a drawer is open over `drawerArea`: re-place the drawers when it
   *  or the window changes size, and cover it (its tab's focus line hides). */
  private _watchArea(on: boolean): void {
    if (!on || !this.drawerArea) {
      this._areaObserver?.disconnect();
      this._areaObserver = null;
      window.removeEventListener("resize", this._onWindowResize);
      focusLineLayer().uncover(this);
      return;
    }
    focusLineLayer().cover(this, this.drawerArea);
    if (this._areaObserver) return;
    window.addEventListener("resize", this._onWindowResize);
    if (typeof ResizeObserver === "undefined") return;
    this._areaObserver = new ResizeObserver(() => this.requestUpdate());
    this._areaObserver.observe(this.drawerArea);
  }

  override willUpdate(changed: Map<string, unknown>): void {
    // A closed drawer forgets its view: it opens again as the form.
    const open = new Set(this._drawers);
    if ([...this._jsonViews].some((k) => !open.has(k))) {
      this._jsonViews = new Set([...this._jsonViews].filter((k) => open.has(k)));
    }
    if (changed.has("value")) {
      this._numberText = new Map();
      const v = this.value;
      this._value =
        v !== null && typeof v === "object" && !Array.isArray(v)
          ? (cloneDeep(v) as Record<string, unknown>)
          : {};
    }
    this._dropEmptyDrafts(open);
  }

  /** A new item whose drawer has closed with nothing entered is removed. */
  private _dropEmptyDrafts(open: ReadonlySet<string>): void {
    for (const [key, { list, index }] of this._drafts) {
      if (open.has(key)) continue;
      this._drafts.delete(key);
      const items = getAt(this._value, list);
      const item = Array.isArray(items) ? items[index] : undefined;
      const empty =
        item !== null &&
        typeof item === "object" &&
        !Array.isArray(item) &&
        Object.keys(item).length === 0;
      if (!empty || !Array.isArray(items)) continue;
      const rest = items.filter((_, i) => i !== index);
      if (rest.length === 0) this._reset(list);
      else this._set(list, rest);
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
    this._commit(resetField(this._value, path, this._maps));
  }

  /** Set a list (of values or objects) to `list`. */
  private _setList(f: FormField, list: unknown[]): void {
    this._set(f.path, list);
  }

  // ── Drawers ───────────────────────────────────────────────────────────

  /** Open `key`'s drawer in front of the drawer holding its card (or of none,
   *  for a card on the form). */
  private _openFrom(card: HTMLElement, key: string): void {
    const holder = card.closest<HTMLElement>(".jf-drawer")?.dataset.drawer;
    this._openAfter(holder ?? null, key);
  }

  /** Open `key`'s drawer in front of `parent`'s (null: as the first drawer). */
  private _openAfter(parent: string | null, key: string): void {
    const at = parent === null ? -1 : this._drawers.indexOf(parent);
    this._drawers = [...this._drawers.slice(0, at + 1), key];
  }

  /** Keep the first `n` drawers. */
  private _closeTo(n: number): void {
    if (n < this._drawers.length) this._drawers = this._drawers.slice(0, n);
  }

  /** A renamed map entry's drawers follow it. */
  private _renameDrawers(from: string, to: string): void {
    const follow = (k: string) =>
      k === from || k.startsWith(`${from}.`) || k.startsWith(`${from}[`)
        ? to + k.slice(from.length)
        : k;
    this._drawers = this._drawers.map(follow);
    this._jsonViews = new Set([...this._jsonViews].map(follow));
  }

  /** Show `key`'s drawer as JSON or as the form. */
  private _setView(key: string, json: boolean): void {
    const views = new Set(this._jsonViews);
    if (json) views.add(key);
    else views.delete(key);
    this._jsonViews = views;
  }

  override updated(changed: PropertyValues<this>): void {
    if (this._focusNext) {
      const id = this._focusNext;
      this._focusNext = null;
      const target = this.renderRoot.querySelector<HTMLElement>(`#${id}`);
      target?.focus();
      // Keep typing where the text ends.
      if (target instanceof HTMLInputElement && target.type === "text") {
        const end = target.value.length;
        target.setSelectionRange(end, end);
      }
    }
    if (changed.has("drawerArea")) this._watchArea(false);
    this._watchArea(this._drawers.length > 0);
    // A drawer whose value is gone (removed, reset) closes, with those in
    // front of it.
    if (this._shown < this._drawers.length) {
      this._drawers = this._drawers.slice(0, this._shown);
      return;
    }
    const key = "_drawers" as keyof JsonFormElement;
    if (!changed.has(key)) return;
    const before = (changed.get(key) as readonly string[] | undefined) ?? [];
    if (this._drawers.length > before.length) {
      this.renderRoot
        .querySelector<HTMLElement>(".jf-drawer--front")
        ?.focus({ preventScroll: true });
    } else if (this._drawers.length < before.length) {
      // Back to the card that opened the drawer just closed.
      const closed = before[this._drawers.length];
      const card = [...this.renderRoot.querySelectorAll<HTMLElement>(".jf-sub")].find(
        (c) => c.dataset.key === closed,
      );
      card?.focus({ preventScroll: true });
    }
  }

  // ── Render ────────────────────────────────────────────────────────────

  override render(): TemplateResult {
    const fields = formFields(this.schema, this._value, this.defaults, this.errors);
    this._maps = [];
    const walk = (fs: readonly FormField[]): void => {
      for (const f of fs) {
        if (f.kind === "map") this._maps.push(f.path);
        walk(f.fields ?? []);
        walk(f.entries ?? []);
        for (const item of f.items ?? []) walk(item);
      }
    };
    walk(fields);
    this._targets = new Map();
    const form = this._fields(fields);
    // Each drawer's card was rendered by the form or by the drawer behind it,
    // so what it opens is known by the time it renders.
    const open: OpenDrawer[] = [];
    for (const key of this._drawers) {
      const target = this._targets.get(key);
      if (!target) break;
      // The form body renders even in the JSON view: it registers the cards
      // the drawers in front of this one open.
      const form = target.body();
      open.push({
        key,
        target,
        body: this._jsonViews.has(key) ? this._drawerJson(target.path) : form,
      });
    }
    this._shown = open.length;
    return html`
      <div class="jf-scroll"><div class="jf">${form}</div></div>
      ${open.length ? this._layer(open) : nothing}
    `;
  }

  /** The drawers over the form: one mask, one shadow, then the drawers. The
   *  front one is 80% wide, the one behind it 90%, older ones hidden. */
  private _layer(open: readonly OpenDrawer[]): TemplateResult {
    const front = open.length - 1;
    const place = (i: number) => (i === front ? "front" : i === front - 1 ? "back" : "hidden");
    const area = this.drawerArea?.getBoundingClientRect();
    const placed = area
      ? `left:${area.left}px;top:${area.top}px;width:${area.width}px;height:${area.height}px`
      : "";
    return html`<div class="jf-layer ${area ? "jf-layer--area" : ""}" style=${placed}>
      <div class="jf-mask" @click=${() => this._closeTo(0)}></div>
      <div class="jf-drawer-shadow jf-drawer--${open.length > 1 ? "back" : "front"}"></div>
      ${repeat(
        open,
        (d) => d.key,
        (d, i) =>
          html`<section
            class="jf-drawer jf-drawer--${place(i)}"
            data-drawer=${d.key}
            role="dialog"
            aria-label=${d.target.label}
            tabindex="-1"
            @click=${{
              // Behind the front drawer only its strip shows: a click there
              // goes back to it, and does not reach what it hits. Decided as
              // the click comes in (capture): a real click lets the form
              // re-render between listeners, so by the time it bubbles out of
              // a card that opened a drawer, this drawer is already behind.
              capture: true,
              handleEvent: (e: Event) => {
                if (i !== front - 1) return;
                e.stopPropagation();
                this._closeTo(i + 1);
              },
            }}
            @keydown=${(e: KeyboardEvent) => {
              if (e.defaultPrevented) return;
              // Nothing in the form is in the tab order, and a drawer blocks
              // its cell: Tab does nothing.
              if (e.key === "Tab") e.preventDefault();
              if (e.key !== "Escape") return;
              e.preventDefault();
              e.stopPropagation();
              this._closeTo(i);
            }}
          >
            <header class="jf-drawer-head">
              <div class="jf-drawer-heading">
                <span class="jf-drawer-title">${d.target.label}</span>
              </div>
              <button
                tabindex="-1"
                type="button"
                class="jf-drawer-close"
                aria-label="Close ${d.target.label}"
                title="Close"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._closeTo(i);
                }}
              >
                ${REMOVE_ICON}
              </button>
            </header>
            <div class="jf-drawer-body ${this._jsonViews.has(d.key) ? "jf-drawer-body--json" : ""}">
              ${d.body}
            </div>
            <footer class="jf-drawer-foot">
              <span class="jf-foot-spacer"></span>
              ${this._jsonToggle(d.key)}
            </footer>
          </section>`,
      )}
    </div>`;
  }

  /** The bottom bar's JSON view toggle: on, the drawer shows its value as
   *  JSON; off (the default), the form. */
  private _jsonToggle(key: string): TemplateResult {
    const on = this._jsonViews.has(key);
    return html`<button
      tabindex="-1"
      type="button"
      class="jf-foot-btn ${on ? "jf-foot-btn--on" : ""}"
      aria-label="JSON view"
      aria-pressed=${on ? "true" : "false"}
      title="JSON view"
      @click=${() => this._setView(key, !on)}
    >
      ${JSON_ICON}
    </button>`;
  }

  /** A drawer's JSON view: its value with the defaults shown (as the
   *  Settings tab's JSON view with Show defaults); an edit stores only what
   *  differs from them, and values the user pinned to a default. */
  private _drawerJson(path: JsonPath): TemplateResult {
    const user = getAt(this._value, path);
    const defaults = getAt(this.defaults, path);
    const pinned = pinnedPaths(user, defaults);
    const shown =
      defaults === undefined ? user : user === undefined ? defaults : mergeDefaults(user, defaults);
    const store = (value: unknown) => {
      const kept = defaults === undefined ? value : stripDefaults(value, defaults, pinned);
      // Nothing left over the defaults (an object with no keys of its own):
      // the setting goes back to them.
      const nothingOwn =
        kept === undefined ||
        (defaults !== undefined &&
          kept !== null &&
          typeof kept === "object" &&
          !Array.isArray(kept) &&
          Object.keys(kept).length === 0);
      if (nothingOwn) this._reset(path);
      else this._set(path, kept);
    };
    return html`<json-editor
      class="jf-drawer-json"
      .value=${cloneDeep(shown ?? {})}
      .defaults=${defaults ?? null}
      .showDefaults=${true}
      .explicitPaths=${[...pinned]}
      .schema=${schemaAtPath(this.schema, path)}
      ?readonly=${this.readonly}
      @json-editor-change=${(e: CustomEvent<{ value: unknown }>) => {
        e.stopPropagation();
        store(e.detail.value);
      }}
      @json-editor-overwrite=${(e: CustomEvent<{ path: JsonPath; value: unknown }>) => {
        e.stopPropagation();
        if (!e.detail?.path?.length) return;
        const next = cloneDeep(user ?? {});
        setAt(next, e.detail.path, e.detail.value);
        this._set(path, next);
      }}
    ></json-editor>`;
  }

  /** A card that opens `key`'s drawer: its title, description and what it
   *  holds, with its own actions (Reset, Remove…) at the right. */
  private _card(
    key: string,
    show: {
      readonly title: string;
      readonly description?: string | null;
      readonly required?: boolean;
      readonly meta: readonly string[];
      readonly errors: number;
      readonly error?: string | null;
      readonly actions?: TemplateResult | typeof nothing;
    },
    target: DrawerTarget,
  ): TemplateResult {
    this._targets.set(key, target);
    const open = (e: Event) => this._openFrom(e.currentTarget as HTMLElement, key);
    return html`<div
      class="jf-sub"
      data-key=${key}
      role="button"
      tabindex="-1"
      aria-haspopup="dialog"
      @click=${open}
      @keydown=${(e: KeyboardEvent) => {
        if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          open(e);
        }
      }}
    >
      <div class="jf-sub-main">
        <div class="jf-sub-headline">
          <span class="jf-sub-title">${show.title}</span>
          ${show.required ? html`<span class="jf-required">Required</span>` : nothing}
        </div>
        ${
          show.description
            ? html`<div class="jf-description">
                ${unsafeHTML(renderMarkdown(show.description))}
              </div>`
            : nothing
        }
        <div class="jf-meta">
          ${show.meta.join(" · ")}
          ${
            show.errors
              ? html`<span class="jf-meta-error">· ${count(show.errors, "error", "errors")}</span>`
              : nothing
          }
        </div>
        ${show.error ? html`<div class="jf-error" role="alert">${show.error}</div>` : nothing}
      </div>
      ${
        show.actions && show.actions !== nothing
          ? html`<span
              class="jf-sub-actions"
              @click=${(e: Event) => e.stopPropagation()}
              @keydown=${(e: Event) => e.stopPropagation()}
            >
              ${show.actions}
            </span>`
          : nothing
      }
      <span class="jf-chev" aria-hidden="true">›</span>
    </div>`;
  }

  /** What an object's fields hold: how many, how many set, how many default. */
  private _fieldsMeta(fields: readonly FormField[]): string[] {
    const set = fields.filter((f) => f.set).length;
    const byDefault = fields.filter((f) => !f.set && f.hasDefault).length;
    return [
      count(fields.length, "property", "properties"),
      `${set} set`,
      ...(byDefault ? [`${byDefault} default`] : []),
    ];
  }

  /** What an object or array setting holds. */
  private _meta(f: FormField): string[] {
    const fromDefaults = !f.set && f.hasDefault ? ["default"] : [];
    const length = Array.isArray(f.value) ? f.value.length : 0;
    switch (f.kind) {
      case "group":
        return this._fieldsMeta(f.fields ?? []);
      case "list": {
        const [one, many] = ITEM_NOUNS[f.item?.kind ?? ""] ?? ["value", "values"];
        return [count(length, one, many), ...fromDefaults];
      }
      case "objects":
        return [count(length, "object", "objects"), ...fromDefaults];
      default: {
        const fromDefaultKeys = f.defaultKeys?.length ?? 0;
        return [
          count(f.entries?.length ?? 0, "entry", "entries"),
          ...(fromDefaultKeys ? [`${fromDefaultKeys} default`] : []),
        ];
      }
    }
  }

  /** An object or array setting: its card, and what its drawer shows. */
  private _fieldCard(f: FormField): TemplateResult {
    const body = (): TemplateResult => {
      const content =
        f.kind === "group"
          ? html`<div class="jf">${this._fields(f.fields ?? [])}</div>`
          : f.kind === "list"
            ? this._list(f)
            : f.kind === "objects"
              ? this._objects(f)
              : this._map(f);
      return html`${this._description(f)}${content}`;
    };
    return this._card(
      f.key,
      {
        title: f.label,
        description: f.description,
        required: f.required,
        meta: this._meta(f),
        errors: errorCount(f),
        error: f.error,
        actions: this._resetButton(f),
      },
      { label: f.label, path: f.path, body },
    );
  }

  /** A list of fields. Object and array settings next to each other whose
   *  names share a prefix (`editor/*`, `editor/file`…) are one card, a row
   *  each. */
  private _fields(fields: readonly FormField[]): TemplateResult[] {
    const prefix = (f: FormField): string | null => {
      if (!CARD_KINDS.includes(f.kind)) return null;
      const at = f.name.indexOf("/");
      return at > 0 ? f.name.slice(0, at + 1) : null;
    };
    const out: TemplateResult[] = [];
    for (let i = 0; i < fields.length;) {
      const p = prefix(fields[i]);
      let j = i + 1;
      while (p !== null && j < fields.length && prefix(fields[j]) === p) j++;
      const run = fields.slice(i, j);
      out.push(
        run.length > 1
          ? html`<div class="jf-sub-group">${run.map((f) => this._field(f))}</div>`
          : this._field(fields[i]),
      );
      i = j;
    }
    return out;
  }

  private _field(f: FormField): TemplateResult {
    if (CARD_KINDS.includes(f.kind)) return this._fieldCard(f);
    const id = idFor(f.key);
    const faded = !f.set && f.hasDefault;
    const labelled = !["list", "objects", "map", "unsupported"].includes(f.kind);
    const reset = this._resetButton(f);
    const inRow = ROW_KINDS.includes(f.kind);
    return html`
      <div
        class="jf-field ${faded ? "jf-default" : ""} ${f.readOnly ? "jf-readonly" : ""}"
        data-key=${f.key}
      >
        <div class="jf-head">
          ${
            labelled
              ? html`<label class="jf-label" for=${id}>${f.label}</label>`
              : html`<span class="jf-label" id=${id}>${f.label}</span>`
          }
          ${f.required ? html`<span class="jf-required">Required</span>` : nothing}
          ${inRow ? nothing : reset}
        </div>
        ${this._description(f)}
        ${
          inRow
            ? html`<div class="jf-row ${f.kind === "boolean" ? "" : "jf-input-card"}">
                ${this._control(f, id)}${reset}
              </div>`
            : this._control(f, id)
        }
        ${
          f.kind === "number" && this._notANumber(id, !!f.integer)
            ? html`<div class="jf-error" role="alert">${numberHint(!!f.integer)}</div>`
            : nothing
        }
        ${f.error ? html`<div class="jf-error" role="alert">${f.error}</div>` : nothing}
      </div>
    `;
  }

  /** Keep `text` as what is typed in the number field `id` (null: none). */
  private _setNumberText(id: string, text: string | null): void {
    if (text === null && !this._numberText.has(id)) return;
    const next = new Map(this._numberText);
    if (text === null) next.delete(id);
    else next.set(id, text);
    this._numberText = next;
  }

  /** Whether the number field `id` holds text that is not a number. */
  private _notANumber(id: string, integer: boolean): boolean {
    const text = this._numberText.get(id);
    return text !== undefined && text.trim() !== "" && parseNumber(text, integer) === null;
  }

  /** Reset: on every setting with a default (greyed out while unset), and
   *  on a set one without (it clears it). */
  private _resetButton(f: FormField): TemplateResult | typeof nothing {
    if (this.readonly || f.kind === "unsupported" || !(f.hasDefault || f.set)) return nothing;
    return html`<button
      tabindex="-1"
      type="button"
      class="jf-icon-btn jf-reset"
      aria-label="Reset ${f.label}"
      title=${f.hasDefault ? "Use the default" : "Clear"}
      ?disabled=${!f.set}
      @click=${() => {
        this._setNumberText(idFor(f.key), null);
        this._reset(f.path);
      }}
    >
      ${RESET_ICON}
    </button>`;
  }

  private _description(f: FormField): TemplateResult | typeof nothing {
    return f.description
      ? html`<div class="jf-description">${unsafeHTML(renderMarkdown(f.description))}</div>`
      : nothing;
  }

  private _control(f: FormField, id: string): TemplateResult {
    const placeholder = f.hasDefault ? "" : "Not set";
    const locked = this.readonly || f.readOnly === true;
    switch (f.kind) {
      case "boolean":
        return html`<openp41ge-toggle
          no-tab
          id=${id}
          .checked=${f.value === true}
          .label=${f.label}
          ?disabled=${locked}
          @change=${(e: CustomEvent<{ checked: boolean }>) => this._set(f.path, e.detail.checked)}
        ></openp41ge-toggle>`;
      case "number":
        return this._numberInput(id, f.value, f, (v) =>
          v === undefined ? this._reset(f.path) : this._set(f.path, v),
        );
      case "enum":
        return this._select(
          id,
          f.value,
          f.options ?? [],
          !f.set && !f.hasDefault,
          (v) => (v === undefined ? this._reset(f.path) : this._set(f.path, v)),
          "Not set",
          null,
          locked,
        );
      case "string":
      case "secret":
        return html`<input
          tabindex="-1"
          class="jf-input"
          id=${id}
          type=${f.kind === "secret" ? "password" : "text"}
          autocomplete=${f.kind === "secret" ? "off" : nothing}
          spellcheck="false"
          placeholder=${f.nullable ? "null" : placeholder}
          .value=${typeof f.value === "string" ? f.value : ""}
          ?disabled=${locked}
          @input=${(e: Event) => {
            const text = (e.target as HTMLInputElement).value;
            // Clearing a value that may be null sets null; clearing a
            // setting with no default removes it.
            if (text === "" && f.nullable) this._set(f.path, null);
            else if (text === "" && !f.hasDefault) this._reset(f.path);
            else this._set(f.path, text);
          }}
        />`;
      case "list":
        return this._list(f);
      case "objects":
        return this._objects(f);
      case "map":
        return this._map(f);
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

  /** A number field: a text field that takes a number (a whole one for an
   *  integer); text that is not one is kept, marked, and not stored. */
  private _numberInput(
    id: string,
    value: unknown,
    limits: { integer?: boolean; hasDefault?: boolean; readOnly?: boolean },
    onChange: (v: number | undefined) => void,
    label: string | null = null,
  ): TemplateResult {
    const integer = !!limits.integer;
    const typed = this._numberText.get(id);
    const invalid = this._notANumber(id, integer);
    return html`<input
      tabindex="-1"
      class="jf-input jf-number"
      id=${id}
      type="text"
      inputmode=${integer ? "numeric" : "decimal"}
      autocomplete="off"
      spellcheck="false"
      aria-label=${label ?? nothing}
      aria-invalid=${invalid ? "true" : "false"}
      title=${invalid ? numberHint(integer) : ""}
      placeholder=${limits.hasDefault === false ? "Not set" : ""}
      .value=${live(typed ?? (typeof value === "number" ? String(value) : ""))}
      ?disabled=${this.readonly || limits.readOnly === true}
      @input=${(e: Event) => {
        const text = (e.target as HTMLInputElement).value;
        this._setNumberText(id, text);
        if (text.trim() === "") return onChange(undefined);
        const n = parseNumber(text, integer);
        if (n !== null) onChange(n);
      }}
      @blur=${() => {
        // Leaving the field shows the stored number, unless what is typed
        // is not one (it stays, marked).
        if (!this._notANumber(id, integer)) this._setNumberText(id, null);
      }}
    />`;
  }

  private _select(
    id: string,
    value: unknown,
    options: readonly unknown[],
    withEmpty: boolean,
    onChange: (v: unknown) => void,
    placeholder = "Not set",
    label: string | null = null,
    disabled = this.readonly,
  ): TemplateResult {
    const selected = options.findIndex((o) => JSON.stringify(o) === JSON.stringify(value));
    const choices = [
      ...(withEmpty ? [{ value: "", label: "Not set" }] : []),
      ...options.map((o, i) => ({
        value: String(i),
        label: typeof o === "string" ? o : JSON.stringify(o),
      })),
    ];
    return html`<openp41ge-select
      no-tab
      class="jf-input jf-select"
      id=${id}
      .options=${choices}
      .value=${selected < 0 ? "" : String(selected)}
      placeholder=${placeholder}
      label=${label ?? nothing}
      align-to=".jf-input-card"
      ?disabled=${disabled}
      @change=${(e: CustomEvent<{ value: string }>) => {
        e.stopPropagation();
        const idx = e.detail.value;
        onChange(idx === "" ? undefined : options[Number(idx)]);
      }}
    ></openp41ge-select>`;
  }

  /** A list of values: one control per item, with Remove, and an empty row
   *  last: what is entered there is a new item (and a new empty row follows). */
  private _list(f: FormField): TemplateResult {
    const list = Array.isArray(f.value) ? f.value : [];
    const kind = f.item!;
    const edit = (i: number, v: unknown) => {
      const next = [...list];
      next[i] = v;
      this._setList(f, next);
    };
    return html`
      <div class="jf-list" role="group" aria-label=${f.label}>
        ${list.map((item, i) => {
          const id = idFor(`${f.key}[${i}]`);
          const control =
            kind.kind === "boolean"
              ? html`<openp41ge-toggle
                  no-tab
                  id=${id}
                  .checked=${item === true}
                  .label=${`${f.label} item ${i + 1}`}
                  ?disabled=${this.readonly}
                  @change=${(e: CustomEvent<{ checked: boolean }>) => edit(i, e.detail.checked)}
                ></openp41ge-toggle>`
              : kind.kind === "number"
                ? this._numberInput(
                    id,
                    item,
                    { integer: kind.integer },
                    (v) => edit(i, v ?? 0),
                    `${f.label} item ${i + 1}`,
                  )
                : kind.kind === "enum"
                  ? this._select(id, item, kind.options ?? [], false, (v) => edit(i, v))
                  : html`<input
                      tabindex="-1"
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
              tabindex="-1"
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
        ${this.readonly ? nothing : this._newListRow(f, list)}
      </div>
    `;
  }

  /** A list's empty last row: entering a value there adds it as an item,
   *  and the typing carries on in that item. */
  private _newListRow(f: FormField, list: readonly unknown[]): TemplateResult {
    const kind = f.item!;
    const label = `New item of ${f.label}`;
    const add = (v: unknown) => {
      this._focusNext = idFor(`${f.key}[${list.length}]`);
      this._setList(f, [...list, v]);
    };
    const id = idFor(`${f.key}[new]`);
    const control =
      kind.kind === "boolean"
        ? html`<button
            tabindex="-1"
            type="button"
            class="jf-input jf-new-btn"
            aria-label=${label}
            @click=${() => add(newListItem(kind))}
          >
            New item
          </button>`
        : kind.kind === "enum"
          ? this._select(id, undefined, kind.options ?? [], false, add, "New item", label)
          : kind.kind === "number"
            ? this._newNumberRow(id, label, kind.integer, (n, text) => {
                // The new item keeps the text as typed ("1." stays "1.").
                this._setNumberText(idFor(`${f.key}[${list.length}]`), text);
                add(n);
              })
            : html`<input
                tabindex="-1"
                class="jf-input"
                id=${id}
                type="text"
                spellcheck="false"
                placeholder="New item"
                aria-label=${label}
                .value=${live("")}
                @input=${(e: Event) => {
                  const text = (e.target as HTMLInputElement).value;
                  if (text !== "") add(text);
                }}
              />`;
    return html`<div class="jf-list-item jf-new">${control}</div>`;
  }

  /** A number list's empty row: a number typed there is a new item; other
   *  text stays, marked. */
  private _newNumberRow(
    id: string,
    label: string,
    integer: boolean,
    add: (n: number, text: string) => void,
  ): TemplateResult {
    const invalid = this._notANumber(id, integer);
    return html`<input
      tabindex="-1"
      class="jf-input jf-number"
      id=${id}
      type="text"
      inputmode=${integer ? "numeric" : "decimal"}
      autocomplete="off"
      spellcheck="false"
      placeholder="New item"
      aria-label=${label}
      aria-invalid=${invalid ? "true" : "false"}
      title=${invalid ? numberHint(integer) : ""}
      .value=${live(this._numberText.get(id) ?? "")}
      @input=${(e: Event) => {
        const text = (e.target as HTMLInputElement).value;
        const n = text.trim() === "" ? null : parseNumber(text, integer);
        if (n === null) return this._setNumberText(id, text === "" ? null : text);
        this._setNumberText(id, null);
        add(n, text);
      }}
    />`;
  }

  /** A list of objects: a card per item (it opens the item's drawer), with
   *  move and remove, and an empty card last: it opens a drawer for a new
   *  item (removed again if left empty). */
  private _objects(f: FormField): TemplateResult {
    const list = Array.isArray(f.value) ? f.value : [];
    const items = f.items ?? [];
    const move = (i: number, d: number) => {
      const next = [...list];
      [next[i], next[i + d]] = [next[i + d], next[i]];
      this._setList(f, next);
    };
    const remove = (i: number) =>
      this._setList(
        f,
        list.filter((_, j) => j !== i),
      );
    const add = () => {
      const key = `${f.key}[${list.length}]`;
      this._drafts.set(key, { list: f.path, index: list.length });
      this._openAfter(f.key, key);
      this._setList(f, [...list, {}]);
    };
    return html`
      <div class="jf-subs" role="group" aria-label=${f.label}>
        ${items.map((fields, i) => {
          const n = i + 1;
          const title = itemTitle(fields, i);
          return this._card(
            `${f.key}[${i}]`,
            {
              title,
              meta: this._fieldsMeta(fields),
              errors: fields.reduce((sum, child) => sum + errorCount(child), 0),
              actions: html`
                <button
                  tabindex="-1"
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
                  tabindex="-1"
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
                  tabindex="-1"
                  type="button"
                  class="jf-icon-btn jf-x"
                  aria-label="Remove item ${n} of ${f.label}"
                  title="Remove"
                  ?disabled=${this.readonly}
                  @click=${() => remove(i)}
                >
                  ${REMOVE_ICON}
                </button>
              `,
            },
            {
              label: title,
              path: [...f.path, i],
              body: () => html`<div class="jf">${this._fields(fields)}</div>`,
            },
          );
        })}
        ${
          this.readonly
            ? nothing
            : html`<div
                class="jf-sub jf-new"
                role="button"
                tabindex="-1"
                aria-haspopup="dialog"
                aria-label="New item of ${f.label}"
                @click=${add}
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    add();
                  }
                }}
              >
                <div class="jf-sub-main"><span class="jf-sub-title">New item</span></div>
                <span class="jf-chev" aria-hidden="true">›</span>
              </div>`
        }
      </div>
    `;
  }

  /** A map: a card per object entry (it opens the entry's drawer, with its
   *  key) or a row per value, and an empty row last that takes a new key:
   *  Enter, or leaving it, adds the entry (a taken key is marked, not added). */
  private _map(f: FormField): TemplateResult {
    const entries = f.entries ?? [];
    const keys = entries.map((e) => e.name);
    const fromDefaults = new Set(f.defaultKeys ?? []);
    const userMap = (): Record<string, unknown> => {
      const v = getAt(this._value, f.path);
      return v !== null && typeof v === "object" && !Array.isArray(v)
        ? (v as Record<string, unknown>)
        : {};
    };
    const newKey = this._newKeys.get(f.key) ?? "";
    const taken = keys.includes(newKey.trim());
    const canAdd = newKey.trim() !== "" && !taken;
    const setNewKey = (text: string) => {
      const next = new Map(this._newKeys);
      next.set(f.key, text);
      this._newKeys = next;
    };
    const add = () => {
      if (!canAdd) return;
      const key = newKey.trim();
      setNewKey("");
      if (f.objectValues) this._openAfter(f.key, `${f.key}.${key}`);
      else this._focusNext = idFor(`${f.key}.${key}`);
      this._set([...f.path, key], cloneDeep(f.newEntry ?? null));
    };
    const remove = (key: string) => {
      const { [key]: _removed, ...rest } = userMap();
      if (Object.keys(rest).length === 0) this._reset(f.path);
      else this._set(f.path, rest);
    };
    const rename = (from: string, input: HTMLInputElement) => {
      const to = input.value.trim();
      if (!to || to === from || keys.includes(to)) {
        input.value = from;
        return;
      }
      const map = Object.fromEntries(
        Object.entries(userMap()).map(([k, v]) => [k === from ? to : k, v]),
      );
      let next = setFieldValue(this._value, this.defaults, f.path, map);
      // The setting that names this entry follows it.
      if (f.marked && f.marked.key === from) {
        next = setFieldValue(next, this.defaults, f.marked.path, to);
      }
      this._renameDrawers(`${f.key}.${from}`, `${f.key}.${to}`);
      this._commit(next);
    };
    const removeButton = (key: string) =>
      html`<button
        tabindex="-1"
        type="button"
        class="jf-icon-btn jf-x"
        aria-label="Remove ${key} from ${f.label}"
        title=${fromDefaults.has(key) ? "A default entry: it cannot be removed" : "Remove"}
        ?disabled=${this.readonly || fromDefaults.has(key)}
        @click=${() => remove(key)}
      >
        ${REMOVE_ICON}
      </button>`;
    const marked = f.marked;
    const markActions = (key: string) => {
      if (!marked) return nothing;
      return marked.key === key
        ? html`<span class="jf-pill">Default</span>`
        : html`<button
            tabindex="-1"
            type="button"
            class="jf-add jf-make"
            aria-label="Make ${key} the ${marked.label.toLowerCase()}"
            ?disabled=${this.readonly}
            @click=${() => this._set(marked.path, key)}
          >
            Make default
          </button>`;
    };
    const card = (e: FormField) => {
      const locked = this.readonly || fromDefaults.has(e.name);
      const fields = e.fields ?? [e];
      return this._card(
        e.key,
        {
          title: e.name,
          meta: this._fieldsMeta(fields),
          errors: errorCount(e),
          actions: html`${markActions(e.name)} ${removeButton(e.name)}`,
        },
        {
          label: e.name,
          path: e.path,
          body: () =>
            html`<div class="jf">
              <div class="jf-field">
                <label class="jf-label" for=${idFor(`${e.key}.__key`)}>Key</label>
                <input
                  tabindex="-1"
                  class="jf-input"
                  id=${idFor(`${e.key}.__key`)}
                  type="text"
                  spellcheck="false"
                  aria-label="Key of ${e.name}"
                  title=${fromDefaults.has(e.name) ? "A default entry: it cannot be renamed" : ""}
                  .value=${live(e.name)}
                  ?disabled=${locked}
                  @change=${(ev: Event) => rename(e.name, ev.target as HTMLInputElement)}
                />
              </div>
              ${this._fields(fields)}
            </div>`,
        },
      );
    };
    const row = (e: FormField) =>
      html`<div class="jf-map-row ${e.error ? "jf-map-row--error" : ""}" data-key=${e.key}>
        <span class="jf-map-key">${e.name}</span>
        ${this._control(e, idFor(e.key))} ${markActions(e.name)} ${removeButton(e.name)}
        ${e.error ? html`<div class="jf-error" role="alert">${e.error}</div>` : nothing}
      </div>`;
    const addRow = this.readonly
      ? nothing
      : html`<div class="jf-map-add jf-new">
          <input
            tabindex="-1"
            class="jf-input"
            type="text"
            spellcheck="false"
            placeholder="New key"
            aria-label="New key for ${f.label}"
            aria-invalid=${taken ? "true" : "false"}
            title=${taken ? "That key is taken" : ""}
            .value=${live(newKey)}
            @input=${(e: Event) => setNewKey((e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter") add();
            }}
            @change=${add}
          />
        </div>`;
    // A map of objects ends in an empty card like its others: the key on the
    // title line, what a new entry holds below, the chevron greyed until the
    // key can be added.
    const addCard = this.readonly
      ? nothing
      : html`<div
          class="jf-sub jf-new jf-new-card"
          @click=${(e: Event) =>
            (e.currentTarget as HTMLElement).querySelector<HTMLInputElement>("input")?.focus()}
        >
          <div class="jf-sub-main">
            <input
              tabindex="-1"
              class="jf-new-key"
              type="text"
              spellcheck="false"
              placeholder="New key"
              aria-label="New key for ${f.label}"
              aria-invalid=${taken ? "true" : "false"}
              .value=${live(newKey)}
              @input=${(e: Event) => setNewKey((e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => {
                if (e.key === "Enter") add();
              }}
              @change=${add}
            />
            <div class="jf-meta">
              ${count(f.entryProperties ?? 0, "property", "properties")} · 0 set
              ${taken ? html`<span class="jf-meta-error">· That key is taken</span>` : nothing}
            </div>
          </div>
          <span
            class="jf-chev"
            role="button"
            aria-label="Add ${newKey.trim() || "the new key"} to ${f.label}"
            aria-disabled=${canAdd ? "false" : "true"}
            @click=${(e: Event) => {
              e.stopPropagation();
              add();
            }}
            >›</span
          >
        </div>`;
    return f.objectValues
      ? html`<div class="jf-subs" role="group" aria-label=${f.label}>
          ${entries.map(card)} ${addCard}
        </div>`
      : html`<div class="jf-card" role="group" aria-label=${f.label}>
          ${entries.map(row)} ${addRow}
        </div>`;
  }

  static override styles = css`
    /* Nothing in the form shows a focus outline (nor is it in the tab order:
       every control has tabindex -1). */
    *:focus,
    *:focus-visible {
      outline: none;
    }
    :host {
      display: block;
      position: relative;
      color: var(--text-primary, #ddd);
      font-family: var(--font-ui, system-ui, sans-serif);
      font-size: 12px;
    }
    /* The form scrolls itself, so the drawers cover what is in view. */
    .jf-scroll {
      box-sizing: border-box;
      height: 100%;
      overflow: auto;
      padding: var(--jf-padding, 0);
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
    /* Reset sits at the right: of the head, or of the control's row. */
    .jf-reset {
      margin-left: auto;
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
      background: var(--jf-input-bg, var(--bg-tertiary, #2a2a2a));
      color: var(--text-primary, #ddd);
      font: inherit;
      font-size: 12px;
    }
    .jf-input:focus {
      outline: none;
      background: var(
        --jf-input-focus-bg,
        color-mix(in srgb, var(--bg-tertiary, #2a2a2a) 92%, #fff)
      );
    }
    .jf-input:disabled {
      opacity: 0.6;
    }
    /* The toolkit's dropdown: its trigger pads itself. */
    .jf-select {
      padding: 0;
    }
    .jf-select:focus-within {
      background: var(
        --jf-input-focus-bg,
        color-mix(in srgb, var(--bg-tertiary, #2a2a2a) 92%, #fff)
      );
    }
    .jf-row {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .jf-row > .jf-input {
      flex: 1;
      min-width: 0;
    }
    /* An input with Reset: the card holds both, Reset inside at its right. */
    .jf-input-card {
      gap: 0;
      padding-right: 4px;
      border-radius: 4px;
      background: var(--jf-input-bg, var(--bg-tertiary, #2a2a2a));
    }
    .jf-input-card:focus-within {
      background: var(
        --jf-input-focus-bg,
        color-mix(in srgb, var(--bg-tertiary, #2a2a2a) 92%, #fff)
      );
    }
    .jf-input-card > .jf-input,
    .jf-input-card > .jf-input:focus {
      background: transparent;
    }
    .jf-input-card > .jf-reset {
      background: transparent;
    }
    /* An unset field shows its default, faded. */
    .jf-default > .jf-row > .jf-input:not(.jf-select),
    .jf-default > .jf-row > .jf-select::part(trigger),
    .jf-default > .jf-row > openp41ge-toggle {
      opacity: 0.55;
    }
    .jf-default > .jf-row > .jf-input:focus {
      opacity: 1;
    }
    /* A read-only setting (shown, not edited): its label and control greyed. */
    .jf-readonly > .jf-head > .jf-label,
    .jf-readonly > .jf-row > .jf-input:not(.jf-select),
    .jf-readonly > .jf-row > .jf-select::part(trigger),
    .jf-readonly > .jf-row > openp41ge-toggle {
      opacity: 0.55;
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
      background: var(--jf-input-bg, var(--bg-tertiary, #2a2a2a));
      font-family: var(--font-mono, ui-monospace, monospace);
      font-size: 11px;
      color: var(--text-secondary, #999);
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
    /* A map's rows of values. */
    .jf-card {
      border: 1px solid var(--divider, #333);
      border-radius: 6px;
      background: var(--jf-card-bg, var(--bg-secondary, #161616));
      overflow: hidden;
    }
    /* An object or array: a card that opens its drawer. */
    .jf-subs {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .jf-sub {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 12px;
      border-radius: 6px;
      background: var(--jf-input-bg, var(--bg-tertiary, #2a2a2a));
      cursor: pointer;
      user-select: none;
    }
    .jf-sub:hover {
      background: var(
        --jf-input-focus-bg,
        color-mix(in srgb, var(--bg-tertiary, #2a2a2a) 92%, #fff)
      );
    }
    /* Reset on a card is drawn like Reset in an input's card. */
    .jf-sub-actions > .jf-reset {
      background: transparent;
    }
    .jf-sub-main {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
      gap: 3px;
    }
    .jf-sub-headline {
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .jf-sub-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
    }
    .jf-meta {
      color: var(--text-secondary, #999);
      font-size: 11px;
    }
    .jf-meta-error {
      color: var(--jf-error, #f44747);
    }
    .jf-sub-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      cursor: default;
    }
    .jf-chev {
      flex-shrink: 0;
      width: 14px;
      text-align: center;
      font-size: 16px;
      color: var(--text-secondary, #999);
    }
    /* The drawers: over the form, sliding in from the right. One mask and
       one shadow for the whole stack; the drawers cast none. */
    .jf-layer {
      position: absolute;
      inset: 0;
      z-index: 10;
      overflow: hidden;
    }
    /* Over the host's area (its cell, tab bar included), placed from its box. */
    .jf-layer--area {
      position: fixed;
      inset: auto;
      z-index: 100;
    }
    .jf-mask {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      animation: jf-fade 0.18s ease-out;
    }
    /* It runs past the top and bottom (the layer clips it): a blur ending
       at the area's edge would fade there and round the drawers' corners. */
    .jf-drawer-shadow {
      position: absolute;
      top: -24px;
      right: 0;
      bottom: -24px;
      box-shadow: -2px 0 12px rgba(0, 0, 0, 0.45);
      transition: width 0.18s ease-out;
      animation: jf-slide 0.18s ease-out;
    }
    .jf-drawer {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      border-left: 1px solid var(--border-divider, var(--divider, #2d2d2d));
      background: var(--bg-primary, #1e1e1e);
      color: var(--text-primary, #d4d4d4);
      transition: width 0.18s ease-out;
      animation: jf-slide 0.18s ease-out;
    }
    .jf-drawer:focus {
      outline: none;
    }
    .jf-drawer--front {
      width: 80%;
    }
    .jf-drawer--back {
      width: 90%;
    }
    /* Hidden only once the drawer in front has widened over it, so it does
       not vanish in front of the user (showing it again is immediate). */
    .jf-drawer--hidden {
      width: 90%;
      visibility: hidden;
      transition:
        width 0.18s ease-out,
        visibility 0s 0.18s;
    }
    /* Behind the front drawer only a strip shows: it goes back. */
    .jf-drawer.jf-drawer--back {
      cursor: pointer;
    }
    @keyframes jf-slide {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(0);
      }
    }
    @keyframes jf-fade {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }
    .jf-drawer-head {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      gap: 8px;
      /* As tall as the tab bar it covers. */
      height: 35px;
      box-sizing: border-box;
      padding-left: 16px;
      border-bottom: 1px solid var(--border-divider, var(--divider, #2d2d2d));
      background: var(--bg-surface, #161616);
    }
    /* One line: the drawer's name. */
    .jf-drawer-heading {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .jf-drawer-title {
      font-weight: 600;
    }
    .jf-drawer-close {
      flex-shrink: 0;
      align-self: stretch;
      width: 35px;
      display: grid;
      place-items: center;
      padding: 0;
      border: none;
      border-left: 1px solid var(--border-divider, var(--divider, #2d2d2d));
      background: transparent;
      color: var(--text-secondary, #999);
      cursor: pointer;
    }
    .jf-drawer-close svg {
      width: 16px;
      height: 16px;
    }
    .jf-drawer-close:hover {
      color: var(--text-primary, #ddd);
      background: var(--jf-hover, rgba(255, 255, 255, 0.06));
    }
    .jf-drawer-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
    }
    /* The JSON view: the editor fills the drawer. */
    .jf-drawer-body--json {
      padding: 0;
      overflow: hidden;
    }
    .jf-drawer-json {
      flex: 1;
      min-height: 0;
    }
    /* The bottom bar: as the Settings tab's. */
    .jf-drawer-foot {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      height: 34px;
      box-sizing: border-box;
      border-top: 1px solid var(--divider, #333);
      background: var(--bg-surface, #161616);
    }
    .jf-foot-spacer {
      flex: 1;
    }
    .jf-foot-btn {
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
    .jf-foot-btn:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .jf-foot-btn--on {
      color: var(--accent, #569cd6);
    }
    .jf-foot-btn svg {
      width: 14px;
      height: 14px;
    }
    /* The corner button: 8px in from the window's rounded corner (the grid
       and a sidebar publish --grid-edge-right-pad where one is). */
    .jf-foot-btn:last-child {
      box-sizing: content-box;
      padding-right: var(--grid-edge-right-pad, 0px);
    }
    /* Maps: the Add row takes the new key. */
    .jf-map-add {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
    }
    .jf-subs > .jf-map-add {
      padding: 0;
    }
    /* Grouped settings (editor/*, editor/file…): one card, a row each. */
    .jf-sub-group {
      display: flex;
      flex-direction: column;
      border-radius: 6px;
      overflow: hidden;
    }
    .jf-sub-group > .jf-sub {
      border-radius: 0;
    }
    .jf-sub-group > .jf-sub + .jf-sub {
      border-top: 1px solid var(--divider, #333);
    }
    /* The empty last row (a new item or key): drawn faint until used. Its
       dashed edge is an outline, so it is exactly a card's size. */
    .jf-sub.jf-new {
      background: transparent;
      outline: 1px dashed var(--divider, #333);
      outline-offset: -1px;
    }
    .jf-sub.jf-new-card {
      cursor: text;
    }
    /* A map's new key, typed on the card's title line. */
    .jf-new-key {
      box-sizing: border-box;
      width: 100%;
      padding: 0;
      border: none;
      outline: none;
      background: transparent;
      color: var(--text-primary, #ddd);
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      line-height: inherit;
    }
    .jf-new-key::placeholder {
      font-weight: 400;
      color: var(--text-secondary, #999);
    }
    .jf-new-card .jf-chev {
      cursor: pointer;
    }
    .jf-chev[aria-disabled="true"] {
      opacity: 0.35;
      cursor: default;
    }
    .jf-sub.jf-new:hover {
      background: var(--jf-hover, rgba(255, 255, 255, 0.04));
    }
    .jf-sub.jf-new .jf-sub-title {
      font-weight: 400;
      color: var(--text-secondary, #999);
    }
    .jf-new-btn {
      text-align: left;
      color: var(--text-secondary, #999);
      cursor: pointer;
    }
    .jf-number[aria-invalid="true"],
    .jf-new .jf-input[aria-invalid="true"] {
      box-shadow: inset 0 0 0 1px var(--jf-error, #f44747);
    }
    .jf-map-add .jf-input {
      flex: 1;
    }
    .jf-map-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
    }
    .jf-card > .jf-map-row + .jf-map-row,
    .jf-card > .jf-map-row + .jf-map-add {
      border-top: 1px solid var(--divider, #2a2a2a);
    }
    .jf-map-key {
      flex: 0 0 30%;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
    }
    .jf-map-row > .jf-input {
      flex: 1;
      width: auto;
    }
    .jf-map-row > .jf-error {
      flex-basis: 100%;
    }
    .jf-pill {
      padding: 1px 6px;
      border-radius: 8px;
      background: color-mix(in srgb, var(--accent, #569cd6) 22%, transparent);
      color: var(--accent, #569cd6);
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .jf-make {
      padding: 1px 6px;
      font-size: 11px;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "json-form": JsonFormElement;
  }
}
