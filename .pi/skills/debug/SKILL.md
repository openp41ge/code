---
name: debug
description: Debug issues in the running Openp41ge desktop app. Covers dev mode startup, project selection, navigation, Chrome DevTools inspection, and the global error overlay.
---

# Debug — Openp41ge Debugging Guide

Use this skill when investigating bugs, unexpected behaviour, crashes, or visual issues in the Openp41ge desktop app. It explains how to start the app in dev mode, navigate to the relevant view, inspect state via Chrome DevTools, and interpret the global error overlay.

## 1. Start the App in Dev Mode

From the monorepo root (`/Users/rk/Repository/openp41ge/master`), run:

```bash
cd packages/openp41ge
pnpm dev
```

This runs `scripts/dev.sh`, which:

1. Builds `openp41ge-file-editor` (generates `.d.ts`)
2. Compiles Electron main process TypeScript (`build-electron.sh`)
3. Starts the Vite dev server on `http://localhost:8642`
4. Launches Electron pointing at the Vite dev server (hot-reload)

**With DevTools auto-open:**

```bash
OPENP41GE_DEVTOOLS=1 pnpm dev:tools
# or
cd packages/openp41ge && OPENP41GE_DEVTOOLS=1 bash scripts/dev.sh
```

To open DevTools after the app has started, press the shortcut or run:

```js
// In DevTools console or via chrome_devtools_evaluate:
window.openp41ge.window.openDevTools();
```

The main process TypeScript does **not** hot-reload — restart `pnpm dev` after changing `electron/*.ts`.

**Renderer-only (hot-reloads, no Electron):**

```bash
cd packages/openp41ge && bash scripts/dev-renderer.sh
# Then open http://localhost:8642 in a browser
```

> **Dev port** — openp41ge deliberately uses an uncommon port (`8642`, not
> Vite's `5173` or other agents' usual ports) so stray dev servers never end
> up rendered in the Electron window. If it ever needs changing, update ALL
> of these together: `packages/openp41ge/vite.config.ts` (`server.port`),
> `packages/openp41ge/scripts/wait-for-vite.mjs`,
> `packages/openp41ge/electron/window-manager.ts` (`win.loadURL`), and this
> skill.

### Chrome DevTools Remote Debugging

When the app is running with `pnpm dev`, you can use the `chrome_devtools_*` tools to inspect the renderer process directly:

1. **List pages**: `chrome_devtools_list_pages` — discover available renderer pages.
2. **Select page**: `chrome_devtools_select_page` — choose the Openp41ge window.
3. **Evaluate JS**: `chrome_devtools_evaluate` — run JavaScript in the renderer context.
4. **Screenshot**: `chrome_devtools_screenshot` — capture the current visual state.

This allows inspecting component state, workspace state, and reproducing issues programmatically without touching the GUI.

## 2. Project Selection

On startup, if no `--project` CLI argument was passed, the **project picker** modal appears:

```
<openp41ge-project-picker>
```

- Shows a list of existing projects
- Type to filter / create a new project
- Arrow keys + Enter to select
- Escape dismisses (app loads an empty workspace)
- Clicking a project dispatches `project:selected` → `window.openp41ge.project.switchTo(name)`

**Inspect project state:**

```js
window.openp41ge.project.current();
// → Promise<string | null>
```

**List projects:**

```js
window.openp41ge.project.list();
// → Promise<string[]>
```

**Switch projects programmatically:**

```js
window.openp41ge.project.switchTo("project-name");
// → Promise<{ success: boolean, error?: string }>
```

The bootstrap step `CheckProjectStep` (`src/renderer/bootstrap/steps/check-project.step.ts`) handles this flow.

## 3. Navigating to Views

### Grid Layout (main area)

After selecting a project, the main grid renders. The workspace state drives the entire UI:

```js
// Full workspace state (JSON string → parse)
const stateJson = await window.openp41ge.workspace.getState();
const ws = JSON.parse(stateJson);
// ws.windows[0].openp41ges[0].grid.placements — all pane placements
```

### Explorer / Worktree Sidebar

Toggle the explorer sidebar with:

- **Keyboard**: `Cmd+B`
- **Activity bar**: Click the file icon button in the right-edge activity bar (`<openp41ge-activity-bar>`)
- **Programmatically**:
  ```js
  // Dispatch the command via the command bus
  const myWindowId = window.openp41ge.workspace.getWindowId();
  // This is what Cmd+B does:
  // context.commandBus.dispatch("toggleSidebarViewOp", myWindowId, "explorer")
  ```

