/**
 * prerequisites.ts — what the app needs installed to run, each marked met or
 * missing from the startup checks. When any is missing the app shows the
 * prerequisites window instead of its normal windows (see
 * electron/prerequisites-window.ts). Add a prerequisite here and it appears
 * in the window.
 */

import { MIN_GIT_VERSION, type GitStatus } from "./git-binary.js";

/** One prerequisite and whether it is met (sent to the prerequisites window). */
export interface PrerequisiteResult {
  readonly id: string;
  readonly name: string;
  /** What is required, e.g. "2.17 or newer". */
  readonly requirement: string;
  readonly ok: boolean;
  /** What was found (when met) or what is wrong (when missing). */
  readonly detail: string;
  /** Where to get it (offered when missing). */
  readonly helpUrl?: string;
}

/** The startup checks the prerequisites are derived from. */
export function prerequisitesFor(git: GitStatus): PrerequisiteResult[] {
  return [
    {
      id: "git",
      name: "Git",
      requirement: `${MIN_GIT_VERSION.slice(0, 2).join(".")} or newer`,
      ok: git.ok,
      // User-facing: the version, never a path on the system.
      detail: git.ok ? `Version ${git.version}` : git.problem,
      ...(git.ok ? {} : { helpUrl: "https://git-scm.com/downloads" }),
    },
  ];
}

/** True when every prerequisite is met. */
export function allMet(results: readonly PrerequisiteResult[]): boolean {
  return results.every((r) => r.ok);
}
