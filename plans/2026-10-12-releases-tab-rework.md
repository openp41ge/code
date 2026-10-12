2026-10-12

# Releases tab rework

The manager window's Releases tab becomes a list of rows; a row opens the
release in a grid tab. Release data comes from a background check in the main
process instead of a GitHub request every time the tab is shown.

## Decisions (from the user)

- **Rows, not cards.** Each release in the sidebar is a row (tag, channel
  badge, Installed chip, date). Clicking a row opens a grid tab for that
  release (preview; double click pins), like the Settings rows.
- **Two views, toggled from the bottom bar** (the "channels" icon):
  - **Releases** (default): every release in the range the `updateChannel`
    setting allows (e.g. `alpha` → alpha, beta, rc, stable), newest first.
  - **Channels** (toggle on): the latest release of each channel in that range
    (today's list).
- **Skeleton rows** while there is no data yet (first check, or a refresh with
  nothing cached).
- **Background check in the main process**, on a timer (6 hours) and at start
  when the cached list is older than that. It only fetches the release list
  (metadata: "does a release exist"), never a file. Cached on disk in the
  app-data folder. Pushed to windows when it changes.
- **Refresh button stays** in the bottom bar: checks now.

## Pieces

1. `electron/releases-feed.ts` — `ReleasesFeed`: load the disk cache, check
   when stale, check every 6h, `refresh()`, `snapshot()`
   (`{ releases, fetchedAt, checking, error }`), `onChange`.
   IPC: `releases:get`, `releases:refresh`, push `releases:changed`.
   Preload/global types: `window.openp41ge.releases`.
2. `releases-service.ts` — `selectInRange(updateChannel, releases)`.
3. `<openp41ge-releases-pane>` — rows, toggle, skeletons, refresh; a row click
   asks the manager to open the release tab. The history drawer goes (the
   Releases view replaces it); Download moves to the release tab.
4. `release` grid app type + `<openp41ge-release-view>` — header, notes (as
   text), View on GitHub, and Download / progress / Update for the build the
   updater can install. Clicking Download shows "Downloading…" at once (the
   updater may first re-check, and differential downloads may send no
   progress).

## Status

- [x] 1 feed + IPC
- [x] 2 selectInRange
- [x] 3 sidebar rows
- [x] 4 release grid tab
- [ ] Checked in the running app (then delete this plan)
