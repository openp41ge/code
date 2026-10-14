2026-10-14

# One window: one kind of window hosts everything

The app opens three kinds of window: workspace, management and logs
(`Openp41geWindowType` in `electron/window-manager.ts`). Each has its own top
bar, its own sidebar and its own grid model. Goal: one kind of window — the
workspace window — that hosts every sidebar tab and every grid tab.

## Decisions (from the user, 2026-10-14)

- **One window kind.** The workspace window's top bar, both sidebars and its
  grid. The management and logs windows go away.
- **A window has at most one workspace.** Opening a workspace in a window
  **replaces** the one it has.
- **Choosing a workspace moves to the top bar.** The workspace name on the
  right of the top bar (`openp41ge-workspace-label`, plain text today)
  becomes a button that opens an overlay to pick a workspace. The management
  tabs stay (Workspaces still lists and edits workspaces).
- **Sidebar tabs open on either side.** The management and logs sidebar tabs
  were on a fixed side because those windows had one sidebar; now the user
  picks the side, like any sidebar tab.
- **Each workspace remembers its own layout**, including the tabs that do not
  need a workspace (settings, releases, logs, …). They are saved in the
  workspace file with the rest.
- **No workspace open:** workspace-free tabs can still be opened. Their layout
  lives in memory only and is dropped when a workspace is opened.
- **Dragging between windows.** Same workspace: any sidebar or grid tab, as
  now. Different workspaces: only workspace-free grid tabs (sidebar tabs are
  in every window already).
- The release app and a dev build are separate apps, so each still has its
  own window.

## What exists

- Sidebar tabs are system tab types (`SystemTabRegistration`,
  `registerSystemTabType`); only extensions register them today
  (`extension-renderer-loader.ts`). Their set and side are per workspace
  (`Workspace.sidebar`, `Workspace.systemTabs`).
- The management grid (`openp41ge-manager-grid.ts`) opens app types through
  the same registry as the workspace grid (config editor, release, the
  workspaces extension's workspace editor). Its layout is
  `<app-data>/manager-grid.json`.
- The management sidebar content: Workspaces is inline in
  `openp41ge-window-manager.ts` (~2900 lines); Settings, Releases, Cleanup and
  Migrations are their own elements.
- The logs window (`openp41ge-logs-window.ts`) has its own grid and drag
  orchestrator; log streams already have a payload kind
  (`openp41ge/log-stream`) and a `log-viewer` app type.
- The main process keeps one state per workspace path (`WorkspaceRegistry`)
  plus an unbound default for windows with no workspace.

## Steps

Each step ships on its own; the old windows keep working until step 5.

1. **Done (2026-10-14).** **Management sidebar tabs in the workspace window.** Register Workspaces,
   Settings, Releases, Cleanup and Migrations as platform system tab types;
   extract the Workspaces list out of `openp41ge-window-manager.ts` into its
   own element shared by both windows. Their grid tabs (config editor,
   release, workspace editor) open in the workspace grid.
   As built: `apps/management` registers the tabs; the Workspaces list is
   `<openp41ge-workspaces-list>`; its and the Settings rows drag as the
   platform's `workspace-config` / `config-overrides` payloads (platform drag
   sources), and the workspaces extension consumes `workspace-config` (its
   editor falls back to `workspacesDir` and titles tabs by `name`).
2. **Done (2026-10-14).** **Logs in the workspace window.** Log Streams and
   Log Search sidebar tabs; a stream is a `log-viewer` grid tab (one per
   stream: `log:<system>`), with the row detail drawer
   (`<openp41ge-log-detail-drawer>`, shared with the logs window). "Open logs"
   from a workspace window (Logs menu, error toasts, `host.openLog`, the debug
   seed) comes back to it (`electron/logs-routing.ts`,
   `logs:open-in-window`) and opens the platform log, or reveals the error in
   its stream's tab. Settings-editor and release tabs now open once per cell
   too. The logs window keeps its own Streams/Search panes until step 5.
3. **Done (2026-10-14).** **Workspace-free tabs.** Every tab type says
   whether it needs a workspace: `workspace: "required" | "none"` (default
   "required") on `GridSurfaceSpec` / `SidebarSurfaceSpec` in `openp41ge-sdk`
   and on the platform's registrations. The management and log tabs, settings
   editors, releases, log streams and the workspace editor need none. A
   window with no workspace (Window > New Window, ⌘⇧N) uses the default
   dispatcher's in-memory state, which goes to such windows only
   (`electron/window-binding.ts`) and loses a window when it closes; its
   sidebar + menus offer, and its grid opens, only "none" tab types.
4. **Done (2026-10-14).** **Top-bar workspace picker; replacing a window's
   workspace.** The title bar's workspace name is a button opening a picker
   (filter, the current one marked, "No workspace"); with unsaved files in
   the window it asks first. `window:switch-workspace` (main) plans the
   switch (`electron/workspace-switch.ts`): the old state drops the window,
   or keeps its layout when it was that workspace's last window; the window
   becomes a closed workspace's first saved window, else a fresh one; then it
   takes the new id and reloads (`rebindWindow`). Found on the way: the main
   process's console.error forwarding recursed forever when a window's page
   went away mid-send (100% CPU); fixed (`console-error-forwarder.ts`).
5. **Cross-workspace drags; remove the old windows.** A workspace-free grid
   tab dropped on a window of another workspace moves between the two
   dispatchers. Then drop the `manager` and `logs` window types, the Window
   menu items that open them, `manager-grid.json`, and update AGENTS.md.
   With one kind left, it is no longer a "workspace window": drop
   `Openp41geWindowType` / `windowType` (not persisted, so no migration) and
   the branching on it, and call it "the window" in code, comments and docs
   (`openp41ge-windowview` is already neutral). Until then, "workspace
   window" in this plan means today's workspace window.

Every step: regression/behaviour tests in code-tests first (§5.6), verified in
the running dev app.

## Open questions

- **Saved management layout** (`manager-grid.json`): carry it into the
  first workspace opened after the update, or drop it.
