/**
 * extension-git.ts — git for extension backends (`HandlerContext.git`).
 *
 * The one place extensions' git runs (git extension plan, phase 4): the
 * repository is named (`<host>/<org>/<repo>`) and resolved in the **calling
 * window's workspace** — an extension never hands the platform a path — and
 * the user's git runs with an argument list (no shell), prompts off, a
 * timeout, and a log line. Refused, without running anything: no calling
 * workspace, a repo it does not list (or that is not cloned), a worktree that
 * is not checked out, a first argument that is not a subcommand (global
 * options such as `-c` or `--git-dir`), and options that make git run other
 * programs. Extensions are trusted code; this is about doing git one way, in
 * the right repository, not a sandbox.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";
import type { GitRequest, GitResult } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import { currentGitProblem } from "./git-binary.js";

const log = createLogger("openp41ge", "extension-git");

const TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 32 * 1024 * 1024;

/** The calling window's workspace, as far as git is concerned. */
export interface ExtensionGitScope {
  /** Its repositories folder. */
  readonly reposDir: string;
  /** The repositories its workspace file lists, by name. */
  readonly repoNames: readonly string[];
}

/** Options that make git run another program. */
const RUNS_PROGRAMS = /^--(upload-pack|receive-pack|exec|exec-path|extcmd|config-env)(=|$)/;

const refuse = (error: string): GitResult => ({
  ok: false,
  exitCode: null,
  stdout: "",
  stderr: "",
  error,
});

/** Why `args` is refused, or null. */
function refusal(args: readonly string[]): string | null {
  if (args.length === 0 || typeof args[0] !== "string" || args[0].startsWith("-")) {
    return "git arguments must start with a subcommand (global options are not allowed)";
  }
  if (args.some((a) => typeof a !== "string")) return "git arguments must be strings";
  const [sub, next] = args;
  const runsPrograms =
    args.some((a) => RUNS_PROGRAMS.test(a)) ||
    sub === "filter-branch" ||
    (sub === "submodule" && next === "foreach") ||
    (sub === "bisect" && next === "run") ||
    ((sub === "rebase" || sub === "difftool") && args.some((a) => a === "-x" || /^-x./.test(a)));
  return runsPrograms ? `"git ${sub}" with these options runs other programs; refused` : null;
}

/** Run a git command for an extension. Never rejects. */
export function runExtensionGit(
  scope: ExtensionGitScope | null,
  request: GitRequest,
): Promise<GitResult> {
  if (!scope)
    return Promise.resolve(refuse("git runs only for a call from a window with a workspace open"));
  const { repo, args, worktree } = request;
  const validName =
    typeof repo === "string" &&
    repo.split("/").every((s) => s !== "" && s !== "." && s !== "..") &&
    scope.repoNames.includes(repo);
  const repoDir = validName ? path.join(scope.reposDir, repo) : "";
  if (!validName || !fs.existsSync(path.join(repoDir, ".git"))) {
    return Promise.resolve(refuse(`${repo} is not a repository of this workspace`));
  }
  const refused = refusal(args ?? []);
  if (refused) return Promise.resolve(refuse(refused));
  const problem = currentGitProblem();
  if (problem) return Promise.resolve(refuse(problem));

  let cwd = repoDir;
  let fullArgs = ["--git-dir=.git", ...args];
  if (worktree !== undefined) {
    cwd = path.join(repoDir, String(worktree).replace(/\//g, "--"));
    if (!fs.existsSync(path.join(cwd, ".git"))) {
      return Promise.resolve(refuse(`${worktree} is not a checked-out worktree of ${repo}`));
    }
    fullArgs = [...args];
  }

  return new Promise((resolve) => {
    execFile(
      "git",
      fullArgs,
      {
        cwd,
        timeout: TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT,
        encoding: "utf-8",
        // Never wait on a prompt (credentials, an editor): fail instead.
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" },
      },
      (error, stdout, stderr) => {
        const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0;
        log.debug(`git ${args.join(" ")} (${repo}${worktree ? `@${worktree}` : ""}) → ${exitCode}`);
        if (!error) {
          resolve({ ok: true, exitCode: 0, stdout, stderr });
          return;
        }
        // git's own error line (fatal: / error:), else the first line it printed.
        const lines = stderr
          .split("\n")
          .map((l) => l.trim())
          .filter(Boolean);
        const message = lines.find((l) => /^(fatal|error):/.test(l)) ?? lines[0] ?? error.message;
        resolve({ ok: false, exitCode, stdout, stderr, error: message });
      },
    );
  });
}
