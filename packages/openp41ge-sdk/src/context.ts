/**
 * context.ts — what a backend handler receives: its payload and its
 * `HandlerContext` (publish, git, config, workspace, window, log), plus the
 * active-extension summary the platform sends the renderer. Handlers are
 * registered with `registerProcesses` (registration.ts).
 */

import type { ILogger } from "openp41ge-core-logger";

/** Payload passed to a main-process handler. Tagged open so the platform can
 *  evolve the shape without a contract bump. */
export type HandlerPayload = Readonly<Record<string, unknown>>;

/** Value a main-process handler may return (request/response capability). */
export type HandlerResult = unknown;

/** Separator between an extension id and one of its namespaced names
 *  (command ids and topic ids). Keeps matters from different extensions from
 *  colliding in the single host-wide namespaces. */
export const EXTENSION_ID_SEPARATOR = "/";

/** Qualify a command/topic name under an extension id so it never collides
 *  with another extension's. E.g. `qualifyName("explorer", "read-dir")` →
 *  `"explorer/read-dir"`. The shared vocabulary both sides use (no drift). */
export function qualifyName(extId: string, name: string): string {
  return `${extId}${EXTENSION_ID_SEPARATOR}${name.replace(/^\/+/, "")}`;
}

/** A git command for a repository of the calling window's workspace. */
export interface GitRequest {
  /** The repository's name (`<host>/<org>/<repo>`, as in `workspaceRepos`). */
  readonly repo: string;
  /** git's arguments, starting with the subcommand (no shell). */
  readonly args: readonly string[];
  /** Run in this branch's worktree; omitted: in the repository itself. */
  readonly worktree?: string;
}

/** What a git command printed, or why it did not run. */
export interface GitResult {
  /** The command ran and exited 0. */
  readonly ok: boolean;
  /** git's exit code; null when it did not run (refused, or no git). */
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  /** Why it failed: the refusal, or git's error. */
  readonly error?: string;
}

/** A checked-out worktree of a workspace repository. */
export interface WorkspaceRoot {
  /** The repository (`<host>/<org>/<repo>`). */
  readonly repoName: string;
  readonly branch: string;
  /** The worktree folder. */
  readonly path: string;
}

/** A repository a workspace lists, with or without a worktree. */
export interface WorkspaceRepository {
  /** The repository (`<host>/<org>/<repo>`). */
  readonly repoName: string;
  /** Whether it is cloned (a worktree can be checked out of it). */
  readonly cloned: boolean;
  /** Its checked-out worktrees. */
  readonly worktrees: readonly WorkspaceRoot[];
}

/** A worktree checked out (`path`), or why not (`error`). */
export interface WorktreeAddition {
  readonly ok: boolean;
  readonly path?: string;
  readonly error?: string;
}

/** The workspace of the window that dispatched a handler call. */
export interface HandlerWorkspace {
  /** The workspace's id (stable; key per-workspace state by it). */
  readonly id: string;
  /** Its repositories' checked-out worktrees, read on each call. */
  roots(): Promise<readonly WorkspaceRoot[]>;
  /** Every repository its workspace file lists, read on each call. */
  repositories(): Promise<readonly WorkspaceRepository[]>;
  /** Check out `branch` of the workspace repository `repoName` as a worktree
   *  (an existing local or remote branch, else a new one from its HEAD) and
   *  add it to the workspace. Never throws. */
  addWorktree(repoName: string, branch: string): Promise<WorktreeAddition>;
  /** A folder this extension owns inside the workspace's data folder
   *  (`<workspace data>/extensions/<extensionId>/`), created on first call. */
  dataDir(): Promise<string>;
}

/** The calling window's workspace, as the platform provides it to the host
 *  (which scopes `dataDirFor` to the handler's extension). */
export interface CallerWorkspace {
  readonly id: string;
  roots(): Promise<readonly WorkspaceRoot[]>;
  repositories(): Promise<readonly WorkspaceRepository[]>;
  addWorktree(repoName: string, branch: string): Promise<WorktreeAddition>;
  /** The extension's folder in the workspace's data folder, created. */
  dataDirFor(extensionId: string): Promise<string>;
}

/** What the platform provides about the caller of a handler (the window
 *  that dispatched the command). */
export interface HandlerCaller {
  /** Run git in a repository of the caller's workspace. */
  git?(request: GitRequest): Promise<GitResult>;
  /** The caller's workspace (absent for a window without one). */
  workspace?: CallerWorkspace;
  /** The dispatching window's id (absent for a call not from a window). */
  windowId?: string;
}

/** Context passed to a main-process handler on invocation. */
export interface HandlerContext {
  /** The extension this handler belongs to. */
  readonly extensionId: string;
  /** Publish a push to the extension's subscribed renderer surfaces. */
  publish(topic: string, payload?: HandlerPayload): void;
  /**
   * Run git in a repository of the **calling window's workspace**: the
   * platform resolves `repo` by name there (never a path), runs the user's
   * git with `args` (no shell, no prompts, a timeout) in the repository or
   * the named `worktree`, and logs it. Refused (`ok: false`, never thrown):
   * a repo outside that workspace, no calling workspace, a first argument
   * that is not a subcommand, and options that make git run other programs
   * (`--upload-pack`, `--receive-pack`, `--exec`, `rebase -x`, `--extcmd`,
   * `--config-env`).
   */
  git(request: GitRequest): Promise<GitResult>;
  /** The extension's config: its registered schema's defaults plus the
   *  user's values (read on each call, so it is always current). */
  readonly config: { get(): Readonly<Record<string, unknown>> };
  /** The calling window's workspace; null for a window without one (the
   *  manager) or a call not from a window. */
  readonly workspace: HandlerWorkspace | null;
  /** The dispatching window's id: opaque, stable while the window is open;
   *  null for a call not from a window. */
  readonly windowId: string | null;
  /** The extension's logger (the same stream as its views' `host.log`). */
  readonly log: ILogger;
}

/** A registered main-process command/event handler. May return a result (the
 *  host forwards it to the caller) or `undefined` for fire-and-forget events.
 *  The optional `context` carries the extension id + a `publish` handle for
 *  backend → renderer pushes. */
export type HandlerFn = (
  payload: HandlerPayload,
  context?: HandlerContext,
) => HandlerResult | Promise<HandlerResult>;

/**
 * Summary of an active extension, sent over the bridge so the renderer can
 * load its renderer entry.
 */
export interface ActiveExtensionSummary {
  readonly id: string;
  readonly version: string;
  /**
   * Relative renderer-entry path, when the extension ships one; the renderer
   * loads it over `openp41ge-ext://<id>/<renderer>`. Absent for a
   * backend-only extension.
   */
  readonly renderer?: string;
}
