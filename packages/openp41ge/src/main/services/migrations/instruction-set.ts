/**
 * instruction-set.ts — a data migration as data: the steps a downloaded
 * instruction set may contain, and the check every set passes before it runs.
 *
 * A set is JSON. Its steps use only the operations the app ships (below);
 * nothing in it is code. Paths are relative to the app data folder and may
 * use the variables of the iteration they are in:
 *   - `forEachWorkspace`: `${workspace.id}`, `${workspace.dataDir}`,
 *     `${workspace.file}`;
 *   - `forEachClone`: `${clone}` (the clone folder), `${clone.name}`
 *     (`<host>/<org>/<repo>`), and with an `owner` rule `${owner.id}`,
 *     `${owner.dataDir}`, `${owner.file}`;
 *   - `forEachEntry`: `${entry}` (a folder in `in`), `${entry.name}`, and
 *     with an `owner` rule the `owner.*` variables.
 * A set that uses anything else, an absolute path, or `..` is refused whole.
 */

export type Step =
  | { readonly op: "move" | "copy"; readonly from: string; readonly to: string }
  | { readonly op: "mkdir" | "removeIfEmpty"; readonly path: string }
  | {
      readonly op: "rewriteJsonPaths";
      /** A file, or files matching `*` in the last segment. */
      readonly files: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      /** Saved tabs (any object with an `appType`) of app type `from` get
       *  `to`, and `title` when given — a renamed surface. */
      readonly op: "renameAppType";
      /** A file, or files matching `*` in the last segment. */
      readonly files: string;
      readonly from: string;
      readonly to: string;
      readonly title?: string;
    }
  | {
      readonly op: "relinkWorktrees";
      /** The clone's folder now. */
      readonly repo: string;
      /** Where it was. */
      readonly from: string;
    }
  | {
      readonly op: "removeJsonField";
      readonly file: string;
      /** A top-level field of the JSON object in `file`. */
      readonly field: string;
    }
  | {
      /** Convert the old single chat store (`chats.json`) into a workspace's
       *  chat threads, then rename it `<file>.migrated`. An unreadable file
       *  is left in place (and noted). */
      readonly op: "importLegacyChats";
      readonly file: string;
      /** The workspace's data folder. */
      readonly workspace: string;
    }
  | {
      readonly op: "forEachWorkspace";
      /** Only the oldest workspace (by `createdAt`). */
      readonly only?: "oldest";
      readonly do: readonly Step[];
    }
  | {
      readonly op: "forEachEntry";
      /** The folder whose sub-folders are iterated. */
      readonly in: string;
      /** Which workspace each entry belongs to; entries without one are skipped. */
      readonly owner?: EntryOwner;
      readonly do: readonly Step[];
    }
  | {
      readonly op: "forEachClone";
      /** The folder holding the clones. */
      readonly in: string;
      /** Which workspace each clone belongs to; clones without one are skipped. */
      readonly owner?: "mostRecentWorkspaceListing";
      readonly do: readonly Step[];
    }
  | {
      readonly op: "if";
      readonly exists?: string;
      readonly missing?: string;
      readonly do: readonly Step[];
    };

/** An entry's workspace: the one a JSON file in the entry names, else `otherwise`. */
export interface EntryOwner {
  /** A JSON file inside the entry, e.g. `thread.json`. */
  readonly fromJson: string;
  /** Its field holding a workspace id. */
  readonly field: string;
  readonly otherwise: "oldestWorkspace";
}

export interface InstructionSet {
  /** Unique and sortable, e.g. `2026-10-repos-per-workspace`. */
  readonly id: string;
  readonly description: string;
  /** The release it is attached to. */
  readonly release: string;
  readonly steps: readonly Step[];
}

const WORKSPACE_VARS = ["workspace.id", "workspace.dataDir", "workspace.file"];
const CLONE_VARS = ["clone", "clone.name"];
const OWNER_VARS = ["owner.id", "owner.dataDir", "owner.file"];
const ENTRY_VARS = ["entry", "entry.name"];

type Obj = Record<string, unknown>;

class InstructionSetError extends Error {}

function fail(where: string, message: string): never {
  throw new InstructionSetError(`${where}: ${message}`);
}

/** A path template: relative, no `..`, only the variables in scope. */
function checkPath(value: unknown, where: string, vars: ReadonlySet<string>): string {
  if (typeof value !== "string" || !value.trim()) fail(where, "a path is required");
  for (const [, name] of value.matchAll(/\$\{([^}]*)\}/g)) {
    if (!vars.has(name)) fail(where, `unknown variable \${${name}}`);
  }
  if (value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value)) {
    fail(where, `"${value}" must be relative to the data folder`);
  }
  if (value.split(/[\\/]/).some((seg) => seg === "..")) {
    fail(where, `"${value}" must not leave the data folder`);
  }
  return value;
}

/** An app type: `ext:<extensionId>:<surfaceId>` or a platform one, no spaces. */
function checkAppType(value: unknown, where: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9._:-]+$/.test(value)) {
    fail(where, "an app type is required");
  }
  return value;
}

function checkSteps(value: unknown, where: string, vars: ReadonlySet<string>): Step[] {
  if (!Array.isArray(value)) fail(where, "steps must be a list");
  return value.map((raw, i) => checkStep(raw, `${where}[${i}]`, vars));
}

