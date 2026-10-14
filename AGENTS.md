# Openp41ge — Design Plan

Status: live design document
Updated: 2026-10-11

This document is the **design plan for the entire repository**. It describes what
the system is, how it is structured, and where it is heading. It doubles as the
working guide for agents and contributors: what the architecture is, how to work
in it, and how to keep it honest.

It is intentionally **general-purpose** (not a catalogue of every package or
inventory count) so it does not go stale as packages are added, renamed, or
folded. Where a specific path or command is given, treat it as a starting point
and confirm against the code — the map is not the territory.

---

## 1. Overview

Openp41ge is a desktop **pane manager** (Electron). It organises tool windows —
file editors, terminals, AI chats, logs, git tools and more — into a
**column-based grid layout** with tabs, drag-and-drop, and multi-window support.

The core idea, and the design the whole repo is moving toward, is:

> **The app is a thin platform. Every system that does user-facing work is an
> extension.** The platform hosts; it does not ship system work.

A user-facing "system" means an agent chat, a terminal, a docker manager, a file
explorer — any tool that occupies a grid cell or a sidebar tab. The long-term
intention is that users can bring **their own** systems: use the official
extensions, or replace them with their own. It is the user's choice. There is
**no marketplace** and no sandboxing of extension code; a user decides whether
to trust code from the internet or to write it themselves.

---

## 2. The extension platform (locked design)

### 2.1 Platform vs. extension boundary

Two actors, with a hard boundary:

- **The platform** owns everything that must stay stable and shared:
  window/tab chrome, the grid, the **drag & drop** pipeline, IPC/config/file
  services, the event bus, the **shared UI toolkit**, and the finite set of
  **surfaces** an extension can render into (a grid cell, a sidebar tab).
- **The extension** owns the **content** of its surfaces and its **behaviour**:
  its DOM, its state, its interactions, and any background logic in the main
  process.

This boundary is what makes extensions genuinely swappable — the user replaces
the official explorer with their own and the platform does not care.

### 2.2 Each extension has two sides

An extension is a bundle with **two entry points**, one per process, and each
side **self-registers** (there are no assumed function names — the module
declares its capabilities at load time):

- **Backend (main process).** The extension calls a registration function such
  as `registerProcesses(...)` to declare its command handlers and long-running
  background work. This is the "brain" — it owns the logic, and it is where IPC
  stays cheap.
- **View (renderer process).** The extension calls a registration function such
  as `registerRenderers(...)` to declare one render function **per surface** it
  wants to appear in (a grid cell, a sidebar tab, and so on). This is the
  extension's own UI.

The register functions are **importable** by the extension, which is how an
extension renders itself: it loads a module, the module registers, and the
platform discovers the extension's full surface.

### 2.3 The view model: UI as a function of state

This is the heart of the design. **An extension's UI is a pure function of
state**, rendered **in-process** (not in an iframe or a webview), built from the
**shared UI toolkit** the platform owns:

```ts
registerRenderers({
  "grid:my-tool": (host) =>
    ui.column({
      children: [
        ui.button({
          text: "Run",
          onPress: () => host.dispatch("my-tool/run", { id: host.state.id }),
        }),
        ui.statusPill({ status: host.state.status }),
      ],
    }),
});
```

- A **render function** receives the surface's host context and returns a
  **declarative element tree** (a description built from the shared toolkit's
  components).
- The **platform mounts** it and **reconciles** diffs when state changes — the
  extension never touches the DOM directly.
- The **host context** provides `state`, `setState` (re-render + reconcile),
  `dispatch(command, payload)` to the extension's backend, `subscribe(topic, fn)`
  for platform events, and a scoped `log`.
- Events come back as props (`onPress`, `onChange`, `onKeydown`, `onDrop`). If an
  interaction needs "brain" logic it dispatches to a backend handler.

Because everything is a function of state, there is **one** rendering model.
"Standard widget" and "bespoke UI" are not separate systems — they are just
different component calls the function returns. Host-owned conveniences (a
terminal, table, log view, tree, form) are simply **host-provided components**
that any render function can include, reached through the same call surface.

