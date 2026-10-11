/**
 * git-binary.ts — which git the platform uses, checked once at startup.
 *
 * The app runs the user's installed git (their SSH keys, credential helpers
 * and config just work). At startup the platform finds a usable one — new
 * enough, and on macOS never the developer-tools stub at /usr/bin/git, which
 * pops a system install prompt when run without the tools — and puts its
 * directory first on the main process's PATH. Everything in the main process
 * that runs `git` (the platform's git services, agent tools, extension
 * backends) then runs that same git; shipping a bundled git later only
 * changes which directory goes first. When no usable git is found, PATH is
 * left alone and the platform's git services refuse with the problem.
 *
 * OS access is injected (`GitProbe`) so the resolution is unit-testable.
 */

import { execFile } from "child_process";
import fs from "fs";
import path from "path";

/** The oldest git the platform supports (`git worktree remove` is 2.17). */
export const MIN_GIT_VERSION = [2, 17, 0] as const;

export type GitStatus =
  | { readonly ok: true; readonly path: string; readonly version: string }
  | { readonly ok: false; readonly problem: string };

/** The OS access the resolution needs. */
export interface GitProbe {
  readonly platform: NodeJS.Platform;
  /** The PATH to search (the main process's). */
  readonly pathEnv: string;
  /** `OPENP41GE_GIT`: an explicit git to use instead of searching. */
  readonly override?: string;
  isExecutable(file: string): boolean;
  run(cmd: string, args: readonly string[]): Promise<{ ok: boolean; stdout: string }>;
}

const MIN = MIN_GIT_VERSION.join(".");
/** macOS's developer-tools stub: runs git only when the tools are installed. */
const MACOS_STUB = "/usr/bin/git";

/** Places git is commonly installed but often missing from a GUI app's PATH. */
const EXTRA_DIRS: Partial<Record<NodeJS.Platform, readonly string[]>> = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"],
  linux: ["/usr/bin", "/usr/local/bin"],
  win32: ["C:\\Program Files\\Git\\cmd"],
};

const pathApi = (platform: NodeJS.Platform) => (platform === "win32" ? path.win32 : path.posix);

/** `[major, minor, patch]` from `git --version` output, or null. */
export function parseGitVersion(output: string): [number, number, number] | null {
  const m = /git version (\d+)\.(\d+)(?:\.(\d+))?/.exec(output);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3] ?? 0)] : null;
}

function atLeastMin(version: readonly number[]): boolean {
  for (let i = 0; i < MIN_GIT_VERSION.length; i++) {
    if (version[i] !== MIN_GIT_VERSION[i]) return version[i] > MIN_GIT_VERSION[i];
  }
  return true;
}

/** The git binaries to try, in order. */
function candidates(probe: GitProbe): string[] {
  const api = pathApi(probe.platform);
  const exe = probe.platform === "win32" ? "git.exe" : "git";
  const dirs = [
    ...probe.pathEnv.split(api.delimiter).filter(Boolean),
    ...(EXTRA_DIRS[probe.platform] ?? []),
  ];
  const files = [...new Set(dirs.map((d) => api.join(d, exe)))];
  // On macOS prefer a real git (Homebrew, …) over the developer-tools stub.
  if (probe.platform === "darwin" && files.includes(MACOS_STUB)) {
    return [...files.filter((f) => f !== MACOS_STUB), MACOS_STUB];
  }
  return files;
}

/** Check one git binary: usable, or why not. */
async function check(probe: GitProbe, file: string): Promise<GitStatus> {
  if (probe.platform === "darwin" && file === MACOS_STUB) {
    const tools = await probe.run("xcode-select", ["-p"]);
    if (!tools.ok) {
      return {
        ok: false,
        problem:
          "Git needs the Xcode Command Line Tools. Install them with: xcode-select --install",
      };
    }
  }
  const out = await probe.run(file, ["--version"]);
  const version = out.ok ? parseGitVersion(out.stdout) : null;
  if (!version) return { ok: false, problem: "Git was not found." };
  const text = version.join(".");
  if (!atLeastMin(version)) {
    return { ok: false, problem: `Git ${MIN} or newer is required; ${text} is installed.` };
  }
  return { ok: true, path: file, version: text };
}

/** Find the git the platform should use. */
export async function resolveGit(probe: GitProbe): Promise<GitStatus> {
  if (probe.override) {
    if (!probe.isExecutable(probe.override)) {
      return {
        ok: false,
        problem: "Git was not found.",
      };
    }
    return check(probe, probe.override);
  }
  let firstProblem: GitStatus | null = null;
  for (const file of candidates(probe)) {
    if (!probe.isExecutable(file)) continue;
    const status = await check(probe, file);
    if (status.ok) return status;
    firstProblem ??= status;
  }
  return firstProblem ?? { ok: false, problem: "Git was not found." };
}

/** The problem message for an unusable git, or null when git is usable. */
export function gitProblemOf(status: GitStatus): string | null {
  return status.ok ? null : status.problem;
}

/** `pathEnv` with the resolved git's directory first (unchanged when unusable). */
export function withGitOnPath(
  status: GitStatus,
  pathEnv: string,
  platform: NodeJS.Platform,
): string {
  if (!status.ok) return pathEnv;
  const api = pathApi(platform);
  const dir = api.dirname(status.path);
  const rest = pathEnv.split(api.delimiter).filter((d) => d && d !== dir);
  return [dir, ...rest].join(api.delimiter);
}

// ── The process's git (set once at startup) ─────────────────────────────

let _status: GitStatus | null = null;

/**
 * Record the startup check's result for this process and put its git first
 * on `env.PATH` (the main process's, by default). Called once at startup.
 */
export function applyGitStatus(
  status: GitStatus,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  _status = status;
  env.PATH = withGitOnPath(status, env.PATH ?? "", platform);
}

/** Why git is unusable per the startup check; null when usable (or not yet checked). */
export function currentGitProblem(): string | null {
  return _status ? gitProblemOf(_status) : null;
}

/** The real OS probe for this process. */
export function nodeGitProbe(): GitProbe {
  return {
    platform: process.platform,
    pathEnv: process.env.PATH ?? "",
    override: process.env.OPENP41GE_GIT || undefined,
    isExecutable(file) {
      try {
        fs.accessSync(file, fs.constants.X_OK);
        return fs.statSync(file).isFile();
      } catch {
        return false;
      }
    },
    run(cmd, args) {
      return new Promise((resolve) => {
        execFile(cmd, [...args], { timeout: 5000 }, (err, stdout) =>
          resolve({ ok: !err, stdout: String(stdout ?? "") }),
        );
      });
    },
  };
}
