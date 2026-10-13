# Data migrations

When a release changes how the app data folder (`~/.openp41ge-code`, or
`~/.openp41ge-code-dev` for dev builds) is laid out, it ships an
**instruction set**: JSON steps that move and rewrite files in that folder.
The app runs them at startup, before it reads any data. No code is
downloaded, and the app does not carry every past upgrade.

## Rules

- **Data only.** A set's steps use a fixed vocabulary of operations the app
  ships (below). A migration that needs a new operation ships it in an app
  update first.
- **Inside the data folder.** Every path resolves inside it: no `..`, no
  absolute paths, no symlink escapes. A set with a step that would leave the
  folder is refused. (Moving the folder itself is app code, not a
  migration: see `src/main/services/storage-rename.ts`.)
- **Signed.** Each release's sets are signed with ed25519. The app holds only
  the public key and refuses an unsigned or wrongly signed file.
- **Never open on data the app can't read.** The app opens only when the data
  is at its version, or when the download failed but nothing it requires is
  missing (it tries again next start). It never opens on data last used by a
  newer version (there are no reverse migrations), on a failed update, or
  when the check itself failed.

## Writing a set

One file per set, `migrations/<id>.json`:

```jsonc
{
  "id": "2026-10-10-repositories-per-workspace", // unique; sets run in id order
  "description": "Each workspace keeps its clones in its own data folder",
  "release": "0.1.0-alpha.1", // the release it ships with
  "steps": [/* operations, in order */],
}
```

The operations, their fields and variables are documented, and checked, in
`packages/openp41ge/src/main/services/migrations/instruction-set.ts`:

- Files: `move`, `copy`, `mkdir`, `removeIfEmpty`.
- JSON: `rewriteJsonPaths` (strings at or under a prefix get a new prefix, in
  files matching a glob), `removeJsonField`, `renameAppType` (saved tabs of a
  renamed surface get its new app type, and title if given).
- Git: `relinkWorktrees` (a moved clone's own worktrees).
- Iteration: `forEachWorkspace` (`${workspace.id}`, `${workspace.dataDir}`,
  `${workspace.file}`; `only: "oldest"`), `forEachClone` (`${clone}`,
  `${clone.name}`; an `owner` rule adds `${owner.*}`), `forEachEntry`.
- Conditions: `if` with `exists` or `missing`.
- `importLegacyChats`: converts the pre-workspace `chats.json`.

Conditions and iterations are evaluated as the steps run, so a step sees what
the steps before it did. A run stops at the first failing step; there is no
undo.

Add the set's id to
`packages/openp41ge/src/main/services/migrations/required-migrations.ts`.
Every set in this folder is required: a version never opens without the sets
it was built with, and a test checks that list against this folder.

**Try it before releasing.** Dev builds run this folder's sets instead of
downloading, so start the dev build on a copy of some data:
`OPENP41GE_DIR=<copy> pnpm dev` (the copy also holds Chromium's profile).

## Releasing

The release workflow (`.github/workflows/release.yml`, "Data migrations")
runs `packages/openp41ge/scripts/release-migrations.mjs`. It merges every set
whose `release` is the version being released into one `migrations.json`
(`{ "release", "sets" }`), signs it with the `MIGRATIONS_SIGNING_KEY`
secret into `migrations.json.sig`, and attaches both to the GitHub release.

- No sets for the version: no file.
- No signing key: the release fails. Unsigned migrations are never published.

The private key is a GitHub Actions secret, backed up in the maintainer's
macOS Keychain. The public key ships in the app
(`src/main/services/migrations/public-key.ts`).

## In the app

Code: `packages/openp41ge/src/main/services/migrations/` and
`packages/openp41ge/electron/migration-window.ts`.

- `<data>/data-version` holds the app version the data was last brought up
  to. `<data>/migrations/journal.json` records each applied set (its
  description, time and what it did), and the last failure.
- At startup (`startup-migrations.ts`), when the app is newer than the data,
  a release build lists the GitHub releases on every channel. It downloads and
  verifies `migrations.json` from each release after the data version, up to
  and including the running one, then runs the sets not yet in the journal,
  oldest first. A fresh install starts at its own version, with nothing to run.
- Unauthenticated GitHub API (no token). It allows about 60 requests an hour
  per network.
- The **migration window** shows only when there is something to say:
  progress while sets run (just "n of N", never what they are), "Done"; a
  failure ("download the latest version from GitHub", Download / Quit);
  offline, a checklist of what the download needs (internet, the
  distribution servers, rechecked every 3 seconds) with Continue enabled only
  once all are met; newer data (Quit); a failed check (Continue / Quit).
- The manager window's **Migrations** tab summarises it: the data and app
  versions, how many updates ran and when, and whether the last one failed.
