2026-10-17

# Scoped terminals

The terminal is a **platform** tab type (like the file editor), always opened
scoped to a single binary — the git terminal, the sed terminal — never a full
shell. **Extensions define the binaries**: the git extension defines `git`
and its allow / deny rules, in its own config. A binary no extension defines
cannot run. A full terminal may come later.

It is mainly how AI agents make command tool calls and get a response, so a
command runs without a tab being open.

## Decisions (user, 2026-10-17 / 18)

- **Platform terminal, scoped to one binary.** Each line runs
  `<binary> <args>`; no shell: arguments are passed as they are (`|`, `;`,
  `>`, `$VAR`, globs are plain text). A person types a line, split into
  arguments (quotes and `\` escapes group them); an agent passes the list.
- **Extensions define binaries; the rules live in the extension's config**
  (its `registerConfigSchema` section, edited in its config editor), not
  centrally. **Live as soon as the extension is installed.**
- **Pattern rules, allow + deny, deny wins**, over the argument list: a
  literal word, `*` (one argument), `**` (any number, anywhere), `a|b`. Flags
  before a subcommand are written into the rule. Unapproved → refused, with a
  link to the defining extension's settings.
- **Two extensions define the same binary → the user picks one**; until then
  an official extension's wins, otherwise the binary stays off.
- **The tab is optional.** It shows the runs of its binary and worktree
  (agents' too) and a prompt for that binary, under the same rules. A tool
  call dragged from a chat onto the grid opens the terminal for that run.
- **Runs are non-interactive** (agents and people alike): no stdin, pagers
  and editors off, a timeout and an output cap; output and exit code come
  back. No PTY yet (no `node-pty`); the full terminal will need one.
- **One agent tool**, `run_command`, whose description lists the binaries.

## Contract (proposal — confirm)

- **Definition** (SDK, either entry): `registerCommandBinaries({ git: {
  label, config: "commands.git" } })` — `config` is the path in the
  extension's own config where `{ allow: string[], deny: string[] }` lives;
  the platform reads the merged config at run time, so edits apply at once.
  Validated at load (the path must exist in its schema).
- **Callers** (any backend): `ctx.commands.binaries()` (name, label, rules,
  defining extension), `ctx.commands.run({ binary, args, worktree })` →
  `{ ok, exitCode, output, truncated, runId, error }`; the worktree resolves
  within the caller's workspace.
- **Kind** `openp41ge/command-run` (platform; drag + open):
  `{ binary, args, worktree, runId }` (`args` a JSON array string). Default
  consumer: the platform `terminal` tab. The palette offers "Git terminal"
  etc. (`{ binary, worktree }`).
- **Conflict choice** `commandBinaries` in `config.json`: binary →
  extension id, in Settings beside `dragConsumers`.
- **Platform settings** `terminal.timeoutSeconds` (60),
  `terminal.maxOutputKb` (256).
- **Env for every run:** `GIT_PAGER=cat`, `PAGER=cat`, `GIT_EDITOR=false`,
  `EDITOR=false`, `GIT_TERMINAL_PROMPT=0`, `LESSSECURE=1`; cwd the worktree.
- **Git extension default:** allow `status **`, `log **`, `show **`,
  `diff **`, `blame **`, `branch --list **`; deny `** --output*`,
  `** --ext-diff **`.

## Pieces

1. SDK: `registerCommandBinaries`, `ctx.commands`, the kind, types; rule
   matching and argument splitting (pure).
2. Platform main: binary registry (from every extension + the conflict
   choice), the runner (spawn behind an interface, in-memory for tests),
   run history (recent runs per workspace, bounded, on disk), IPC + events.
3. Platform renderer: the `terminal` tab (runs list, prompt, worktree menu,
   output through xterm from `openp41ge-core-terminal`), the kind's consumer,
   palette entries, the `commandBinaries` setting.
4. Git extension: the `commands.git` config and its registration.
5. Agents: `run_command` through `ctx.commands`; its tool-call row is a drag
   source of the kind.
6. Remove the old `TerminalManager`, `terminal:*` IPC / preload, the
   unregistered `TerminalController` and its knip ignores.

## Known limits (to tell the user)

- Some binaries are interpreters (`sed` `w`/`e`, `awk`, `find -exec`,
  `xargs`): rules see arguments, not what a script does.
- A binary needs an extension to define it (e.g. `sed` needs one).

## Status

- [x] Design decisions
- [x] Contract names and defaults confirmed (user, 2026-10-18)
- [ ] Tests first (code-tests)
- [ ] Pieces 1–6
- [ ] AGENTS.md (§2.9, §3), checked in the app
