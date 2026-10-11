2026-10-10

# Data migrations (downloadable instruction sets)

## Goal

Move and rewrite files in the app data folder (`~/.openp41ge` or
`~/.openp41ge-dev`) when a release changes its layout, without carrying every
past upgrade in the app. Prompted by the per-workspace repositories move
(the completed workspace-repositories plan, `45f7ef96`), which was code built
into the app (`migrateRepositories`), as was the chat-threads move
(`chat-threads-migration.ts`); both are instruction sets now.

## Decisions (user, 2026-10-10)

1. **Data-only steps over built-in operations.** An instruction set is JSON:
   a list of steps using a fixed vocabulary the app ships (move, copy, mkdir,
   remove-if-empty, rewrite paths in JSON files, relink git worktrees, "for
   each workspace / clone" with variables and simple conditions). No code is
   downloaded. A migration that needs a new operation ships it in an app
   update first.
2. **Signed.** Each instruction set is signed; the public key ships in the
   app. Unsigned or wrongly signed sets are refused.
3. **Attached to releases**, and an install that skips versions runs every
   release's migrations between the version it last migrated to and the one
   it now runs (user: "the client may need to update through several
   versions so i want to make sure we can download the latest and the
   download all the upgrade files between versions").
4. **At startup, before any data is read; automatic.** Recorded in a journal
   and listed in the manager window. An app version names the migrations it
   requires; if one is not applied and cannot be downloaded, a window says the
   app needs to be online once, with Retry.

## Migration window (user, 2026-10-10)

Shows at startup **only when sets are pending**, before the app reads any
data: it lists each set (description, state), runs them straight away with
progress, and closes itself shortly after "Done"; the app then opens. On a
failure it stays, with the error, Show the journal, Quit and Retry; the app
never opens on half-updated data. The "needs to be online once" case (phase 5) becomes a state of this window, not a separate one.

## Never opening on data it cannot read (user, 2026-10-10)

"This mismatch can lead to data corruption": the app opens only when the data
is at its version (or migrations are only deferred while nothing required is
missing). The migration window also refuses to open the app when the data
was last used by a **newer** version (`newer`: Quit only — there are no
reverse migrations), and when the check itself fails (`error`: Retry /
Quit), instead of opening anyway.

## Design

### Instruction set

```jsonc
{
  "id": "2026-10-repos-per-workspace", // unique, sortable
  "description": "Each workspace keeps its clones in its own data folder",
  "release": "0.2.0", // the release it is attached to
  "steps": [/* operations, in order */],
}
```

Committed as one file per set (`migrations/<id>.json`). Each GitHub release
carries **one** file (user, 2026-10-10: "only 1 file for each release"): the
release pipeline merges every set whose `release` is that version into
`migrations.json` and signs it (`migrations.json.sig`):

```jsonc
{ "release": "0.1.0-alpha.11", "sets": [/* instruction sets, by id */] }
```

### Operations (the app's fixed vocabulary)

- File: `move`, `copy`, `mkdir`, `removeIfEmpty`.
- JSON: `rewriteJsonPaths` (strings at / under a prefix → a new prefix, in
  files matching a glob).
- Git: `relinkWorktrees` (a moved clone's own worktrees only — not
  `git worktree repair`, see the repositories plan).
- Iteration: `forEachWorkspace` (variables `${workspace.id}`,
  `${workspace.dataDir}`, `${workspace.file}`), `forEachClone` (in a folder;
  `${clone}`, `${clone.name}`, an owner rule such as
  `mostRecentWorkspaceListing`).
- Conditions: `ifExists`, `ifMissing`.

Every path resolves inside the data folder (no `..`, no absolute paths, no
symlink escapes); a step that would leave it is refused, and so is the set.

### Finding what to run

- `<data>/migrations/journal.json` records each applied id (time, result).
- `<data>/data-version` (a top-level file holding just a version; user,
  2026-10-10) records the app version the data was last brought up to. It
  lives with the data, so a deleted and reinstalled — or much newer — app
  still knows which releases' migrations the data needs. It is written when
  that changes, not on every start (user: not needed).
- At startup, when the app version is newer than the data version: list the
  GitHub releases (all channels: a stable install that skips an alpha still
  needs its migrations), take each release with a version in
  (data version, current], download and verify its `migrations.json`, and
  run the sets not yet in the journal, oldest release first.
- A fresh install (no data yet) starts at the current version: nothing to run.
- Dev builds read the repo's own `migrations/` folder instead of releases, so
  a migration is tried against `~/.openp41ge-dev` (or a copy, via
  `OPENP41GE_DIR`) before it is released.

### Running

1. Plan: expand iterations and variables into concrete steps; check every
   path; check for conflicts (a target that exists). Nothing is touched yet.
2. Apply in order, writing each completed step to the journal; stop at the
   first failure. (Undo is per operation where possible: a move moves back.)
3. Record the set as applied, or as failed with the step and error.
4. Required but unavailable (offline, signature bad, release asset missing):
   the blocking "needs to be online once" window, Retry / Quit.

### Release side

- Migration sets live in the repo (`migrations/<id>.json`); the release
  workflow merges the ones for that release into one `migrations.json`, signs
  it with a key from a CI secret, and attaches both files.
- The app's required ids: generated at build time from the same folder.

## Decided later (user, 2026-10-10)

- **Signing key**: ed25519; the private half is backed up in the user's macOS
  Keychain and set as a GitHub Actions secret; only the public half ships in
  the app.
- **Built-in migrations become instruction sets**: the repositories move and
  the chat-threads move are rewritten as the first sets and their code is
  removed. (A release install then needs network on its first start after the
  update.)
- **No GitHub token**: the unauthenticated API is enough.

## Phases

1. ~~Operations + runner~~ — done (`main/services/migrations/`:
   `parseInstructionSet` checks a set; `runInstructionSet` runs it; the file
   helpers moved to `operations.ts`, shared with the built-in repositories
   migration). Tested on fixture data folders, including the repositories
   move written as a set (real git; a second run does nothing) and a symlink
   escape. Conditions and iterations are evaluated as steps run, not planned
   up front: a step sees what the steps before it did. No undo yet: a run
   stops at the first failure and reports what it had done.
2. ~~Journal, local folder, startup hook~~ — done (`pending-migrations.ts`:
   `<data>/migrations/journal.json`; pending sets run in id order, a failure
   stops the run and is retried next start). Dev builds run the repo's
   `migrations/` folder at startup; release builds still run the built-in
   repositories migration until phase 3–4. First set:
   `migrations/2026-10-10-repositories-per-workspace.json` (release
   0.1.0-alpha.11). A dry run on a copy of the already-migrated dev data
   applied it as a no-op (it removed only the empty `repositories` folder).
3. ~~Signing + verification; downloading across several versions~~ — done
   as a library (`versions.ts`, `signature.ts` ed25519 via Node `crypto`,
   `release-migrations.ts`: the release list (paged), the published releases
   after `from` through `to` on every channel, each one's `migrations.json`
   checked against its `.sig`; a bad or missing signature fails the whole
   download). `migrationRange` / `writeDataVersion` keep the data version
   (`<data>/data-version`) (a fresh install starts at its version; data from before the
   journal starts at `0.0.0`). Tested with throwaway keys. **Waiting on the
   user's public key**; wired into release startup in phase 5.
4. ~~Release workflow: merge, sign, attach~~ — done
   (`packages/openp41ge/scripts/release-migrations.mjs`, plain Node: merges
   the version's sets from `migrations/` into one `migrations.json`, signs it
   with `MIGRATIONS_SIGNING_KEY`, writes `.sig`; no sets → no file; no key →
   the release fails). The release job runs it before uploading
   `release-assets/`. Public key in `migrations/public-key.ts`. The
   build-time list of required ids moves to phase 5, where it is used.
5. Release startup — done: `planStartupMigrations` decides none / run /
   offline / deferred before any data is read; release builds download and
   verify (`httpText` — checked live against the real releases API: one
   request, no sets yet); the migration window gained "Downloading the
   update…" and an offline state (Retry downloads again); the data version is
   recorded only after downloaded sets ran. Required ids:
   `required-migrations.ts` (a test keeps it equal to `migrations/`).
   The manager window's **Migrations** tab (read-only,
   `data-migrations:status`): the data version next to the app's, the last
   failure, and each set that ran (newest first) with its description, time
   and what it did; the journal now records each set's description.
6. ~~Built-ins~~ — done: both built-in migrations are gone. Their sets:
   `2026-10-09-chat-threads-per-workspace` (new operations `forEachEntry`
   with an owner from a JSON field, `removeJsonField`, `forEachWorkspace`
   `only: "oldest"`, and the dedicated `importLegacyChats`, which converts the
   old `chats.json`) and `2026-10-10-repositories-per-workspace`; both for
   release 0.1.0-alpha.11, both required. Their tests now run against the
   sets. Unlike the built-in chat migration, the set runs once: an install
   with old chats but no workspace keeps its `chats.json` unconverted.

## Completion Criteria

- [ ] A release's migrations run once, in order, before data is read, on an
      install that skipped versions.
- [ ] Unsigned / tampered sets and paths outside the data folder are refused.
- [ ] Failures stop, are recorded, and are shown; offline + required blocks.
- [ ] Typecheck + lint + knip + tests + build green; dev app verified.