function checkStep(raw: unknown, where: string, vars: ReadonlySet<string>): Step {
  if (!raw || typeof raw !== "object") fail(where, "a step must be an object");
  const s = raw as Obj;
  const at = `${where} (${String(s.op)})`;
  switch (s.op) {
    case "move":
    case "copy":
      return {
        op: s.op,
        from: checkPath(s.from, `${at}.from`, vars),
        to: checkPath(s.to, `${at}.to`, vars),
      };
    case "mkdir":
    case "removeIfEmpty":
      return { op: s.op, path: checkPath(s.path, `${at}.path`, vars) };
    case "rewriteJsonPaths":
      return {
        op: s.op,
        files: checkPath(s.files, `${at}.files`, vars),
        from: checkPath(s.from, `${at}.from`, vars),
        to: checkPath(s.to, `${at}.to`, vars),
      };
    case "renameAppType": {
      const from = checkAppType(s.from, `${at}.from`);
      const to = checkAppType(s.to, `${at}.to`);
      if (from === to) fail(at, "from and to are the same");
      if (s.title !== undefined && (typeof s.title !== "string" || !s.title.trim())) {
        fail(`${at}.title`, "must be a non-empty string");
      }
      return {
        op: s.op,
        files: checkPath(s.files, `${at}.files`, vars),
        from,
        to,
        ...(s.title !== undefined ? { title: s.title as string } : {}),
      };
    }
    case "relinkWorktrees":
      return {
        op: s.op,
        repo: checkPath(s.repo, `${at}.repo`, vars),
        from: checkPath(s.from, `${at}.from`, vars),
      };
    case "removeJsonField":
      if (typeof s.field !== "string" || !s.field) fail(at, "field is required");
      return { op: s.op, file: checkPath(s.file, `${at}.file`, vars), field: s.field };
    case "importLegacyChats":
      return {
        op: s.op,
        file: checkPath(s.file, `${at}.file`, vars),
        workspace: checkPath(s.workspace, `${at}.workspace`, vars),
      };
    case "forEachWorkspace":
      if (s.only !== undefined && s.only !== "oldest") {
        fail(at, `unknown only "${String(s.only)}"`);
      }
      return {
        op: s.op,
        ...(s.only ? { only: "oldest" as const } : {}),
        do: checkSteps(s.do, `${at}.do`, new Set([...vars, ...WORKSPACE_VARS])),
      };
    case "forEachEntry": {
      let owner: EntryOwner | undefined;
      if (s.owner !== undefined) {
        const o = s.owner as Obj;
        if (!o || typeof o !== "object") fail(at, "owner must be an object");
        if (typeof o.field !== "string" || !o.field) fail(at, "owner.field is required");
        if (o.otherwise !== "oldestWorkspace")
          fail(at, 'owner.otherwise must be "oldestWorkspace"');
        owner = {
          fromJson: checkPath(o.fromJson, `${at}.owner.fromJson`, new Set()),
          field: o.field,
          otherwise: "oldestWorkspace",
        };
      }
      return {
        op: s.op,
        in: checkPath(s.in, `${at}.in`, vars),
        ...(owner ? { owner } : {}),
        do: checkSteps(
          s.do,
          `${at}.do`,
          new Set([...vars, ...ENTRY_VARS, ...(owner ? OWNER_VARS : [])]),
        ),
      };
    }
    case "forEachClone": {
      if (s.owner !== undefined && s.owner !== "mostRecentWorkspaceListing") {
        fail(at, `unknown owner rule "${String(s.owner)}"`);
      }
      const inner = new Set([...vars, ...CLONE_VARS, ...(s.owner ? OWNER_VARS : [])]);
      return {
        op: s.op,
        in: checkPath(s.in, `${at}.in`, vars),
        ...(s.owner ? { owner: "mostRecentWorkspaceListing" as const } : {}),
        do: checkSteps(s.do, `${at}.do`, inner),
      };
    }
    case "if": {
      if ((s.exists === undefined) === (s.missing === undefined)) {
        fail(at, "needs exactly one of exists / missing");
      }
      return {
        op: s.op,
        ...(s.exists !== undefined ? { exists: checkPath(s.exists, `${at}.exists`, vars) } : {}),
        ...(s.missing !== undefined
          ? { missing: checkPath(s.missing, `${at}.missing`, vars) }
          : {}),
        do: checkSteps(s.do, `${at}.do`, vars),
      };
    }
    default:
      return fail(where, `unknown operation "${String(s.op)}"`);
  }
}

/**
 * Check a downloaded instruction set; throws, naming the step, when anything
 * in it is not allowed. The result holds only what was checked.
 */
export function parseInstructionSet(value: unknown): InstructionSet {
  if (!value || typeof value !== "object") fail("set", "must be an object");
  const v = value as Obj;
  for (const key of ["id", "description", "release"]) {
    if (typeof v[key] !== "string" || !(v[key] as string).trim()) fail("set", `${key} is required`);
  }
  return {
    id: v.id as string,
    description: v.description as string,
    release: v.release as string,
    steps: checkSteps(v.steps, "steps", new Set()),
  };
}