### 2.4 Surfaces are platform-owned; content is extension-owned

The platform owns a **finite set of surfaces** (grid cell, sidebar tab, and any
others the platform adds) and the **mount/update/dispose lifecycle** that
surrounds them. The extension registers render functions _into_ those surfaces
and owns everything that renders inside.

A surface declares whether it needs a workspace open in its window
(`workspace: "required" | "none"`, default `"required"`). A window with no
workspace offers and opens only `"none"` surfaces; the platform's own tab
types declare it the same way.

Multiple grid cells are just multiple mounts of the same render function — each
gets its own host context (its own state and subscriptions).

### 2.5 The contract between the two sides

The backend and the view run in **different processes** and meet only over a
**typed dispatch bus**. The shared vocabulary — command ids, payload shapes,
surface names, event topics — lives in the **API contract package** (`openp41ge-sdk`) that both
the platform and extensions depend on. That is the glue that makes "register in
the main process" and "render in the renderer" one coherent extension.

### 2.6 Lifecycle

The platform owns the lifecycles around the registrations:

- **Load** the extension's view module into the renderer when a surface opens.
- **Mount** it into the surface container and call the render function with an
  initial host context.
- **Update** — on `setState`, re-invoke the render function and reconcile.
- **Dispose** — on surface close / extension deactivate, unmount and run
  cleanups.
- **Reload / dev HMR** — clear the previous module's registrations so nothing
  double-registers, and re-derive the catalog of surfaces.

The extension author never writes any of this. Their entire job is: **the render
function + the state transitions + the backend handlers.**

### 2.7 Distribution and trust

