/**
 * commands.ts — the command contract: binaries a scoped terminal runs.
 *
 * The platform's terminal is locked to one binary (the git terminal, the sed
 * terminal), never a shell. Extensions define the binaries that can run
 * (`registerCommandBinaries`, backend entry), each naming where in the
 * extension's own config its rules live (`{ allow, deny }`). A binary no
 * extension defines cannot run.
 *
 *   - **No shell.** A typed line is split into arguments
 *     (`splitCommandLine`: quotes and `\` group them); `|`, `;`, `>`,
 *     `$VAR`, globs are plain argument text. An agent passes the list.
 *   - **Rules** match the whole argument list (without the binary's name),
 *     word by word: a literal word, `*` (one argument; inside a word, any
 *     characters), `**` (any number of arguments, anywhere), `a|b` (either).
 *     A line runs when an allow rule matches and no deny rule does
 *     (`checkCommand`).
 *
 * Backends run commands through `ctx.commands` (context.ts); a run is the
 * platform kind `openp41ge/command-run` (drag.ts, open.ts).
 */

/** A binary an extension defines (`registerCommandBinaries`). */
export interface CommandBinaryDecl {
  /** What its terminal is called ("Git"). */
  readonly label: string;
  /** Where its `{ allow, deny }` rules live in the extension's config, as a
   *  dot path (`"commands.git"`). Read on each run, so edits apply at once. */
  readonly config: string;
}

/** What `registerCommandBinaries` takes: binary name → its definition. */
export type CommandBinaryRegistrations = Readonly<Record<string, CommandBinaryDecl>>;

/** A defined binary, as the host reads it from a scope. */
export interface CommandBinaryDef extends CommandBinaryDecl {
  /** The executable's name, found on `PATH` (`git`). */
  readonly binary: string;
}

/** A binary's rules: allow and deny patterns over its argument list. */
export interface CommandRules {
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

/** Whether a command line may run, and why not. */
export type CommandCheck =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string };

/** A command to run: `binary` with `args` (no shell) in a worktree of the
 *  calling window's workspace. */
export interface CommandRequest {
  readonly binary: string;
  /** The arguments after the binary's name. */
  readonly args: readonly string[];
  /** The repository (`<host>/<org>/<repo>`, as in `workspaceRepos`). */
  readonly repo: string;
  /** The branch whose worktree it runs in. */
  readonly worktree: string;
}

/** What a command printed, or why it did not run. */
export interface CommandResult {
  /** It ran and exited 0. */
  readonly ok: boolean;
  /** Its exit code; null when it did not run (refused, not found) or was
   *  stopped (timeout). */
  readonly exitCode: number | null;
  /** What it printed (stdout and stderr, in order), cut at the output cap. */
  readonly output: string;
  /** The output was cut. */
  readonly truncated: boolean;
  /** The run's id (open it in a terminal); empty when nothing ran. */
  readonly runId: string;
  /** Why it failed: the refusal, the timeout, or that it was not found. */
  readonly error?: string;
}

/** A binary that can run now, with its current rules. */
export interface CommandBinaryInfo {
  readonly binary: string;
  readonly label: string;
  /** The extension that defines it. */
  readonly extensionId: string;
  readonly allow: readonly string[];
  readonly deny: readonly string[];
}

const BINARY_NAME = /^[A-Za-z0-9_][A-Za-z0-9._+-]*$/;

/**
 * Split a typed command line into arguments, as a POSIX shell would split
 * words but without any of its other syntax: whitespace separates; `'…'`
 * groups literally; `"…"` groups, with `\"` and `\\` escaped; a `\` outside
 * quotes takes the next character literally. Throws on an unterminated quote.
 */
export function splitCommandLine(line: string): string[] {
  const args: string[] = [];
  let word = "";
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error("unterminated ' quote");
      word += line.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      let j = i + 1;
      for (; j < line.length && line[j] !== '"'; j++) {
        if (line[j] === "\\" && (line[j + 1] === '"' || line[j + 1] === "\\")) j++;
        word += line[j];
      }
      if (j >= line.length) throw new Error('unterminated " quote');
      inWord = true;
      i = j;
    } else if (c === "\\" && i + 1 < line.length) {
      word += line[++i];
      inWord = true;
    } else if (/\s/.test(c)) {
      if (inWord) args.push(word);
      word = "";
      inWord = false;
    } else {
      word += c;
      inWord = true;
    }
  }
  if (inWord) args.push(word);
  return args;
}

/** One rule word: `**`, or alternatives each matching one argument. */
type RuleWord = "**" | RegExp;

function parseRule(rule: string): RuleWord[] {
  return splitCommandLine(rule).map((w) => {
    if (w === "**") return "**";
    const alternatives = w.split("|").map((alt) =>
      alt
        .split("*")
        .map((s) => s.replace(/[.+?^${}()[\]\\/-]/g, "\\$&"))
        .join(".*"),
    );
    return new RegExp(`^(?:${alternatives.join("|")})$`, "s");
  });
}

function matchWords(words: readonly RuleWord[], args: readonly string[]): boolean {
  // Positions in `args` the rule can have reached after each word.
  let reach = new Set([0]);
  for (const w of words) {
    const next = new Set<number>();
    for (const at of reach) {
      if (w === "**") for (let k = at; k <= args.length; k++) next.add(k);
      else if (at < args.length && w.test(args[at])) next.add(at + 1);
    }
    if (next.size === 0) return false;
    reach = next;
  }
  return reach.has(args.length);
}

/** Whether `rule` matches the whole argument list `args`. */
export function matchCommandRule(rule: string, args: readonly string[]): boolean {
  return matchWords(parseRule(rule), args);
}

/** Whether `args` may run under `rules`: an allow rule matches and no deny rule does. */
export function checkCommand(rules: CommandRules, args: readonly string[]): CommandCheck {
  const denied = rules.deny.find((r) => matchCommandRule(r, args));
  if (denied !== undefined) return { allowed: false, reason: `denied by '${denied}'` };
  if (rules.allow.some((r) => matchCommandRule(r, args))) return { allowed: true };
  return { allowed: false, reason: "no allow rule matches" };
}

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === "string");

/** The `{ allow, deny }` rules at the dot path `at` of `config`; null when
 *  it is missing or malformed. A missing `deny` is none. */
export function commandRulesAt(config: unknown, at: string): CommandRules | null {
  let value: unknown = config;
  for (const key of at.split(".")) {
    if (typeof value !== "object" || value === null) return null;
    value = (value as Record<string, unknown>)[key];
  }
  if (typeof value !== "object" || value === null) return null;
  const { allow, deny = [] } = value as Record<string, unknown>;
  if (!isStringArray(allow) || !isStringArray(deny)) return null;
  return { allow, deny };
}

/** Validate `registerCommandBinaries`' argument; throws on the first problem. */
export function parseCommandBinaries(regs: CommandBinaryRegistrations): CommandBinaryDef[] {
  return Object.entries(regs ?? {}).map(([binary, decl]) => {
    if (!BINARY_NAME.test(binary)) {
      throw new Error(
        `'${binary}' is not a binary name (a name found on PATH: letters, digits, . _ + -)`,
      );
    }
    if (typeof decl?.label !== "string" || decl.label === "") {
      throw new Error(`binary '${binary}' needs a label`);
    }
    if (typeof decl.config !== "string" || !/^[^.]+(\.[^.]+)*$/.test(decl.config)) {
      throw new Error(`binary '${binary}' needs a config path (e.g. "commands.${binary}")`);
    }
    return { binary, label: decl.label, config: decl.config };
  });
}
