/**
 * file-diff-view.ts — the File diff tab: one file as an inline diff in the
 * UI toolkit's read-only `<file-editor>` — the whole file, highlighted, with
 * the added rows green and the removed rows spliced back in red.
 *
 * The tab's params (its saved config): `{ repoName, path, hash?, branch? }`.
 * With `hash`, that commit's change to the file; without, the file in the
 * `branch` worktree against HEAD (its uncommitted change). The backend builds
 * the document (`file-diff`); `<git-file-diff>` loads it into the editor.
 */

import { html, LitElement, type PropertyValues, type TemplateResult } from "lit";
import "openp41ge-sdk-uikit/file-editor";
import { PieceTreeTextContentModel, type FileEditorElement } from "openp41ge-sdk-uikit/file-editor";
import type { InlineDiffFile } from "./build-inline-diff-file.js";

/** What the backend's `file-diff` command is asked. */
export interface FileDiffRequest {
  readonly repo: string;
  readonly path: string;
  readonly hash?: string;
  readonly worktree?: string;
}

/** The backend's answer envelope. */
type Answer = { ok: true; result: InlineDiffFile | null } | { ok: false; error: string };

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** The request a tab's params make, or null without a repo and path. */
export function fileDiffRequest(params: Readonly<Record<string, unknown>>): FileDiffRequest | null {
  const repo = str(params.repoName);
  const path = str(params.path);
  if (!repo || !path) return null;
  const hash = str(params.hash);
  const worktree = str(params.branch);
  return { repo, path, ...(hash ? { hash } : {}), ...(worktree && !hash ? { worktree } : {}) };
}

/** The tab's label: the file's name, and the commit (or "uncommitted"). */
export function fileDiffTabLabel(params: Readonly<Record<string, unknown>>): {
  title?: string;
  description?: string;
} {
  const path = str(params.path);
  if (!path) return {};
  const hash = str(params.hash);
  return {
    title: path.split("/").filter(Boolean).pop() ?? path,
    description: hash ? hash.slice(0, 7) : "uncommitted",
  };
}

/** The surface host, as far as this view uses it. */
export interface FileDiffHost {
  readonly context: Readonly<Record<string, unknown>>;
  dispatch(command: string, payload?: Readonly<Record<string, unknown>>): Promise<unknown>;
}

/** The File diff render function. */
export function renderFileDiff(host: FileDiffHost): TemplateResult {
  const request = fileDiffRequest(host.context ?? {});
  return html`<git-file-diff
    style="display:block;width:100%;height:100%"
    .request=${request}
    .load=${(r: FileDiffRequest) =>
      host.dispatch("file-diff", r as unknown as Record<string, unknown>) as Promise<Answer>}
  ></git-file-diff>`;
}

const sameRequest = (a: FileDiffRequest | null, b: FileDiffRequest | null): boolean =>
  JSON.stringify(a) === JSON.stringify(b);

/** Loads one file's inline diff into a read-only `<file-editor>`. */
export class GitFileDiff extends LitElement {
  static override properties = {
    request: { attribute: false },
    load: { attribute: false },
    _message: { state: true },
  };

  declare request: FileDiffRequest | null;
  declare load: ((request: FileDiffRequest) => Promise<Answer>) | null;
  declare _message: string;

  private _editor: FileEditorElement | null = null;
  private _loaded: FileDiffRequest | null = null;
  private _token = 0;

  constructor() {
    super();
    this.request = null;
    this.load = null;
    this._message = "";
  }

  // Light DOM: the editor sizes against the cell like any other content.
  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  protected override updated(changed: PropertyValues): void {
    if (changed.has("request") && !sameRequest(this.request, this._loaded)) {
      void this._fetch();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._token += 1;
    this._loaded = null;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    // Re-attached (a tab switch): load again if a disconnect dropped it.
    if (this.hasUpdated && !this._loaded) void this._fetch();
  }

  private async _fetch(): Promise<void> {
    const request = this.request;
    const token = ++this._token;
    this._loaded = request;
    if (!request || !this.load) {
      this._message = "File diff unavailable";
      return;
    }
    let answer: Answer;
    try {
      answer = await this.load(request);
    } catch (err) {
      answer = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    if (token !== this._token) return;
    if (!answer.ok) {
      this._message = answer.error;
      return;
    }
    const file = answer.result;
    if (!file || file.rows.length === 0) {
      this._message = request.hash
        ? "No textual diff for this file at this commit"
        : "No textual content for this file";
      return;
    }
    this._message = "";
    await this.updateComplete;
    if (token !== this._token) return;
    await this._show(request, file, token);
  }

  /** Load the document into the editor, then decorate its rows. */
  private async _show(
    request: FileDiffRequest,
    file: InlineDiffFile,
    token: number,
  ): Promise<void> {
    const host = this.querySelector<HTMLElement>(".gfd-editor");
    if (!host) return;
    if (!this._editor) {
      const editor = document.createElement("file-editor") as FileEditorElement;
      editor.style.cssText = "width:100%;height:100%;display:block;";
      editor.setReadOnly(true);
      host.replaceChildren(editor);
      this._editor = editor;
    }
    const editor = this._editor;
    editor.setStatusInfo(request.hash ? request.hash.slice(0, 7) : "Uncommitted");
    await awaitEditorReady(editor);
    if (token !== this._token) return;
    // The uri ends with the file's name, so its language is detected.
    const at = request.hash ?? `worktree/${request.worktree ?? ""}`;
    const uri = `gitfilediff://${request.repo}/${at}/${request.path}`;
    editor.textContentModel = new PieceTreeTextContentModel(uri, file.text);
    const name = request.path.split("/").filter(Boolean).pop() ?? request.path;
    try {
      await editor.loadFile(uri, name);
    } catch (err) {
      if (token === this._token) this._message = `Could not show the file: ${String(err)}`;
      return;
    }
    if (token !== this._token) return;
    editor.setInlineDiff([...file.rows]);
  }

  protected override render(): TemplateResult {
    return html`<div
      style="position:relative;width:100%;height:100%;background:var(--bg-gutter,#161616)"
    >
      <div class="gfd-editor" style="width:100%;height:100%" ?hidden=${!!this._message}></div>
      ${
        this._message
          ? html`<div
              class="gfd-message"
              style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;font-size:12px;font-style:italic;color:var(--text-muted,#777)"
            >
              ${this._message}
            </div>`
          : null
      }
    </div>`;
  }
}

/** Wait for the editor's first render (its viewport) before loading a file. */
async function awaitEditorReady(editor: FileEditorElement): Promise<void> {
  const e = editor as unknown as { _viewportEl?: HTMLElement; updateComplete: Promise<unknown> };
  if (e._viewportEl) return;
  await e.updateComplete;
  if (!e._viewportEl) await e.updateComplete;
}

if (!customElements.get("git-file-diff")) customElements.define("git-file-diff", GitFileDiff);
