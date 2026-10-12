2026-10-12

# Storage names: "openp41ge" → "openp41ge code"

The app is "openp41ge code", but what it stores on the system still uses the
old plain name. Rename every storage location the app chooses, and move the
existing data on first start.

## Decisions (user)

- Hyphenated dotfolders, spaced names where macOS uses display names:
  - data: `~/.openp41ge` → `~/.openp41ge-code`, `~/.openp41ge-dev` → `~/.openp41ge-code-dev`
  - Chromium profile (Application Support): `openp41ge` → `openp41ge code`,
    `openp41ge-dev` → `openp41ge code development`
  - updater cache (Caches): `openp41ge-updater` → `openp41ge-code-updater`
    (electron-builder `extraMetadata.name: openp41ge-code`)
- Existing data moves on first start (no copy left behind).
- Bundle id `com.openp41ge.app` → `com.openp41ge.code`. Consequence: alpha.10
  cannot auto-update across it (Squirrel checks the identifier), so the next
  release is installed by hand; macOS permissions (Local Network) are asked
  again; macOS's own `com.openp41ge.app` folders stay behind.
- Delete nothing that is not certainly ours. "openp41ge explorer" folders are
  another app; leftovers stay.

## The move (`src/main/services/storage-rename.ts`)

Runs before anything reads the folders (`_initPaths`, `_initChromeFlags`).
Only when the new folder does not exist and the old one does. If the rename
fails the app uses the old folder for this run and tries again next start.
Skipped when `OPENP41GE_DIR` is set.

After the data folder moves, paths saved inside it are rewritten (prefix
`<old>/` or exactly `<old>`; `~/.openp41ge-dev` is not under `~/.openp41ge`):

- `workspaces/*.openp41ge-workspace` (`dataDir`; deleting a workspace removes it)
- `manager-grid.json` (workspace file paths)
- git worktree links in `workspaces-data/**`: `.git/worktrees/*/gitdir` and
  the worktree's `.git` file (`gitdir: …`)

Left as they are: logs, chat histories, `*.migrated` (history, not live paths).

## Steps

- [x] Tests first (code-tests): new names; move + rewrite with an in-memory fs
- [x] storage-rename.ts + wiring
- [x] electron-builder.yml: appId, extraMetadata.name
- [x] Comments/README naming `~/.openp41ge`
- [x] Gates, push (checked on clones of the real release and dev data:
      worktrees resolve, no old paths left in workspace files or manager grid)
- [ ] Release; check in the app that the data moved; then delete this plan.
      Release notes say "install by hand"