- **Distribution** is a prebuilt, self-contained asset (e.g. a tarball built by
  the extension's CI) acquired by the platform, verified, and installed into a
  single install root.
- **The official extensions ship with the app**: one download includes them.
  A release build packs each as a self-contained extension dir
  (`scripts/bundle-extensions.ts`, `nx run openp41ge:bundle-extensions`) into
  the app's resources, and the packaged app discovers them there after the
  install root and the workspace's `extensions/`, so an installed copy with
  the same id wins. They are ordinary extensions loaded at runtime, not
  platform code. In dev they load from `packages/`.
- **Sources** are pluggable: official GitHub releases in v1; arbitrary repos,
  folders, and `node_modules` later against the same contract. Local/dev
  extensions live next to the workspace.
- **Trust** is explicit and user-owned. No marketplace, no auto-approval for
  third-party code, no sandbox. An extension's **manifest** declares its
  identity and purpose; installing a non-official extension is an explicit,
  informed decision by the user.

### 2.8 Transition from the earlier model (done)

An earlier version ran extensions entirely in the main process through an
`activate(context)` entry, with **host-owned rendering**: extensions sent
component payloads and the platform rendered them with a closed set of
display kinds. That model is **gone**:

- Every extension self-registers with `registerProcesses(...)` (backend) and
  `registerRenderers(...)` (view) and renders its own UI over the shared
  toolkit; the manifest's `openp41ge.api` is `0.2`.
- The host loads only that API version. An extension built for the old
  `activate(context)` surface is not loaded and reports why.
- Host-provided conveniences (terminal, table, log view, form, diff) are meant
  to become toolkit **components** a render function includes, not a separate
  rendering system; see `plans/` for what is left.

### 2.9 How extensions provide functionality

> **Status: implemented.** Drag & drop (`registerDragDecls`, `host.drag`,
> platform tab consumers, cross-window payload drops) is in `openp41ge-sdk`
> and the platform's renderer drag service; the explorer's file rows use it.
> Configuration (`registerConfigSchema`, `host.config`, `ctx.config`) is in
> `openp41ge-sdk` (`config.ts`) and the platform's `ExtensionConfigService`.
> Check `openp41ge-sdk` before assuming an API exists.

Beyond the two sides above (backend `registerProcesses`, view
`registerRenderers`), an extension declares **runtime capabilities** by
self-registering them at module load under the extension scope. Every
registration is validated by the platform against a schema; a non-conforming
registration **throws** and surfaces a clear load error. Extensions never
reference one another by ID — cross-extension compatibility is **by data kind**. The
platform (and user config) decides which component handles a given data kind.

#### Drag & drop: sources, tab consumers, drop targets

The platform owns the entire drag/drop pipeline (gesture, threshold, long-press,
bitmap ghost, cross-window). Extensions declare three kinds of things:

- **Drag sources** — "I emit payloads of kind X". The extension tags elements
  in its rendered template with `data-drag-source-id`; the platform resolves
  the tagged element at gesture start (one delegated listener per mount, so
  elements added by re-renders are covered) and removes it on dispose. A source declares the
  window contexts it may land in and whether it is cross-window.
- **Tab consumers** — "I can _open_ kind X as a tab". Each declares the kind(s)
  it consumes, the placements it can open into (grid cell and/or sidebar tab),
  and how the platform opens it (an extension surface or a platform app). When a
  payload is dropped onto a grid, the **platform resolves the kind to a
  consumer** — **first registered wins**, with an optional
  user-config override — and opens the tab, **injecting the validated payload's
  fields (not its `kind`) as the tab's data** (its params, saved with it). Platform consumers register first, so they are the
  default; to bring their own file viewer or chat pane, a user installs an
  extension that registers a consumer for the kind **and** selects it in the
  user-config override. Installing an extension never silently takes over a kind.
  **No load order between extensions is guaranteed**, so when several
  extensions consume a kind no platform consumer handles, which one wins is
  unspecified until the user picks one in the override.
- **Drop targets** — running surfaces that accept a payload dropped _in place_
  (no tab opened). Dropping the payload onto the surface's `data-drop-target-id`
  element makes the platform validate it and **relay it to the receiver
  registered by that specific mount** (`host.drag.registerDropTarget`), so
  multiple open instances of a surface each receive only their own drops. The
  receiver is a renderer callback; if the drop needs backend work it forwards
  via `host.dispatch`. Extension→extension delivery always passes through the
  platform — extensions never talk to each other directly.

For any one kind, a surface is **either** a consumer **or** a drop target —
never both (it may open for one kind and receive another). The platform
enforces this at registration and throws on a conflict. A drop the surface does
not handle **falls through to the enclosing grid**, which opens it as a new tab
via the consumer.

Every payload kind is **namespaced**, `namespace/kind`, so kinds never
collide:

- **Platform kinds** — data the platform itself owns (`openp41ge/file-path`,
  `openp41ge/log-stream`, …) — are a **closed set** defined in the API
  contract package (`drag.ts`); that file, not this document, is the list.
  Adding one is a contract addition.
- **Extension kinds**: an extension declares its own kinds with
  `registerDragDecls({ kinds })`, each with a JSON Schema of string fields
  (payload fields are read from element attributes). A kind's full name is
  `<extensionId>/<id>`; an extension can only declare kinds under its own id.
  The official extensions' chats and git repositories / commits are such
  kinds (`openp41ge-extension-agents/chat-thread`,
  `openp41ge-extension-git/commit`, …).

The platform's own sidebar panes (the Workspaces and Settings rows) tag
sources the same way, registered under the `openp41ge` namespace
(`extensionDrag.registerPlatformSources`).

A source emits a platform kind or one its own extension declares. Every
payload is validated against its kind's schema; an unknown kind is refused.
Matching is **kind-driven**: a consumer/target lists the kinds it accepts —
platform kinds or any extension's — and any source producing an accepted kind
may drop there. There is no source-side destination list.

The user-config override is `dragConsumers` in `config.json`: payload kind →
consumer id (`<extensionId>/<consumerId>`, or a bare platform id such as
`file-viewer`), edited from the Settings sidebar tab. It applies immediately.

#### Settings / configuration overrides

An extension does **not** provide a settings component. It registers one
**config schema** (`registerConfigSchema`, a JSON Schema whose `default`s are
the defaults; from its renderer or backend entry) and reads the **merged
config from the platform at runtime** — `host.config.get()` / `subscribe()` in
the view, `ctx.config.get()` in the backend. The platform owns storage and
merge: the user's values live in `config.json` under
`extensions.<extensionId>` (only what the user wrote), and are validated
against the schema on save. The extension never manages its own settings file.

The platform's JSON config editor is the `config-editor` grid tab
(`{ extensionId }`), opened by `host.config.openEditor()`. It is also the
platform's consumer for a dropped `config-overrides` payload (`settingsId` is
the extension id), registered through the _same_ registration system
extensions use.