The sidebar (`<openp41ge-sidebar>`) renders `ExplorerSidebarView`, which wraps `<openp41ge-worktree-tree>`. The worktree tree shows repositories and their worktrees/branches from the workspace scope.

**Inspect sidebar state:**

```js
const sidebar = document.querySelector("openp41ge-sidebar");
sidebar?.activeViewId; // → "explorer" | null
sidebar?.width; // → number (current width in px)
```

**Inspect worktree tree state:**

```js
const tree = document.querySelector("openp41ge-worktree-tree");
tree?._repoService; // → RepoService instance
// The tree exposes _loadRepos(), _repos, expanded state, etc.
```

### Opening Files

- **Pane picker**: Press `Cmd+P` to open the pane picker overlay (`<openp41ge-pane-picker>`). This shows available file types (file editor, terminal, git repository, agent chat).
- **File tree**: In the explorer sidebar, click files to open them in file-editor panes.
- **Git repository view**: In the worktree tree, clicking a branch or commit opens git-repository panes.

### Tabs and Panes

Each openp41ge (tab) has a grid of columns. Panes are placed in grid cells. Tab bar (`<openp41ge-cell-tabbar>`) at the bottom shows tab names.

```js
// Current window info
const winId = window.openp41ge.workspace.getWindowId();
const stateJson = await window.openp41ge.workspace.getState();
const ws = JSON.parse(stateJson);
const myWin = ws.windows.find((w) => w.id === winId);
myWin.activeOpenp41geId; // → current active openp41ge ID
myWin.openp41ges; // → array of { id, name, grid }
```

### Creating New Panes / Tabs

| Action            | How                                                                  |
| ----------------- | -------------------------------------------------------------------- |
| New pane (column) | `Cmd+P` (pane picker) or `window.openp41ge.workspace.cmdNewColumn()` |
| New tab           | `window.openp41ge.workspace.cmdNewTab()`                             |
| New window        | `Cmd+N` or `window.openp41ge.workspace.cmdNewWindow()`               |
| Close tab         | `Cmd+W` or `window.openp41ge.workspace.cmdCloseTab()`                |
| Clone repository  | `Cmd+Shift+O`                                                        |

### Settings

There is **no visible settings UI yet**. The `openp41ge:toggle-settings` event is listened for but the handler is not implemented. Settings can be managed programmatically:

```js
// Get a config value
window.openp41ge.config.get("theme");
// → Promise<any>

// Set a config value
window.openp41ge.config.set("theme", "dark");
// → Promise<void>

// Get all config
window.openp41ge.config.getAll();
// → Promise<Record<string, any>>
```

Syntax theme options (for file editor): `openp41ge-dark`, `openp41ge-light`, `monokai`, `github-dark`, `github-light`.

## 4. Global Error System

Openp41ge has a **full-screen blocking error overlay** (`error-capture-service.ts`) that captures runtime errors from both the renderer and main processes.

### How it works

The `installErrorCapture()` function (called at the very top of the bootstrap pipeline) installs four error handlers:

| Source                        | What's captured                                 |
| ----------------------------- | ----------------------------------------------- |
| `window.onerror`              | Uncaught exceptions                             |
| `window.onunhandledrejection` | Unhandled Promise rejections                    |
| `console.error`               | All `console.error()` calls                     |
| IPC channel `openp41ge:error` | Errors forwarded from the Electron main process |

When any error is caught, a **full-screen red overlay** appears covering the entire window:

```
┌──────────────────────────────────────────┐
│  ⚠                                      │
│  1 Error Detected                        │
│  The application is paused until all     │
│  errors are resolved.                    │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Error message text                 │  │
│  │ source — stack available           │  │
│  │ stack trace (first 1000 chars)     │  │
│  └────────────────────────────────────┘  │
└──────────────────────────────────────────┘
```

Key properties:

- **Blocking** — all pointer events are consumed by the overlay, nothing underneath is clickable
- **Non-dismissible** — no close button. The overlay only disappears when errors are cleared
- **Z-index**: `2147483647` (maximum, above everything)
- **Persistent**: The last 20 errors survive page reload via `sessionStorage`
- **Max errors**: 100 errors are kept in memory

### Clearing the error overlay

```js
// Call in DevTools console after fixing the root cause:
// (access via the service module — exposed globally in dev mode)
// The service clears automatically on successful project switch.
// Programmatically, there's no global escape hatch yet.
// Fix the underlying error and reload.
```

