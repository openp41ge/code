/**
 * migration-runner.ts — runs a checked instruction set (`parseInstructionSet`)
 * against the app data folder.
 *
 * Steps run in order; iterations and conditions are evaluated as they are
 * reached, so a step sees what the steps before it did. Every path a step
 * touches must resolve inside the data folder (symlinks included); a step
 * that would leave it fails. The run stops at the first failure and reports
 * what it had done. A step with nothing to do (a folder that is already
 * there, a file with no path to rewrite) is not reported as done, so a set
 * that has already run reports nothing.
 */

import fs from "fs";
import path from "path";
import { scanWorkspaceFiles, type WorkspaceFileRepos } from "../workspace-repositories.js";
import { importLegacyChats, type LegacyChat } from "./legacy-chats.js";
import type { InstructionSet, Step } from "./instruction-set.js";
import {
  byRecentUse,
  findClones,
  isDir,
  move,
  relinkWorktrees,
  removeIfEmpty,
  rewritePaths,
  writeAtomic,
} from "./operations.js";

export interface RunOptions {
  /** The app data folder (`~/.openp41ge-code` or `~/.openp41ge-code-dev`). */
  readonly root: string;
}

export interface RunResult {
  readonly ok: boolean;
  /** What was done, in order (one line per change). */
  readonly done: readonly string[];
  /** Why the run stopped. */
  readonly error?: string;
}

type Vars = Readonly<Record<string, string>>;

/** `true` when `abs` is `root` or inside it, following symlinks that exist. */
function inside(root: string, abs: string): boolean {
  const realRoot = fs.realpathSync(root);
  // The deepest part of the path that exists decides where it really is.
  let probe = abs;
  let rest = "";
  while (!fs.existsSync(probe)) {
    const parent = path.dirname(probe);
    if (parent === probe) break;
    rest = path.join(path.basename(probe), rest);
    probe = parent;
  }
  let real: string;
  try {
    real = path.join(fs.realpathSync(probe), rest);
  } catch {
    return false;
  }
  return real === realRoot || real.startsWith(realRoot + path.sep);
}

class Run {
  readonly done: string[] = [];
  private _workspaces: readonly WorkspaceFileRepos[] | null = null;

  constructor(private readonly _root: string) {}