#### Surface host additions

This design adds `host.drag.*` (drop-target receivers) and `host.config.*`
(merged config read/subscribe, open the config editor) to the host context
described in §2.3. Errors are linkable: every ERROR log entry gets a unique,
persisted `errorId`, which `log.error(...)` returns (view and backend), and
`host.openLog(errorId)` opens that entry's stream in a Logs tab with its
details open. Show a failure as a generic message linking to its log entry rather
than putting the error text in the UI. The authoritative shape is `SurfaceHost` in the contract
package (`registration.ts`), which also carries `surface`, `context`,
`openTab`, `workspace` and `showContextMenu`.

---

## 3. Repository architecture (general)

- **The platform** — the Electron app. Owns the layout data model, the renderer
  web components, the controller system, the Electron main process, and IPC
  handlers. It is the extension host.
- **Core libraries** — self-contained capabilities the platform builds on: the
  file-editor engine and its text buffer, the terminal emulator, logging,
  syntax highlighting, git integration, shared constants, the **tab +
  drag-and-drop engine**, and
  the extension **host** (discovers/loads/lifecycles extensions) and
  **installer** (acquires/verifies/installs them).
- **The SDK** — the public API extensions build against: the extension API
  **contract** (`openp41ge-sdk`: types, manifest schema, registration
  signatures; the platform builds against it too) and the public libraries
  (`openp41ge-sdk-*`), notably the **shared UI toolkit**.
- **Official extensions** — systems shipped as extensions, built against the
  SDK exactly like a third-party extension would be (e.g. the explorer, git,
  workspaces and agents).
- **Tests and demo apps** live in the private `openp41ge/code-tests` repo, not
  here (§5.6): the tests, their configs and helpers, and the small
  per-capability demo harnesses used for isolated development and visual
  testing.

#### Package naming

The package name says which side of the platform/extension boundary it is on.
There are no subfolders; `packages/` is flat.

| Prefix                  | What                                   | Example                        |
| ----------------------- | -------------------------------------- | ------------------------------ |
| `openp41ge`             | The platform (the Electron app)        | `packages/openp41ge`           |
| `openp41ge-core-*`      | Internal libraries; may change freely  | `openp41ge-core-tabs`          |
| `openp41ge-sdk`         | The extension API contract (public)    | `openp41ge-sdk`                |
| `openp41ge-sdk-*`       | Public libraries for extensions        | `openp41ge-sdk-uikit`          |
| `openp41ge-extension-*` | Extensions; package name = manifest id | `openp41ge-extension-explorer` |

- **The platform, the SDK and core libraries never import an
  `openp41ge-extension-*` package.** Extensions are discovered and loaded at runtime, never bundled
  into the platform. A test (in code-tests) enforces this.
- An extension's package name **is** its manifest `id` (and so the
  `ext:<id>:<surface>` app type). Renaming one is a migration of saved state,
  not just a rename.
- Library code that only an extension needs lives in that extension, not in a
  core library.
- **`openp41ge-sdk*` is public API; `openp41ge-core-*` is not.** Extensions
  import the SDK packages (and `lit`) as bare specifiers; the platform's import
  map routes them to its own instance (`vite.extension-runtime.ts` lists the
  shared specifiers). A breaking change to an SDK package is a breaking
  extension change. Core libraries are never shared with extensions; code an
  extension needs from one moves into an SDK package.