The `clearCapturedErrors()` function is called automatically after a successful project switch to dismiss stale errors from a previous session or hot reload.

### Inspecting errors programmatically

```js
// Errors are stored in-memory in the error-capture-service module.
// sessionStorage.getItem("openp41ge:captured-errors") — has last 20 errors
// During development, check the console for the original console.error output
// (the service chains to the original console.error after capturing).
```

### Main Process Errors

Main process errors are forwarded to the renderer via the `openp41ge:error` IPC channel. The renderer's `lifecycle.onError` callback receives them and logs them to the error overlay:

```js
window.openp41ge.lifecycle.onError((data) => {
  // data: { message, source, stack }
});
```

## 5. Common Debug Workflows

### "The app shows a red error overlay"

1. The global error system has caught a runtime error
2. Read the error message on the overlay
3. Check `sessionStorage.getItem("openp41ge:captured-errors")` for stored errors
4. Open DevTools (`OPENP41GE_DEVTOOLS=1` and restart, or use `chrome_devtools_evaluate`)
5. Fix the root cause — the overlay clears when errors are resolved and the app reloads

### "The explorer sidebar doesn't show any repos"

1. Open DevTools console
2. Run `window.openp41ge.project.current()` to confirm a project is selected
3. Run `await window.openp41ge.workspaceController.listRepos()` to see if repos exist
4. Check the worktree tree element:
   ```js
   const tree = document.querySelector("openp41ge-worktree-tree");
   console.log(tree._repoService); // What service is injected?
   console.log(tree._repos); // What repos are loaded?
   ```
5. Run `tree._loadRepos()` to manually trigger the data load
6. Check if the sidebar is open: `document.querySelector("openp41ge-sidebar")?.activeViewId`

### "A pane shows a blank or broken view"

1. Check the error overlay (see above) — the error may have been caught
2. Open DevTools console and look for red `console.error` output
3. Inspect the pane element:
   ```js
   // Find the grid and look at placements
   const stateJson = await window.openp41ge.workspace.getState();
   const ws = JSON.parse(stateJson);
   const winId = window.openp41ge.workspace.getWindowId();
   const win = ws.windows.find((w) => w.id === winId);
   console.log(win.openp41ges.map((s) => s.grid.placements));
   ```
4. Check if the app type is registered:
   ```js
   // The app-registry holds controller factories
   // Check the window's rendered panes
   document.querySelectorAll("openp41ge-pane").forEach((p) => console.log(p.id));
   ```

### "The layout is wrong / columns are missing"

1. Dump the full workspace state:
   ```js
   const ws = JSON.parse(await window.openp41ge.workspace.getState());
   console.log(JSON.stringify(ws.windows[0], null, 2));
   ```
2. This shows all windows, openp41ges (tabs), grids, and placements
3. Dispatch a layout operation to adjust:
   ```js
   // Example: add a column to the current openp41ge
   window.openp41ge.workspace.dispatch("addColumn", winId, openp41geId);
   ```

### "Something broke after a drag-and-drop"

1. Check module-level drag state in `openp41ge-grid.ts`:
   ```js
   const grid = document.querySelector("openp41ge-grid");
   // Inspect drag-related properties
   ```
2. The drag system uses module-level variables (`_activePaneId`, `_activeTabId`, etc.)
3. These persist across DOM re-creation when switching tabs
4. If drag state is stale, it may cause unexpected behaviour

## 6. Bootstrap Pipeline Reference

The renderer starts via a pipeline of steps in `src/renderer/app.ts`:

```
1. ExposeTestModelsStep        — Expose test models for test injection
2. RegisterAppTypesStep        — Register app type controller factories
3. InitServicesStep            — Wire cross-service dependencies
4. SubscribeStateUpdatesStep   — Register render subscriber BEFORE any async step
5. CheckProjectStep            — Check for active project; show picker if needed
6. RegisterEventListenersStep  — Document-level event listeners
7. FetchInitialStateStep       — *** Async: fetch + render ***
8. LoadConfigStep              — Async: load config (cosmetic)
9. RegisterShortcutsStep       — Keyboard shortcuts
10. RegisterIpcListenersStep   — Zoom + confirm IPC listeners
11. StartQuoteControllerStep   — Quote rotation
12. SignalReadyStep            — Signal readiness to main process
```

If the app fails before step 7, the UI may not have rendered at all — the error overlay should still appear because `installErrorCapture()` is called before the pipeline starts.
