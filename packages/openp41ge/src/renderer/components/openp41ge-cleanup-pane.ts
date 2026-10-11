/**
 * openp41ge-cleanup-pane — the manager window's Cleanup tab.
 *
 * The platform's repository cleanup deletes what no workspace uses on its own;
 * what it cannot safely delete — a clone, or a deleted workspace's data
 * folder, holding uncommitted, unpushed or stashed work, or whose state
 * cannot be read — is listed here for the user to decide. Each item shows
 * its worktrees' / branches' work (never individual files), and offers
 * Delete (asks first, with the same summary) and Show in Finder. The bottom
 * bar's button runs the cleanup now.
 *
 * Test seam: override the static `deps`. By default the
 * `window.openp41ge.cleanup` bridge and the app's confirm dialog are used.
 */
import { LitElement, html, css, nothing, type TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { showConfirm } from "../confirm-service";
import { branchWorkLines } from "../services/repository-work";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "cleanup-pane");

type CleanupBridge = Window["openp41ge"]["cleanup"];
type Item = Awaited<ReturnType<CleanupBridge["list"]>>[number];

/** Injectable seams used by the pane. Tests replace these via the static. */
export interface CleanupPaneDeps {
  list: CleanupBridge["list"];
  run: CleanupBridge["run"];
  delete: CleanupBridge["delete"];
  reveal: CleanupBridge["reveal"];
  onChanged: CleanupBridge["onChanged"];
  /** Ask the user; resolves whether they agreed. */
  confirm: (options: {
    title: string;
    message: string;
    detail: string;
    confirmLabel: string;
  }) => Promise<boolean>;
}

/** One line per branch with work, then a stash; or why the state is unknown. */
function workLines(repo: Item["repositories"][number]): string[] {
  if (repo.error) return [`state could not be read: ${repo.error}`];
  return [...branchWorkLines(repo.branches), ...(repo.stashed ? ["stashed changes"] : [])];
}

const itemTitle = (item: Item): string =>
  item.kind === "workspace" ? `Deleted workspace ${item.name}` : item.name;

@customElement("openp41ge-cleanup-pane")
export class Openp41geCleanupPane extends LitElement {
  static deps: CleanupPaneDeps | null = null;

  @state() private _items: Item[] = [];
  @state() private _loaded = false;
  @state() private _running = false;
  @state() private _error = "";
  private _offChanged: (() => void) | null = null;

  private get _deps(): CleanupPaneDeps {
    if (Openp41geCleanupPane.deps) return Openp41geCleanupPane.deps;
    const bridge = window.openp41ge.cleanup;
    return {
      list: () => bridge.list(),
      run: () => bridge.run(),
      delete: (folder) => bridge.delete(folder),
      reveal: (folder) => bridge.reveal(folder),
      onChanged: (fn) => bridge.onChanged(fn),
      confirm: (options) => showConfirm({ ...options, confirmStyle: "danger" }),
    };
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._offChanged = this._deps.onChanged(() => void this._load());
    void this._load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._offChanged?.();
    this._offChanged = null;
  }

  private async _load(): Promise<void> {
    try {
      this._items = await this._deps.list();
      this._error = "";
    } catch (err) {
      log.warn("cleanup list failed:", err);
      this._error = String(err);
    }
    this._loaded = true;
  }

  private async _run(): Promise<void> {
    if (this._running) return;
    this._running = true;
    try {
      this._items = await this._deps.run();
      this._error = "";
    } catch (err) {
      log.warn("cleanup run failed:", err);
      this._error = String(err);
    } finally {
      this._running = false;
    }
  }

  private async _delete(item: Item): Promise<void> {
    const lines = item.repositories.flatMap((repo) =>
      workLines(repo).map((line) =>
        item.kind === "workspace" ? `• ${repo.repoName}: ${line}` : `• ${line}`,
      ),
    );
    const what =
      item.kind === "workspace"
        ? "Its data folder (chats and clones) is deleted from disk."
        : "Its clone and worktrees are deleted from disk.";
    const agreed = await this._deps.confirm({
      title: item.kind === "workspace" ? "Delete workspace data" : "Delete repository",
      message: `Delete ${itemTitle(item)}?`,
      detail: `${what}\n\nNot saved anywhere else:\n${lines.join("\n")}`,
      confirmLabel: "Delete",
    });
    if (!agreed) return;
    const result = await this._deps.delete(item.path);
    if (!result.ok) {
      this._error = result.error ?? "The delete failed";
      return;
    }
    this._items = this._items.filter((i) => i.path !== item.path);
  }