Other packages communicate with the platform exclusively through a small set of
mechanisms: DOM custom events, IPC over the preload bridge, the shared workspace
state (via command dispatch), and registered component/controller interfaces.
**Core libraries and extensions never import from the platform directly** — they are
consumed as dependencies and bundled at build time.

---

## 4. Key architectural systems

### 4.1 Layout data model

The layout is a tree of **Workspace → Window → Grid → Placements**.

- **Single-row, column-based** grid (`rows = 1`): panes are placed in columns,
  no nested containers.
- **Pure functions**: every tree operation is immutable — `(tree, args) =>
newTree`. Operations live in the layout module.
- **Centralized state**: workspace state is the single source of truth and is
  updated by dispatching commands.

**Windows.** There is one kind of window: a top bar, two sidebars and the
grid. A window shows **at most one workspace**; the title bar's workspace
picker replaces it (the window reloads as a window of the chosen workspace).
Each workspace's state is kept by its own dispatcher in the main process and
saved to its `.openp41ge-workspace` file, shared by every window showing it;
windows with no workspace share an in-memory state that is never saved. A tab
type declares whether it needs a workspace (§2.4): a window with none offers
and opens only those that need none. Any tab moves between windows of the same
workspace; between windows of different workspaces only grid tabs that need no
workspace move. Settings, releases, logs and the workspace list are sidebar
and grid tabs, not windows.

### 4.2 Pane / app registration

Each pane type registers a controller factory. When a tab is created, the grid
looks up the registration and creates the appropriate controller; an unknown
type falls back to a placeholder. Controllers implement
mount/unmount/snapshot/restore so state survives tab switches and reloads.

### 4.3 Drag & drop

Drag and drop lives in the **tab + drag-and-drop engine**, independent of
Electron/IPC. The platform wires it up at bootstrap.

The table below is the **current** platform-internal wiring (hand-rolled
per-source types). It is being replaced by the registration model in §2.9;
extension-facing drag/drop should follow §2.9, not add new per-source types.

| Concern                     | Where                                                                         |
| --------------------------- | ----------------------------------------------------------------------------- |
| Drag lifecycle coordination | Orchestrator                                                                  |
| Drag source                 | Per-source types (tabs, files, sidebar tabs, git entries, log streams, chats) |
| Drop targets                | Tab bar, grid, sidebar, explorer reorder                                      |
| Ghost overlay               | Ghost manager + layout                                                        |
| Hit-testing / thresholds    | Boundary logic                                                                |
| Cursor feedback             | Cursor manager                                                                |

Three drop scenarios: same-tab (rearrange), cross-tab within a window (add a
column), and cross-window (with a main-process bitmap ghost rendered in a
transparent always-on-top window so the drag can follow the cursor outside the
app window).

Drag state is **module-level** and survives DOM re-creation on tab switch —
which also makes **stale drag state** a real, common bug class to check first.

### 4.4 Event system

Interactions are **routed, not hard-wired**. DOM events become router events;
the router walks an **event graph** to find an edge matching the event type
_and_ the edge's `when` state predicate, then calls the terminal handlers.

- **Handlers are terminal** — they never emit events, so there are no cycles.
- Every routed event is recorded in an **event log buffer**, with the matched
  edge, per-handler results/timings, and a state snapshot. This makes
  event-log inspection the fastest way to debug an unresponsive interaction.

### 4.5 Main / renderer split

The renderer renders and emits events; the main process owns OS-level work. The
two meet over a **preload bridge** (`contextBridge`) that exposes a namespaced,
typed API to the renderer. Extension backends register handlers that this bridge
can dispatch to.

### 4.6 Bootstrap pipeline