  /** Fill in a template's variables (a relative path inside the data folder). */
  private _rel(template: string, vars: Vars): string {
    return template.replace(/\$\{([^}]*)\}/g, (_m, name: string) => {
      const value = vars[name];
      if (value === undefined) throw new Error(`\${${name}} has no value here`);
      return value;
    });
  }

  /** A template's absolute path, which must stay in the data folder. */
  private _abs(template: string, vars: Vars): string {
    const abs = path.resolve(this._root, this._rel(template, vars));
    if (!inside(this._root, abs)) {
      throw new Error(`${abs} is outside the data folder`);
    }
    return abs;
  }

  private _show(abs: string): string {
    return path.relative(this._root, abs) || ".";
  }

  /** The workspaces (read once per run), with paths relative to the data folder. */
  private _workspaceList(): readonly WorkspaceFileRepos[] {
    this._workspaces ??= scanWorkspaceFiles(path.join(this._root, "workspaces"), this._root).files;
    return this._workspaces;
  }

  /** The oldest workspace (by `createdAt`; undated ones last), as a list. */
  private _oldest(): readonly WorkspaceFileRepos[] {
    const dated = [...this._workspaceList()].sort((a, b) =>
      (a.createdAt ?? "\uffff").localeCompare(b.createdAt ?? "\uffff"),
    );
    return dated.slice(0, 1);
  }

  /** A workspace's variables under `prefix`, or null when its data folder is
   *  outside the data folder (a custom `dataDir`: not ours to touch). */
  private _workspaceVars(ws: WorkspaceFileRepos, prefix: string): Vars | null {
    const dataDir = path.resolve(this._root, ws.workspace.dataDir);
    if (!inside(this._root, dataDir)) return null;
    return {
      [`${prefix}.id`]: ws.workspace.id,
      [`${prefix}.dataDir`]: path.relative(this._root, dataDir),
      [`${prefix}.file`]: path.relative(this._root, ws.file),
    };
  }

  steps(steps: readonly Step[], vars: Vars): void {
    for (const step of steps) this.step(step, vars);
  }

  step(step: Step, vars: Vars): void {
    switch (step.op) {
      case "move":
      case "copy": {
        const from = this._abs(step.from, vars);
        const to = this._abs(step.to, vars);
        if (!fs.existsSync(from)) throw new Error(`${this._show(from)} does not exist`);
        if (fs.existsSync(to)) throw new Error(`${this._show(to)} already exists`);
        if (step.op === "move") {
          move(from, to);
        } else {
          fs.mkdirSync(path.dirname(to), { recursive: true });
          fs.cpSync(from, to, { recursive: true, preserveTimestamps: true });
        }
        this.done.push(`${step.op} ${this._show(from)} → ${this._show(to)}`);
        return;
      }
      case "mkdir": {
        const dir = this._abs(step.path, vars);
        if (isDir(dir)) return;
        fs.mkdirSync(dir, { recursive: true });
        this.done.push(`mkdir ${this._show(dir)}`);
        return;
      }
      case "removeIfEmpty": {
        const dir = this._abs(step.path, vars);
        if (removeIfEmpty(dir)) this.done.push(`removed empty ${this._show(dir)}`);
        return;
      }
      case "rewriteJsonPaths": {
        const from = this._abs(step.from, vars);
        const to = this._abs(step.to, vars);
        for (const file of this._files(step.files, vars)) {
          const data: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
          const next = JSON.stringify(rewritePaths(data, [[from, to]]));
          if (next === JSON.stringify(data)) continue;
          writeAtomic(file, next);
          this.done.push(`rewrote paths in ${this._show(file)}`);
        }
        return;
      }
      case "relinkWorktrees": {
        const repo = this._abs(step.repo, vars);
        const from = this._abs(step.from, vars);
        // Git records real paths; `from` is gone, so resolve its parent.
        let fromReal = from;
        try {
          fromReal = path.join(fs.realpathSync(path.dirname(from)), path.basename(from));
        } catch {
          // keep as given
        }
        relinkWorktrees(from, fromReal, repo);
        this.done.push(`relinked worktrees of ${this._show(repo)}`);
        return;
      }
      case "forEachWorkspace": {
        const list = step.only === "oldest" ? this._oldest() : this._workspaceList();
        for (const ws of list) {
          const wsVars = this._workspaceVars(ws, "workspace");
          if (wsVars) this.steps(step.do, { ...vars, ...wsVars });
        }
        return;
      }
      case "forEachEntry": {
        const dir = this._abs(step.in, vars);
        let names: string[] = [];
        try {
          names = fs
            .readdirSync(dir, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => e.name)
            .sort();
        } catch {
          return; // no such folder: nothing to do
        }
        for (const name of names) {
          const entry = path.join(dir, name);
          const entryVars: Record<string, string> = {
            ...vars,
            entry: path.relative(this._root, entry),
            "entry.name": name,
          };
          if (step.owner) {
            let named: unknown;
            try {
              const json = JSON.parse(
                fs.readFileSync(path.join(entry, step.owner.fromJson), "utf-8"),
              ) as Record<string, unknown>;
              named = json?.[step.owner.field];
            } catch {
              // unreadable: the fallback owner
            }
            const owner =
              this._workspaceList().find((w) => w.workspace.id === named) ?? this._oldest()[0];
            const ownerVars = owner && this._workspaceVars(owner, "owner");
            if (!ownerVars) continue;
            Object.assign(entryVars, ownerVars);
          }
          this.steps(step.do, entryVars);
        }
        return;
      }
      case "removeJsonField": {
        const file = this._abs(step.file, vars);
        if (!fs.existsSync(file)) return;
        const data = JSON.parse(fs.readFileSync(file, "utf-8")) as Record<string, unknown>;
        if (!data || typeof data !== "object" || !(step.field in data)) return;
        const { [step.field]: _removed, ...rest } = data;
        writeAtomic(file, JSON.stringify(rest, null, 2));
        this.done.push(`removed ${step.field} from ${this._show(file)}`);
        return;
      }
      case "importLegacyChats": {
        const file = this._abs(step.file, vars);
        if (!fs.existsSync(file)) return;
        let chats: LegacyChat[];
        try {
          const parsed = JSON.parse(fs.readFileSync(file, "utf-8")) as { chats?: LegacyChat[] };
          chats = Array.isArray(parsed.chats) ? parsed.chats : [];
        } catch (err) {
          // An unreadable old store is left as it is; it does not stop the run.
          this.done.push(
            `left ${this._show(file)} in place: it could not be read (${String(err)})`,
          );
          return;
        }
        const imported = importLegacyChats(chats, this._abs(step.workspace, vars));
        move(file, `${file}.migrated`);
        this.done.push(
          `imported ${imported} chat(s) from ${this._show(file)} (kept as ${this._show(file)}.migrated)`,
        );
        return;
      }
      case "forEachClone": {
        const dir = this._abs(step.in, vars);
        for (const name of findClones(dir)) {
          const cloneVars: Record<string, string> = {
            ...vars,
            clone: path.relative(this._root, path.join(dir, name)),
            "clone.name": name,
          };
          if (step.owner) {
            const owner = this._workspaceList()
              .filter((ws) => ws.repoNames.includes(name))
              .sort(byRecentUse)[0];
            const ownerVars = owner && this._workspaceVars(owner, "owner");
            if (!ownerVars) continue;
            Object.assign(cloneVars, ownerVars);
          }
          this.steps(step.do, cloneVars);
        }
        return;
      }
      case "if": {
        const probe = step.exists ?? step.missing!;
        const exists = fs.existsSync(this._abs(probe, vars));
        if (exists === (step.exists !== undefined)) this.steps(step.do, vars);
        return;
      }
    }
  }

  /** The files a `files` template names (`*` allowed in the last segment). */
  private _files(template: string, vars: Vars): string[] {
    const abs = this._abs(template, vars);
    const base = path.basename(abs);
    if (!base.includes("*")) return fs.existsSync(abs) ? [abs] : [];
    const dir = path.dirname(abs);
    const pattern = new RegExp(
      `^${base.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*")}$`,
    );
    let names: string[] = [];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    return names.filter((n) => pattern.test(n)).map((n) => path.join(dir, n));
  }
}

/** Run `set` against the data folder; never throws. */
export function runInstructionSet(set: InstructionSet, options: RunOptions): RunResult {
  const run = new Run(options.root);
  try {
    run.steps(set.steps, {});
    return { ok: true, done: run.done };
  } catch (err) {
    return {
      ok: false,
      done: run.done,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
