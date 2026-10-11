2026-10-11

# Extensions: what is left

Merges what remained of `2026-10-01-extension-system.md` and
`2026-10-02-renderer-extension-migration.md`, plus the leftovers of
`2026-10-07-package-naming-convention.md`. The model itself is built and
documented in AGENTS.md §2: extensions self-register (`registerProcesses` /
`registerRenderers`, SDK `api: "0.2"`), render in-process over the shared
toolkit, and the host / installer packages exist (`openp41ge-core-extension-host`,
`openp41ge-core-extension-installer`; no load order between extensions is
guaranteed). All four official
extensions (explorer, git, workspaces, agents) are renderer-driven and load
from `packages/` in dev.

## 0. Before the public release (decided 2026-10-11)

- [x] **Bundle the official extensions into release builds** (done
      2026-10-11): `scripts/bundle-extensions.ts` / `nx run
openp41ge:bundle-extensions` builds each as a self-contained extension
      dir; electron-builder packs them into the app's resources and the
      packaged app discovers them there (AGENTS.md §2.7). Checked with a local
      unsigned packaged build; the first CI release is the first signed one.
- [x] **Move Explorer Settings into the Explorer extension** (done 2026-10-11): a
      `registerConfigSchema` for `indentSize` / `prefetchDepth` and the
      generic config editor, replacing the platform's
      `openp41ge-explorer-settings` tab, its `explorer.*` platform config keys
      and the `explorerSettings` context injection (existing values migrate to
      the extension's config section).
- [ ] **Terminal**: handled later, before the public release (user, 2026-10-11).
      Today nothing opens a terminal; the platform keeps an unregistered
      renderer controller (knip-ignored), the main `TerminalManager` + IPC and
      the `openp41ge-core-terminal` emulator library.

Staying platform by design: the file editor (the default `openp41ge/file-path`
consumer), the log viewer / Logs window, the config editor, the manager's
tabs, the Extensions pane and workspace repo management.

## 1. Distribution: build, publish, install

Nothing has been published or installed from a real release yet. Official
extensions ship bundled (section 0); this section is for installing others.

- [ ] Build an extension into its installable asset: both entries (backend
      `main` + `renderer`) and the manifest (API version, renderer entry).
- [ ] Publish pipeline: a CI job that builds each official extension's asset,
      uploads it as a GitHub release asset, and updates the catalog
      `manifest.json` (`.github/workflows/` has only `release.yml` and
      `prerequisites.yml` today).
- [ ] Installer / catalog / GitHub-release source understand the dual-entry
      asset.
- [ ] Publish the catalog entries and release assets under the new
      `openp41ge-extension-*` ids (outside this repo).
- [ ] Validate end to end: a fresh app build installs a published asset and
      activates both entries.
- [ ] Local dev: install an extension from a folder / tarball (load both
      entries) without publishing.
- [ ] Dev HMR for a renderer entry: rebuild, reload the module, re-derive the
      surface catalog without double registrations.
- [ ] Move `renderer/services/releases-service.ts`'s direct `fetch()` calls
      into the main process.

Open decisions (defaults from the original plan, not yet confirmed): one repo
per official extension under the `openp41ge` org with its own releases; a
catalog `manifest.json` in the org (`id`, `version`, `asset`, `sha256`,
`releaseTag`); public repos only in v1 (a GitHub token later). Deferred:
`node_modules` and repo-installed sources.

## 2. Toolkit components for render functions

- [ ] Terminal, table, log view, form and diff as toolkit components a render
      function can include (the toolkit has `tree`). The terminal stays
      platform-owned but renders through a component.
- [ ] The old display-kind payload shapes become component props.
- [ ] Tests: each renders and reconciles from a render function.

## 3. Remove the legacy extension API — done

No extension uses it any more, so no compatibility layer is needed.

- [x] Remove `activate` / `deactivate`, `registerMainHandler`,
      `registerComponent`, `ContributionKind` / `CONTRIBUTION_KINDS` from the
      SDK (`context.ts`), the `0.1` path from the host (`host.ts`; an extension
      built for another API version is now refused with a clear error), and
      the platform's contribution renderers and their controllers.
- [x] Remove the `openp41ge-extension-api` import-map alias
      (`vite.extension-runtime.ts`), and the alias mechanism with it. No
      extension was ever built or installed against the old name (nothing has
      been published), so no release note is needed either.

## Done when

- [ ] A published official extension installs into a fresh build and works.
- [x] The SDK exposes only the renderer-driven surface.
- [ ] Typecheck, lint, knip, tests, build green.