The renderer starts as an ordered list of single-responsibility steps. **Order
matters**: the state-render subscriber must be registered before any async step,
or the first state set will not paint. A blank window with no error overlay
points at the bootstrap itself. A blocking **error overlay** captures
`window.onerror`, unhandled rejections, and forwarded main-process errors,
installed before the pipeline starts.

### 4.7 Renderer debug API

`window.__openp41ge_debug` is the primary agent-facing inspection surface. It
exposes live application state, the workspace (windows/tabs/grids/placements),
the event graph (nodes/edges/hash), and the event log buffer
(`logs.getLogs`, `logs.getEvent`, `logs.clear`).

---

## 5. Agent guidance

### 5.1 Ask, don't assume

When something is genuinely ambiguous, **ask the user before writing code**. A
short question costs seconds; a wrong assumption costs a rewrite, a bad commit,
and lost trust. The design plan, the skills, and the codebase are the sources of
truth — your recollection of them is not.

Always ask when:

- **The requirement is ambiguous.** Two reasonable readings would produce
  materially different code, UI, or data shapes.
- **The scope is unclear.** It is not obvious whether a change applies to one
  component, one package, or the whole repo.
- **A design decision is implied but unstated.** New event names, IPC channel
  names, config keys, persisted state shapes, or public exports are contracts —
  confirm them rather than inventing them.
- **The change is destructive or hard to reverse.** Deleting files, dropping
  workspace state, rewriting history, changing a migration, removing a public
  API.
- **Two existing patterns conflict.** The codebase does the same thing two ways
  and no comment or guide says which is current.
- **The request contradicts this plan or a skill.** Point out the conflict and
  ask which wins.

Some things look like judgement calls but are checkable. Check them, don't
guess:

| Instead of assuming…           | Verify with…                                           |
| ------------------------------ | ------------------------------------------------------ |
| A file/symbol/component exists | `grep` / `find`                                        |
| A package name or path         | `ls`, the package's `project.json`                     |
| An API's signature or type     | Read the source or the `.d.ts`, not memory             |
| A command exists               | `nx show project <name>` or its `project.json` targets |
| A behaviour is broken          | Reproduce it in the running app before diagnosing      |
| A test covers something        | Run the test and read it                               |
| A change works                 | Typecheck is not proof of behaviour — verify it runs   |

**Rule of thumb:** if you can answer with a tool call in under a minute, use the
tool. If you cannot answer with any tool call, ask the user.

Ask **early**, **specifically** (offer the options you see), and **once, in
batch**. If a question is genuinely low-stakes, pick the most conservative
option, do the work, and state the assumption explicitly. When the user has
already answered or reaffirmed a request, treat it as settled and proceed.

### 5.2 Commands (Nx)

The repo is an Nx + pnpm monorepo. Operations use **Nx**; most targets are
per-project, so use `run-many` for everything.

| Command                      | What it does                   |
| ---------------------------- | ------------------------------ |
| `nx run-many -t build`       | Build all projects             |
| `nx run-many -t typecheck`   | Type-check across all packages |
| `nx lint`                    | Lint                           |
| `nx knip`                    | Dead-code detection            |
| `nx format` / `format:check` | Prettier write / check         |
| `nx run-many -t clean`       | Remove `dist/`                 |

`nx run <project>:<target>` runs one project's target (e.g. a package's dev
server or unit tests). Targets can also be inferred by the Nx Vite plugin and
not appear in `project.json` — use `nx show project <name>` to see a project's
real targets. **Confirm a command still exists before quoting it** — this table
can drift.

### 5.3 Plans directory

The `plans/` directory tracks progress on every feature or bug fix. Write a plan
before significant work, keep it updated, and delete it when complete. Every
plan file must start with a date (`YYYY-MM-DD`) on the first line so plans can
be ordered chronologically.

### 5.4 Skills

The repo may define skills that provide authoritative workflows for common tasks.
**Always check for a skill before starting a task** — if one matches, load it
and follow it. Skills are authoritative for their domain; prefer them over
general reasoning. If no skill matches, proceed with general reasoning.

