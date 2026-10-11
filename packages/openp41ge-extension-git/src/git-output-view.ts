/**
 * git-output-view.ts — the Git output tab: a read-only, terminal-style view of
 * a git command the platform ran and what it printed, as the user would have
 * seen it had they typed the command themselves. Opened from a failed add in
 * the Repositories sidebar (its error icon); the tab's context carries
 * `{ title, message, command?, output? }`.
 *
 * Plain text rendering for now. A real read-only terminal (the platform's
 * terminal component, shared with extensions like the UI toolkit) is the
 * planned follow-up — see the git extension plan.
 */

import { html, type TemplateResult } from "lit";

/** The tab's context. */
interface GitOutputContext {
  readonly title?: unknown;
  readonly message?: unknown;
  readonly command?: unknown;
  readonly output?: unknown;
}

/** What a terminal finally shows for `output`: each line's last `\r` rewrite. */
export function terminalLines(output: string): string[] {
  const lines = output.split("\n").map((line) => {
    const parts = line.split("\r").filter((p) => p !== "");
    return parts[parts.length - 1] ?? "";
  });
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const STYLES = html`<style>
  .term {
    height: 100%;
    box-sizing: border-box;
    overflow: auto;
    padding: 10px 12px;
    background: var(--bg-primary, #1e1e1e);
    color: var(--text-primary, #d4d4d4);
    font-family: var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace);
    font-size: 12px;
    line-height: 18px;
    user-select: text;
  }
  .term-line {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .term-line.cmd {
    color: var(--text-secondary, #999);
  }
</style>`;

/** The Git output render function. */
export function renderGitOutput(host: {
  readonly context: Readonly<Record<string, unknown>>;
}): TemplateResult {
  const ctx = (host.context ?? {}) as GitOutputContext;
  const command = str(ctx.command);
  const lines = command
    ? [`$ ${command}`, ...terminalLines(str(ctx.output))]
    : terminalLines(str(ctx.message));
  return html`${STYLES}
    <div class="term" role="log" aria-label=${str(ctx.title) || "Git output"}>
      ${lines.map(
        (line, i) => html`<div class="term-line ${command && i === 0 ? "cmd" : ""}">${line}</div>`,
      )}
    </div>`;
}
