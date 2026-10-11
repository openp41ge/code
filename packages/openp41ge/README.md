# openp41ge — desktop pane manager (Electron)

Openp41ge organises running processes, file editors, terminals, and other tools into a
column-based grid layout with tabs, drag-and-drop, and multi-window support.

## Git

The app runs the user's installed Git (2.17 or newer). At startup it finds a
usable one, checking `PATH` plus the usual install locations (Homebrew, Git for
Windows), and never runs macOS's `/usr/bin/git` stub without the developer
tools. It then puts that git first on the main process's `PATH`, so the
platform, agent tools and extension backends all run the same git. If none is
usable, the app does not open its windows: a **prerequisites window** lists
everything the app needs, each row ending in a green check (found) or red cross
(missing), with links to get what is missing and **Check again**. The app
starts once everything is met; closing the window quits. Add a prerequisite in
`src/main/services/prerequisites.ts`.

- **Override:** set `OPENP41GE_GIT` to the git binary to use.

## Logs & Debugging

The app has a **permanent, structured log bus** built in. Every feature emits through
`createLogger(system, name)` (from `openp41ge-core-logger`), where `system` is the owning
plugin id (or the platform) and `name` is the stream. A system is either **the platform**
(`openp41ge` — every logger inside the `openp41ge` package) or **a plugin** (a separate
package named `openp41ge-*`, e.g. `openp41ge-core-terminal`). Logs are organised by system,
not a flat list of stream names. Entries are captured in-memory, printed to the console,
and persisted to disk. The **Logs sidebar lists one row per system**; clicking a system
opens a **file-backed grid log tab** — a flat, datetime-ordered list that starts at the
bottom of the newest daily file and, as you scroll up, loads older lines from that file
and then previous days (backward paging).

### Log files

- **Location:** `~/.openp41ge/logs/` (a dev build run via `electron .` uses
  `~/.openp41ge-dev/logs/` instead, so it can run alongside the released app)
  - `openp41ge.log` — the live (current-day) file, safe to `tail -f`
  - `openp41ge-YYYY-MM-DD.log` — archived previous days (kept 14 days)
- **Override:** set `OPENP41GE_DIR` to relocate.
- **Format:** JSONL — one JSON object per line:
  `{ timestamp, level, source, message, data?, process, winId? }`
- **Levels:** `INFO`/`WARN`/`ERROR` are always captured and stored. `DEBUG` is captured
  (and stored) only while a **debug session** is enabled — see below.

### Debug session + system overlay

- The **system overlay** (title-bar workspace button, or **View › Workspaces…**,
  or **Cmd+Shift+D** for logs) covers the main area and has a **registerable top
  bar of system tabs** — each system can register a tab during startup via
  `systemOverlayService.registerTab(...)` from any package. The built-ins are
  **Workspaces** (list/create/edit workspaces + repos + worktrees) and **Logs**.
- **Cmd+Shift+D** opens the overlay on the Logs tab (or, if the overlay is
  already open elsewhere, switches to Logs; a second press closes it).
- The Logs tab has two sub-views:
  - **Logs** — queryable, virtualized list of captured app logs (search + level
    filter). Includes the **Debug** toggle: enables DEBUG capture/storage for the rest
    of the session (it does **not** control tab or panel presence).
  - **Events** — live structured debug events (source / label / data / timestamp) —
    where cross-window drag diagnostics surface.
- **`OPENP41GE_DEBUG=1`** (launch env) or **`localStorage["openp41ge-debug"]="1"`**
  seeds a debug session at startup: the overlay opens on the Logs tab and DEBUG is
  captured from the start. Otherwise enable it at runtime with the in-tab Debug toggle.
- The legacy settings modal is gone: the system overlay is the settings/config
  surface — each package registers a system tab for its configuration and internal
  data.

### Agent / runtime access

- **On disk:** `tail` / `read` the files under `~/.openp41ge/logs/` (dev build:
  `~/.openp41ge-dev/logs/`).
- **In DevTools:** `window.openp41ge.logs.query({ source?, minLevel?, search?, limit? })`
  returns persisted history; `window.openp41ge.logs.getPath()` returns the logs dir;
  `window.openp41ge.logs.listFiles()` lists files.
- **`window.__openp41ge_debug.logs`** additionally exposes `query()` (renderer bus) and
  `path()`.

Cross-window drag internals (`init-drag-system.ts`) emit structured debug events
(`cross-window-drag` source) covering mousemove, ghost updates, compute-drop-target,
IPC ghost events, and drops — captured only while the debug session is on.
