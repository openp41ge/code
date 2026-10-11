# In-UI Git credentials (prompt-only, never saved)

Date: 2026-09-19
Status: proposal (not yet implemented)

## Goal

Allow cloning/fetching private repositories that require authentication, by
prompting the user for credentials **in the app UI** when Git needs them — and
**never persisting** them. The credential is held in memory only for the
duration of the operation, then discarded.

This is the "prompt at use time" approach used by terminal-less Git GUIs. It
avoids building a credential manager while keeping the secret out of config
files, logs, and the command line.

## Constraints / preferences

- **Never save.** No storing the password/token in config files, logs, git
  config, or the OS keychain.
- Prompt in the UI (window-manager dialog), not via a terminal.
- The app eventually wants a small "remember me" option (OS keychain), but that
  is explicitly out of scope for the beta. Design the mechanism so persistence
  can be layered on later without a rewrite.

## Approach (chosen)

**Option A — `GIT_ASKPASS` + ephemeral env var, with the OS credential helper
disabled.** Least code; matches the "never save" rule.

- Invoke git with:
  `git -c credential.helper= -c core.askPass=<askpass-script> clone <url>`
- Set `OPENP41GE_ASKPASS_USERNAME` / `OPENP41GE_ASKPASS_PASSWORD` env vars for
  the spawned git process **only** (scoped to the child, cleared/unset after).
- The askpass script echoes the username for username prompts and the password
  for password prompts based on the prompt text.
- `credential.helper=` (empty) guarantees git does **not** store the credential
  even if the user has a global OS helper configured.

### Why option B (one-shot credential helper) was not chosen first

A credential helper that only implements `get` and no-ops `store`/`erase` is the
more "correct" shape and handles username/password/token prompts robustly, but
it's more code. Option A gets us there with less. The two are swappable later;
`store` is where a future "remember me" hook would live.

## Flow

1. User adds a repository / clones; git fails with an auth error (401,
   "Authentication failed", "could not read Username", etc.).
2. The app detects the auth failure on the clone path.
3. App shows a **credential modal** in the window-manager: username + password
   (masked input), with a note that the credentials are only used for this
   operation.
4. Renderer sends the credential to the main process over IPC.
5. Main retries the clone **once** with `GIT_ASKPASS` + the ephemeral env vars.
6. Success → clear the string from memory. Failure → clear it anyway, show the
   error, optionally re-prompt.
7. Never log the credential; never put it in the clone URL
   (`https://user:pass@…` leaks via `ps`/git reflog).

## Security hygiene

- `input type="password"`, no autocomplete, no echo.
- Clear the JS string after the operation (no persistent component state).
- Scope env vars to the child git process; unset after.
- Detect auth failure and prompt only then (don't prompt preemptively).

## Files likely touched (updated 2026-10-11)

The clone flow has moved since this was written; these are the current sites.

- Main, clone: `src/main/services/node-git-service.ts` `clone()` spawns
  `git clone --bare --progress` (reached through the `workspace:clone` IPC,
  `electron/ipc-handlers/workspace-handlers.ts`). Add `-c credential.helper=
-c core.askPass=<script>` and the ephemeral env vars on the retry; detect
  the auth failure from its output.
- Main, fetch: `node-git-service.ts` `fetch()` (`workspace:fetch`), same
  treatment.
- Main, extension git runner (`ctx.git`): `src/main/services/extension-git.ts`
  deliberately sets `GIT_TERMINAL_PROMPT=0` ("fail instead") — it should keep
  failing, or get the same askpass path; decide which.
- Renderer callers that would show the prompt: `src/renderer/services/
extension-workspace-actions.ts` (`host.workspace` clone / add repository,
  used by the Repositories sidebar and the workspace editor) and
  `workspace-file-service.ts` `materializeActiveRepos()` (clones on window
  open).
- Prompt UI: the platform's own confirm windows
  (`electron/confirm-dialog-manager.ts`, `src/renderer/confirm.ts`) are the
  nearest existing pattern for a masked-input dialog.
- Askpass helper script (bundled with the app), and preload + `global.d.ts`
  types for the new IPC.
- The Welcome note this plan referred to no longer exists, so there is nothing
  to update there.

## Open questions

- Whether to also support SSH keys via `ssh-agent` (no in-app secret handling)
  alongside the HTTPS path.
- Exact auth-failure detection heuristics (exit codes vs. error text).
- Where the prompt lives: window-manager modal vs. inline in the add-repo row.
