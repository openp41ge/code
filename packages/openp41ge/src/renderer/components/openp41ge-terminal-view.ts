/**
 * openp41ge-terminal-view — the platform's scoped terminal (the `terminal`
 * grid tab): locked to one binary an extension defines, in one worktree.
 *
 * It shows the runs of its binary in its worktree, oldest first — agents'
 * runs too, named — updated live as they print. Its prompt (`git ›`) runs
 * only that binary: the typed line is split into arguments (quotes and `\`
 * group them; no shell) and run in the worktree, non-interactively. A line
 * the binary's rules refuse says why, with a link to the settings of the
 * extension that defines it. ↑ / ↓ recall the lines typed before. A run the
 * tab was opened for (`runId`, e.g. a tool call dropped from a chat) is
 * marked. Output is shown as text (never HTML).
 */
import { LitElement, html, css, nothing, type PropertyValues, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { splitCommandLine, type CommandBinaryInfo } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import type { CommandRun } from "../../shared/command-run";
import { terminalDeps } from "../services/terminal-deps";

const log = createLogger("openp41ge", "terminal-view");

/** Who ran a run, as shown: an extension's id without the official prefix. */
function runnerName(by: string): string {
  return by.replace(/^openp41ge-extension-/, "");
}

/** An argument as it would be typed: quoted when it has to be. */
function shownArg(arg: string): string {
  return arg === "" || /[\s"'\\]/.test(arg) ? `"${arg.replace(/(["\\])/g, "\\$1")}"` : arg;
}

/** A line the prompt refused before anything ran. */
interface Refusal {
  readonly id: number;
  readonly line: string;
  readonly error: string;
}

type Entry = { readonly run: string } | { readonly refusal: Refusal };

@customElement("openp41ge-terminal-view")
export class Openp41geTerminalView extends LitElement {
  @property() binary = "";
  @property() repo = "";
  @property() worktree = "";
  /** The run the tab was opened for (marked). */
  @property() runId = "";

  /** The binary's definition; null before it is known, undefined when none. */
  @state() private _def: CommandBinaryInfo | null | undefined = null;
  @state() private _runs = new Map<string, CommandRun>();
  @state() private _entries: Entry[] = [];
  @state() private _line = "";

  /** Lines typed here (and before, at this prompt), oldest first. */
  private _history: string[] = [];
  /** Where ↑ / ↓ are in `_history` (its length: the line being typed). */
  private _historyAt = 0;
  private _refusals = 0;
  private _unsubscribe: (() => void) | null = null;
  private _scrolledToRun = false;

  override connectedCallback(): void {
    super.connectedCallback();
    const deps = terminalDeps();
    this._unsubscribe = deps.onRun(({ append, run }) => this._onRun(append, run));
    void this._load();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unsubscribe?.();
    this._unsubscribe = null;
  }

  private async _load(): Promise<void> {
    const deps = terminalDeps();
    try {
      const [binaries, runs] = await Promise.all([
        deps.binaries(),
        deps.runs({ binary: this.binary, repo: this.repo, worktree: this.worktree }),
      ]);
      this._def = binaries.find((b) => b.binary === this.binary);
      const oldestFirst = [...runs].reverse();
      const known = new Map(this._runs);
      for (const r of oldestFirst) if (!known.has(r.runId)) known.set(r.runId, r);
      this._runs = known;
      const loaded = oldestFirst.map((r) => ({ run: r.runId }));
      const live = this._entries.filter(
        (e) => !("run" in e) || !oldestFirst.some((r) => r.runId === e.run),
      );
      this._entries = [...loaded, ...live];
      this._history = oldestFirst.filter((r) => r.by === "you").map((r) => this._lineOf(r));
      this._historyAt = this._history.length;
    } catch (err) {
      log.warn("terminal could not load:", err);
      this._def = undefined;
    }
  }

  private _isMine(run: CommandRun): boolean {
    return run.binary === this.binary && run.repo === this.repo && run.worktree === this.worktree;
  }

  private _onRun(append: boolean, run: CommandRun): void {
    if (!this._isMine(run)) return;
    const runs = new Map(this._runs);
    const before = runs.get(run.runId);
    runs.set(run.runId, append && before ? { ...run, output: before.output + run.output } : run);
    this._runs = runs;
    if (!before) this._entries = [...this._entries, { run: run.runId }];
  }

  private _lineOf(run: CommandRun): string {
    return run.args.map(shownArg).join(" ");
  }

  private async _submit(): Promise<void> {
    const line = this._line;
    if (line.trim() === "") return;
    this._history = [...this._history, line];
    this._historyAt = this._history.length;
    this._line = "";
    let args: string[];
    try {
      args = splitCommandLine(line);
    } catch (err) {
      this._refuse(line, err instanceof Error ? err.message : String(err));
      return;
    }
    const result = await terminalDeps().run({
      binary: this.binary,
      args,
      repo: this.repo,
      worktree: this.worktree,
    });
    // A run that started shows through its run events; one that did not is
    // a refusal.
    if (!result.runId) this._refuse(line, result.error ?? "it did not run");
  }

  private _refuse(line: string, error: string): void {
    this._entries = [...this._entries, { refusal: { id: ++this._refusals, line, error } }];
  }

  private _onKeydown(e: KeyboardEvent): void {
    if (e.key === "Enter") {
      e.preventDefault();
      void this._submit();
    } else if (e.key === "ArrowUp" && this._historyAt > 0) {
      e.preventDefault();
      this._historyAt--;
      this._line = this._history[this._historyAt];
    } else if (e.key === "ArrowDown" && this._historyAt < this._history.length) {
      e.preventDefault();
      this._historyAt++;
      this._line = this._history[this._historyAt] ?? "";
    }
  }

  protected override updated(changed: PropertyValues): void {
    super.updated(changed);
    const input = this.renderRoot.querySelector<HTMLInputElement>("input.tv-input");
    if (input && input.value !== this._line) input.value = this._line;
    const focused = this.renderRoot.querySelector<HTMLElement>(".tv-focused");
    if (focused && !this._scrolledToRun) {
      this._scrolledToRun = true;
      focused.scrollIntoView?.({ block: "nearest" });
    } else if (changed.has("_runs") || changed.has("_entries")) {
      const scroller = this.renderRoot.querySelector<HTMLElement>(".tv-scroll");
      if (scroller && !focused) scroller.scrollTop = scroller.scrollHeight;
    }
  }

  private _renderRun(run: CommandRun): TemplateResult {
    const status =
      run.state === "running"
        ? html`<span class="tv-running">running…</span>`
        : run.error
          ? html`<span class="tv-failed">${run.error}</span>`
          : nothing;
    return html`<div
      class="tv-run ${run.runId === this.runId ? "tv-focused" : ""}"
      data-run-id=${run.runId}
    >
      <div class="tv-line">
        <span class="tv-cmd">${this.binary} › ${this._lineOf(run)}</span>
        ${run.by !== "you" ? html`<span class="tv-by">${runnerName(run.by)}</span>` : nothing}
      </div>
      ${run.output ? html`<pre class="tv-output">${run.output}</pre>` : nothing}
      ${run.truncated ? html`<div class="tv-note">output cut</div>` : nothing} ${status}
    </div>`;
  }

  private _renderRefusal(r: Refusal): TemplateResult {
    const def = this._def;
    return html`<div class="tv-refused">
      <div class="tv-line"><span class="tv-cmd">${this.binary} › ${r.line}</span></div>
      <span class="tv-failed">${r.error}</span>
      ${
        def
          ? html`<button
              class="tv-link"
              @click=${() => terminalDeps().openSettings(def.extensionId)}
            >
              Settings
            </button>`
          : nothing
      }
    </div>`;
  }

  override render(): TemplateResult {
    const undefinedBinary = this._def === undefined;
    return html`<div class="tv">
      <div class="tv-header">
        <span class="tv-title">${this._def?.label ?? this.binary}</span>
        <span class="tv-where">${this.repo} · ${this.worktree}</span>
      </div>
      <div class="tv-scroll">
        ${
          undefinedBinary
            ? html`<div class="tv-note">
                No extension defines <code>${this.binary}</code>, so it cannot run here.
              </div>`
            : nothing
        }
        ${this._entries.map((e) => {
          if ("refusal" in e) return this._renderRefusal(e.refusal);
          const run = this._runs.get(e.run);
          return run ? this._renderRun(run) : nothing;
        })}
      </div>
      <label class="tv-input-row">
        <span class="tv-prompt">${this.binary} ›</span>
        <input
          class="tv-input"
          spellcheck="false"
          autocomplete="off"
          .value=${this._line}
          ?disabled=${undefinedBinary}
          @input=${(e: Event) => (this._line = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => this._onKeydown(e)}
        />
      </label>
    </div>`;
  }

  static override styles = css`
    :host {
      display: block;
      height: 100%;
      background: var(--bg-primary);
      color: var(--text-primary);
    }
    .tv {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-family: var(--font-mono, ui-monospace, Menlo, monospace);
      font-size: 12px;
    }
    .tv-header {
      display: flex;
      gap: 8px;
      align-items: baseline;
      padding: 6px 12px;
      border-bottom: 1px solid var(--divider);
      font-family: var(--font-ui);
    }
    .tv-title {
      font-weight: 600;
    }
    .tv-where {
      color: var(--muted-color);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .tv-scroll {
      flex: 1;
      overflow: auto;
      padding: 8px 12px;
    }
    .tv-run,
    .tv-refused {
      margin-bottom: 10px;
    }
    .tv-focused {
      border-left: 2px solid var(--accent);
      padding-left: 8px;
      margin-left: -10px;
    }
    .tv-line {
      display: flex;
      gap: 8px;
      align-items: baseline;
    }
    .tv-cmd {
      color: var(--text-primary);
      font-weight: 600;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .tv-by {
      color: var(--muted-color);
      font-family: var(--font-ui);
      font-size: 11px;
      border: 1px solid var(--divider);
      border-radius: 3px;
      padding: 0 4px;
    }
    .tv-output {
      margin: 2px 0 0;
      font: inherit;
      white-space: pre-wrap;
      word-break: break-word;
      color: var(--text-secondary, var(--text-primary));
    }
    .tv-running,
    .tv-note {
      color: var(--muted-color);
    }
    .tv-failed {
      color: var(--accent-error);
    }
    .tv-link {
      margin-left: 6px;
      background: none;
      border: none;
      padding: 0;
      color: var(--accent);
      cursor: pointer;
      font: inherit;
      text-decoration: underline;
    }
    .tv-input-row {
      display: flex;
      gap: 6px;
      align-items: center;
      padding: 6px 12px;
      border-top: 1px solid var(--divider);
    }
    .tv-prompt {
      color: var(--accent);
      font-weight: 600;
    }
    .tv-input {
      flex: 1;
      background: transparent;
      border: none;
      outline: none;
      color: var(--text-primary);
      font: inherit;
    }
    .tv-input:disabled {
      opacity: 0.5;
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-terminal-view": Openp41geTerminalView;
  }
}
