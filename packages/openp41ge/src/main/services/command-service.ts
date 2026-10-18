/**
 * command-service.ts — the platform's scoped terminal engine (`ctx.commands`,
 * the terminal tab).
 *
 * Extensions define binaries and keep their allow / deny rules in their own
 * config (`registerCommandBinaries`, `openp41ge-sdk` commands.ts); this runs
 * them. A binary two extensions define is the user's pick
 * (`commandBinaries` in `config.json`), else an official extension's, else
 * the only one's; a conflict nobody settled leaves it off. A run is checked
 * against the binary's current rules before anything starts, then runs with
 * its argument list (no shell, no stdin, pagers and editors off) in a
 * worktree of the caller's workspace, with a timeout and an output cap, and
 * is recorded per workspace (the latest `MAX_RUNS`). A run an extension asks
 * for (an agent's) has a smaller output cap than one typed at the prompt:
 * its output goes into a model's context.
 */

import { randomUUID } from "crypto";
import {
  checkCommand,
  type CommandBinaryInfo,
  type CommandRequest,
  type CommandResult,
} from "openp41ge-sdk";
import type { HostCommandBinary } from "openp41ge-core-extension-host";
import type { CommandRun } from "../../shared/command-run.js";

export type { CommandRun } from "../../shared/command-run.js";

/** Who runs a line typed at a terminal's prompt. */
export const PROMPT_RUNNER = "you";

/** How many runs a workspace keeps. */
export const MAX_RUNS = 200;

/** What every run's environment sets: nothing waits for input or a pager. */
export const COMMAND_ENV: Readonly<Record<string, string>> = {
  GIT_PAGER: "cat",
  PAGER: "cat",
  GIT_EDITOR: "false",
  EDITOR: "false",
  VISUAL: "false",
  GIT_TERMINAL_PROMPT: "0",
  LESSSECURE: "1",
};

/** How a process runs. */
export interface CommandProcessOptions {
  readonly cwd: string;
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly timeoutMs: number;
  /** Output kept beyond this is dropped (`truncated`). */
  readonly maxOutputBytes: number;
  /** Each piece of output as it comes (stdout and stderr, in order). */
  readonly onOutput: (chunk: string) => void;
}

/** How a process ended. */
export interface CommandProcessResult {
  /** Its exit code; null when it did not start or was stopped. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** The binary was not found. */
  readonly notFound: boolean;
  readonly output: string;
  readonly truncated: boolean;
}

/** Starts a binary with an argument list (no shell). Never rejects. */
export interface CommandProcess {
  run(
    file: string,
    args: readonly string[],
    opts: CommandProcessOptions,
  ): Promise<CommandProcessResult>;
}

/** Where a workspace's runs are kept, oldest first. */
export interface CommandRunStore {
  list(workspaceId: string): CommandRun[];
  save(workspaceId: string, runs: readonly CommandRun[]): void;
}

/** The caller's workspace, as far as a run is concerned. */
export interface CommandScope {
  readonly workspaceId: string;
  /** The folder of `worktree` (a branch) of `repo` in that workspace, or null. */
  worktreePath(repo: string, worktree: string): Promise<string | null>;
}

/** A binary several extensions define. */
export interface CommandConflict {
  readonly binary: string;
  readonly extensionIds: readonly string[];
  /** The extension whose definition applies, or null (the binary is off). */
  readonly chosen: string | null;
}

export interface CommandServiceDeps {
  /** Every active extension's binaries, with their current rules. */
  binaries(): readonly HostCommandBinary[];
  /** The user's picks: binary → extension id (`commandBinaries`). */
  chosen(): Readonly<Record<string, string>>;
  /** Whether an extension is one the app ships. */
  isOfficial(extensionId: string): boolean;
  /** Every run's timeout; the output cap of a run typed at the prompt, and
   *  the smaller one of a run an extension (an agent) asked for. */
  limits(): { timeoutMs: number; maxOutputBytes: number; agentMaxOutputBytes: number };
  process: CommandProcess;
  store: CommandRunStore;
  /** A run started, printed, or ended. */
  onRun?(workspaceId: string, run: CommandRun): void;
  newId?(): string;
  now?(): number;
}

/** Runs (newest last) filtered by what a terminal shows. */
export interface CommandRunFilter {
  readonly binary?: string;
  readonly repo?: string;
  readonly worktree?: string;
}

const refuse = (error: string): CommandResult => ({
  ok: false,
  exitCode: null,
  output: "",
  truncated: false,
  runId: "",
  error,
});

export class CommandService {
  private readonly _runs = new Map<string, CommandRun[]>();
  private readonly _newId: () => string;
  private readonly _now: () => number;

  constructor(private readonly _deps: CommandServiceDeps) {
    this._newId = _deps.newId ?? (() => randomUUID());
    this._now = _deps.now ?? Date.now;
  }