  override render(): TemplateResult {
    return html`
      <div class="cp">
        <div class="cp-scroll">
          ${
            !this._loaded
              ? nothing
              : this._items.length === 0
                ? html`<p class="cp-state">
                    Nothing to clean up. Repositories and deleted workspaces' data with uncommitted,
                    unpushed or stashed work are listed here.
                  </p>`
                : html`<ul class="cp-list">
                    ${this._items.map((item) => this._renderItem(item))}
                  </ul>`
          }
        </div>
        <footer class="cp-footer">
          <span class="cp-footer-status">
            ${this._error ? html`<span class="cp-error">${this._error}</span>` : nothing}
          </span>
          <span class="cp-footer-spacer"></span>
          <button
            class="cp-run ${this._running ? "cp-run--running" : ""}"
            aria-label="Run cleanup"
            title="Run cleanup"
            @click=${() => void this._run()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960">
              <path
                d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"
              />
            </svg>
          </button>
        </footer>
      </div>
    `;
  }

  private _renderItem(item: Item): TemplateResult {
    return html`
      <li class="cp-item">
        <div class="cp-card">
          <div class="cp-name">${itemTitle(item)}</div>
          <div class="cp-path">${item.path}</div>
          ${item.repositories.map(
            (repo) => html`
              ${item.kind === "workspace" ? html`<div class="cp-repo">${repo.repoName}</div>` : nothing}
              <ul class="cp-work">
                ${workLines(repo).map((line) => html`<li>${line}</li>`)}
              </ul>
            `,
          )}
        </div>
        <div class="cp-actions">
          <button class="cp-reveal" @click=${() => void this._deps.reveal(item.path)}>
            Show in Finder
          </button>
          <button class="cp-delete" @click=${() => void this._delete(item)}>Delete</button>
        </div>
      </li>
    `;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
    }
    .cp {
      display: flex;
      flex-direction: column;
      height: 100%;
    }
    .cp-scroll {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
    }
    .cp-state {
      margin: 0;
      padding: 14px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--muted-color, #8b93a1);
    }
    .cp-error {
      color: #e57373;
    }
    .cp-list {
      list-style: none;
      margin: 0;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .cp-item {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    .cp-card {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
      padding: 10px 12px;
      border: 1px solid var(--divider, #2d2d2d);
      background: var(--bg-secondary, #161616);
    }
    .cp-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-primary, #d4d4d4);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cp-path {
      font-size: 11px;
      color: var(--text-secondary, #888);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cp-repo {
      margin-top: 4px;
      font-size: 12px;
      color: var(--text-primary, #d4d4d4);
    }
    .cp-work {
      margin: 2px 0 0;
      padding-left: 16px;
      font-size: 12px;
      line-height: 1.5;
      color: #e5c07b;
    }
    .cp-actions {
      display: flex;
      justify-content: flex-end;
    }
    .cp-actions button {
      border: 1px solid var(--divider, #2d2d2d);
      border-top: none;
      background: transparent;
      color: var(--text-secondary, #999);
      font-size: 12px;
      padding: 5px 12px;
      cursor: pointer;
    }
    .cp-actions button + button {
      border-left: none;
    }
    .cp-actions button:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .cp-actions .cp-delete:hover {
      color: #e57373;
    }
    /* ── Bottom bar: status + square run button ───────────────────────── */
    .cp-footer {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      height: 34px;
      padding-left: 10px;
      border-top: 1px solid var(--divider, #333);
      background: var(--bg-secondary, #161616);
    }
    .cp-footer-status {
      min-width: 0;
      font-size: 11px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .cp-footer-spacer {
      flex: 1;
    }
    .cp-run {
      border: none;
      border-left: 1px solid var(--divider, #333);
      border-radius: 0;
      background: transparent;
      color: var(--text-secondary, #999);
      height: 100%;
      aspect-ratio: 1 / 1;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
    }
    .cp-run:hover {
      background: var(--bg-active, #37373d);
      color: var(--text-primary, #ddd);
    }
    .cp-run svg {
      width: 16px;
      height: 16px;
      fill: currentColor;
    }
    /* Running: the arrow spins, in the accent blue. */
    .cp-run--running,
    .cp-run--running:hover {
      color: #4a9eff;
    }
    .cp-run--running svg {
      animation: cp-spin 0.9s linear infinite;
    }
    @keyframes cp-spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-cleanup-pane": Openp41geCleanupPane;
  }
}