### 5.5 Code quality

- **Type check + lint + dead code** before submitting.
- **Run all tests** (from code-tests, §5.6) and **build** must succeed.
- A clean typecheck is not evidence of correct behaviour. If you changed runtime
  behaviour, verify it in the running app or in a test — and if you could not
  verify something, say so explicitly rather than reporting it as done.
- Follow **SOLID** principles with class-based architecture, and depend on
  abstractions, not concretions. External dependencies (filesystem, git, OS
  dialogs) are wrapped in **model interfaces** with a production implementation
  and a pure in-memory test implementation, injected so components can be tested
  deterministically.

### 5.6 Testing

- **Tests are private.** They live in the private `openp41ge/code-tests` repo,
  so the public repo cannot be used to recreate the application from them.
  Never add a test, test config, test helper or demo to this repo. code-tests
  mirrors this repo's layout (`packages/<pkg>/test/...`) and runs against a
  checkout of it (`APP_DIR`; by default the `code/master` worktree beside code-tests' own
  `code-tests/master` worktree): from
  code-tests, `pnpm test` runs everything, `pnpm test --project <pkg>` one
  package. Its README has the details. In CI, app's prerequisites dispatch
  code-tests, which reports the `code-tests` commit status the release gate
  requires.
- Tests sit in a per-package `test/` directory, split into **unit** (single
  module in isolation) and **integration** (cross-system boundaries).
- **Test-first**: write the test before the implementation. For new behaviour,
  write the test first and make it pass. For bug fixes, write a regression test
  that reproduces the bug, confirm it fails, fix it, and keep the test as a
  permanent guard.
- **Choose the level**: layout operations, tab lifecycle, drag calculations and
  event routing → integration; IPC shapes, controller interfaces, event
  contracts → integration; pure parsing/formatting and data-model invariants →
  unit.

### 5.7 Debugging

Work the loop in order; each step is cheap and narrows the search space.

1. **Reproduce it** deterministically before forming a hypothesis. If you cannot
   reproduce it, that is the finding — ask for exact steps rather than guessing.
2. **Observe before theorising.** Check the live DOM, the console, the error
   overlay, and `window.__openp41ge_debug` before opening source.
3. **Locate the layer.** Use the seams to bisect — state vs. event routing vs.
   component render vs. platform integration vs. drag state vs.
   mount/snapshot/restore vs. build config.
4. **Narrow to a single change.** Prefer the smallest reproduction (a demo app
   beats the full app; a unit test beats a demo).
5. **Form one falsifiable hypothesis** and check it.
6. **Prove it with a failing test** before fixing — a test that passes before
   the fix was never testing the bug.
7. **Fix the cause, not the symptom.** A null guard or `setTimeout` is usually a
   symptom — ask why the value was null or the order was wrong.
8. **Verify and clean up.** Run quality checks, remove temporary logs/debug
   hooks, keep the regression test.

**Event-log-driven debugging** is the highest-leverage technique for "the click
does nothing": clear the log, perform the broken interaction, then read what
actually happened. A missing entry means the event never fired (the problem is
in the DOM/listener); `matchedEdge: null` means the event fired but no graph edge
matched the state predicate; `handlerResults[].error` gives you the stack; the
state snapshot shows the state the handler actually saw.

**Debugging anti-patterns**: guessing from source without reproducing; changing
several things at once; "fixing" with a timeout or null check; fixing before the
failing test exists; leaving debug scaffolding behind (stray `console.error`
triggers the blocking error overlay); reporting "should be fixed"; silently
working around a bug you don't understand.

---

## 6. Keeping this document honest

This document is a map, not the territory. Paths, counts, and commands drift as
the code moves.

- If you find something here that contradicts the code, **the code wins** — fix
  this document in the same change, and tell the user what was stale.
- Do not delete guidance you merely failed to verify. Correct what you have
  checked; flag what you have not.
- When you add a package, target, skill, or architectural seam, update the
  relevant section here.