  /** Each binary's definitions, and which one applies (or none). */
  private _resolve(): {
    binary: string;
    defs: HostCommandBinary[];
    chosen: HostCommandBinary | null;
  }[] {
    const byBinary = new Map<string, HostCommandBinary[]>();
    for (const b of this._deps.binaries()) {
      byBinary.set(b.binary, [...(byBinary.get(b.binary) ?? []), b]);
    }
    const picks = this._deps.chosen();
    return [...byBinary].map(([binary, defs]) => {
      const picked = defs.find((d) => d.extensionId === picks[binary]);
      const official = defs.find((d) => this._deps.isOfficial(d.extensionId));
      const chosen = picked ?? official ?? (defs.length === 1 ? defs[0] : null);
      return { binary, defs, chosen };
    });
  }

  /** The binaries that can run now (one definition each, with valid rules). */
  binaries(): CommandBinaryInfo[] {
    return this._resolve().flatMap(({ chosen }) =>
      chosen?.rules
        ? [
            {
              binary: chosen.binary,
              label: chosen.label,
              extensionId: chosen.extensionId,
              allow: chosen.rules.allow,
              deny: chosen.rules.deny,
            },
          ]
        : [],
    );
  }

  /** The binaries more than one extension defines (for the settings). */
  conflicts(): CommandConflict[] {
    return this._resolve()
      .filter(({ defs }) => defs.length > 1)
      .map(({ binary, defs, chosen }) => ({
        binary,
        extensionIds: defs.map((d) => d.extensionId),
        chosen: chosen?.extensionId ?? null,
      }));
  }

  /** Run `request` for `by` in `scope`'s workspace. Never rejects. */
  async run(
    scope: CommandScope | null,
    request: CommandRequest,
    by: string,
  ): Promise<CommandResult> {
    if (!scope) return refuse("commands run only in a window with a workspace open");
    const { binary, repo, worktree } = request;
    const args = request.args ?? [];
    if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
      return refuse("arguments must be strings");
    }
    const def = this.binaries().find((b) => b.binary === binary);
    if (!def) return refuse(`'${binary}' is not defined by any extension (or its rules are off)`);
    const check = checkCommand(def, args);
    if (!check.allowed) {
      return refuse(`${[binary, ...args].join(" ")} is not allowed: ${check.reason}`);
    }
    const cwd =
      typeof repo === "string" && typeof worktree === "string"
        ? await scope.worktreePath(repo, worktree)
        : null;
    if (!cwd) return refuse(`${worktree} is not a checked-out worktree of ${repo}`);

    let run: CommandRun = {
      runId: this._newId(),
      binary,
      args: [...args],
      repo,
      worktree,
      by,
      startedAt: this._now(),
      endedAt: null,
      state: "running",
      exitCode: null,
      output: "",
      truncated: false,
    };
    const update = (next: CommandRun): void => {
      run = next;
      this._put(scope.workspaceId, run);
      this._deps.onRun?.(scope.workspaceId, run);
    };
    update(run);

    const limits = this._deps.limits();
    const { timeoutMs } = limits;
    const maxOutputBytes =
      by === PROMPT_RUNNER ? limits.maxOutputBytes : limits.agentMaxOutputBytes;
    const ended = await this._deps.process.run(binary, args, {
      cwd,
      env: { ...process.env, ...COMMAND_ENV },
      timeoutMs,
      maxOutputBytes,
      onOutput: (chunk) => update({ ...run, output: run.output + chunk }),
    });
    const error = ended.notFound
      ? `'${binary}' was not found on PATH`
      : ended.timedOut
        ? `stopped after ${Math.round(timeoutMs / 1000)} s`
        : ended.exitCode !== 0
          ? `exited with ${ended.exitCode}`
          : undefined;
    update({
      ...run,
      state: "done",
      endedAt: this._now(),
      exitCode: ended.exitCode,
      output: ended.output,
      truncated: ended.truncated,
      ...(error ? { error } : {}),
    });
    this._deps.store.save(scope.workspaceId, this._list(scope.workspaceId));
    return {
      ok: !error,
      exitCode: ended.exitCode,
      output: ended.output,
      truncated: ended.truncated,
      runId: run.runId,
      ...(error ? { error } : {}),
    };
  }

  /** A workspace's runs, newest first. */
  runs(workspaceId: string, filter: CommandRunFilter): CommandRun[] {
    return this._list(workspaceId)
      .filter(
        (r) =>
          (filter.binary === undefined || r.binary === filter.binary) &&
          (filter.repo === undefined || r.repo === filter.repo) &&
          (filter.worktree === undefined || r.worktree === filter.worktree),
      )
      .reverse();
  }

  getRun(workspaceId: string, runId: string): CommandRun | null {
    return this._list(workspaceId).find((r) => r.runId === runId) ?? null;
  }

  private _list(workspaceId: string): CommandRun[] {
    let runs = this._runs.get(workspaceId);
    if (!runs) {
      runs = this._deps.store.list(workspaceId);
      this._runs.set(workspaceId, runs);
    }
    return runs;
  }

  private _put(workspaceId: string, run: CommandRun): void {
    const runs = this._list(workspaceId);
    const at = runs.findIndex((r) => r.runId === run.runId);
    if (at >= 0) runs[at] = run;
    else {
      runs.push(run);
      if (runs.length > MAX_RUNS) runs.splice(0, runs.length - MAX_RUNS);
    }
  }
}
