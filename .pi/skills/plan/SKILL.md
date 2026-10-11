---
name: plan
description: Always use before starting a feature, refactor, or bug fix. Produces a markdown plan with SOLID review, UX consistency check, and testing strategy.
---

# Plan — Structured Planning for the Openp41ge Monorepo

Use this skill when the user asks to plan a feature, refactor, or bug fix. The skill produces a markdown plan file in `plans/` following the project's plan conventions (see `AGENTS.md`).

## Workflow

### 1. Gather Requirements

Start by asking the user: **"What do you want to plan?"** Let them describe the feature, refactor, or fix in their own words.

Then ask **clarifying questions** to fill gaps. Cover these dimensions:

| Dimension              | Questions to ask                                                                                                       |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| **Scope**              | What specifically should change? What is explicitly out of scope?                                                      |
| **User interaction**   | Who triggers this? What buttons, shortcuts, or gestures are involved? What should the user see and feel?               |
| **Error / edge cases** | What happens if something fails (disk full, network down, invalid state)? What about empty states, concurrent actions? |
| **Existing behaviour** | Is this replacing something, adding to it, or both? Are there existing behaviours that must be preserved?              |
| **Dependencies**       | Does this depend on other in-flight work? Does it block other planned work?                                            |

Do not ask all questions at once — ask them conversationally. Skip questions whose answers are already obvious from the user's description.

### 2. Review the Codebase

Before writing the plan, review the code to understand:

- **Where similar features are implemented** — look for existing components, services, controllers, or models that handle analogous concerns. Follow the same patterns.
- **Current UX patterns** — how do similar interactions work today? E.g., if adding a new dialog, look at how `openp41ge-confirm-modal`, `openp41ge-clone-dialog`, or `openp41ge-add-worktree-dialog` are structured.
- **Existing test patterns** — look at the unit and integration tests (Vitest, in the private code-tests repo, which mirrors each package's `test/unit/` and `test/integration/`; AGENTS.md §5.6). What testing style does the closest analogous feature use?
- **Layout data model** — if the change touches the layout tree, review `packages/openp41ge/src/layout/` to understand the state shape and operation dispatch system.
- **IPC bridge** — if the change involves main-process communication, review the preload bridge (`packages/openp41ge/src/preload.ts` or `global.d.ts`).

### 3. Check SOLID Principles

When the plan involves new classes, refactoring existing ones, or designing interfaces, verify against each SOLID principle. Use the heuristics below to detect violations. For each violation found, include the principle letter, the file/location, a description of the violation, and the proposed fix in the plan.

#### S — Single Responsibility

**What to look for:**

- Classes named with "and" (e.g., `FileReaderAndRenderer`)
- Classes over ~300 lines
- Classes importing from both `components/` and `models/` or `layout/` and `renderer/` — likely mixing concerns
- Methods grouped into clearly separate domains (e.g., `readFile()` + `renderContent()`)

**Report format:**

```markdown
- **S** — `path/to/file.ts`
  The class `X` does both Y and Z. Extract Z into `ZService`.
```

#### O — Open/Closed

**What to look for:**

- `switch` statements or long `if-else if-else` chains on a type discriminant (e.g., `switch (appType)`), especially when cases map to class names — adding new types requires editing the switch
- Classes with `type` fields used in conditionals to vary behaviour (prefer polymorphism)
- Hard-coded maps that could be registries

**Prefer:** Registry or strategy pattern where new types register themselves without modifying existing code.

**Report format:**

```markdown
- **O** — `path/to/file.ts:42`
  Switch on `type` prevents adding new types without editing. Extract into a registry pattern.
```

#### L — Liskov Substitution

**What to look for:**

- Interface implementations that `throw` when the contract suggests returning `null`/`undefined`
- Subclasses strengthening preconditions (accept narrower types or add new validation the base doesn't have)
- Subclasses weakening postconditions (return wider types or skip side effects the base guarantees)

**Report format:**

```markdown
- **L** — `path/to/file.ts:15`
  `undo()` throws on empty stack but the interface contract expects `null`. Return `null` instead.
```

#### I — Interface Segregation

**What to look for:**

- Interfaces with 10+ methods (too broad)
- A class implementing an interface but stubbing methods with `throw new Error("not implemented")` or empty bodies
- One interface mixing read and write concerns when some consumers only need one side

**Report format:**

```markdown
- **I** — `path/to/interface.ts`
  Interface `IFileService` has 8 methods. Split into `IFileReader`, `IFileWriter`, `IFileDeleter`.
```

#### D — Dependency Inversion

**What to look for:**

- Classes that instantiate their own dependencies directly with `new`:
  ```typescript
  private repo = new IpcRepoService();  // hard-coded concrete dependency
  ```
- Classes importing concrete implementations from low-level modules instead of interfaces
- Static method calls on concrete classes for services (e.g., `ConfigLoader.load()` instead of injecting `IConfigLoader`)

**Note:** This project permits default concrete assignments via public properties (e.g., `_repoService: RepoService = new IpcRepoService()`) as long as the property is publicly settable so tests can override it. Flag cases where the property is not exposed or the concrete class is hard-coded without an abstraction.

**Report format:**

```markdown
- **D** — `path/to/component.ts:22`
  `_repoService` is assigned a concrete `IpcRepoService` but is not exposed as a settable public property — tests cannot override it.
```

#### Reporting conventions

- Group violations by principle (S, O, L, I, D)
- Include file path and line number for each violation
- Explain _why_ it violates the principle and suggest a fix
- If a pattern is intentionally allowed by project conventions (e.g., default property injection in Web Components), note it but still flag if the property isn't publicly settable

### 4. Consider UX Consistency

Look at how existing similar features handle:

- **Focus management** — where does focus go on open? On close? How does Tab behave? (Reference: current `openp41ge-confirm-modal` focuses the confirm button, `openp41ge-clone-dialog` focuses the input.)
- **Keyboard shortcuts** — are there existing key handlers that might conflict? What keys should the new feature handle? (Reference: Enter confirms, Escape cancels in modals; `openp41ge-add-worktree-dialog` handles Enter and Escape on the input.)
- **Visual style** — use the same CSS variables (`--bg-primary`, `--border-color`, `--accent`, `--text-secondary`, etc.) and spacing conventions seen in existing components.
- **Backdrop / overlay behaviour** — do modals have a click-outside-to-dismiss pattern? (Yes, `openp41ge-confirm-modal` does.)
- **Button ordering** — confirm on right, cancel on left, matching `openp41ge-confirm-modal`.
- **Event dispatch** — use bubbling CustomEvents for inter-component communication, matching existing patterns (e.g., `clone-start`, `add-worktree`, `clone-close`).

Document any UX deviations and their justification in the plan.

### 5. Write the Plan File

Write the plan to `plans/YYYY-MM-DD-<short-description>.md`. The plan file **must start with the date** on the first line in `YYYY-MM-DD` format.

Structure the plan with the following sections:

| Section                 | Content                                                                                                                                                       |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Goal**                | One-paragraph summary of what this plan achieves.                                                                                                             |
| **Rationale**           | Why this change is needed. What problem does it solve?                                                                                                        |
| **Approach**            | High-level technical approach. Which files change, and how. Include SOLID concerns and UX consistency notes.                                                  |
| **Files Changed**       | Bullet list of files with brief descriptions of the change.                                                                                                   |
| **Testing Strategy**    | What tests to write and where. Unit tests (Vitest) for pure logic, integration tests for cross-system behaviour; verify runtime behaviour in the running app. |
| **UX Considerations**   | Focus management, keyboard shortcuts, visual consistency, error states, loading states.                                                                       |
| **Open Questions**      | Any unresolved design decisions that need user input.                                                                                                         |
| **Completion Criteria** | Checklist of conditions that must be met for the plan to be considered done.                                                                                  |

### 6. Present and Confirm

After writing the plan file, present a summary to the user:

- The plan file path (e.g., `plans/2026-07-23-clean-test-output.md`)
- The goal and approach
- Key design decisions
- Testing strategy
- Any open questions

Then ask: **"Should I start implementing?"**

If the user wants changes, update the plan file and present again. If they approve, proceed to implementation.

## Openp41ge Project Reference

When planning for the Openp41ge monorepo, use the following architecture reference to
inform codebase review and design decisions.

### Project Structure

```
openp41ge/
├── packages/                     # flat — the prefix says what a package is (AGENTS.md §3)
│   ├── openp41ge/                # Electron desktop app — the platform
│   ├── openp41ge-core-*/         # Core libraries (uikit, tabs, terminal, agents, git, logger, …)
│   ├── openp41ge-sdk/            # Extension API contract
│   └── openp41ge-extension-*/    # Official extensions (explorer, workspaces); name = manifest id
├── plans/                        # Active plans — write, update, delete on completion
├── pnpm-workspace.yaml
└── package.json
```

### Key Files in `packages/openp41ge/`

| File                                          | Purpose                                                          |
| --------------------------------------------- | ---------------------------------------------------------------- |
| `src/layout/types.ts`                         | All type definitions (Workspace, Window, Grid, Tab, Pane)        |
| `src/layout/operations.ts`                    | Pure tree operations (30+ functions)                             |
| `src/layout/compute-layout.ts`                | Layout computation + ghost preview generation                    |
| `src/renderer/components/openp41ge-grid.ts`   | Main grid component with drag state, ghost overlay, DnD handlers |
| `src/renderer/components/openp41ge-pane.ts`   | Individual pane component (renders header + content)             |
| `src/renderer/components/openp41ge-tabbar.ts` | Tab bar with drop detection, reordering, hover-to-switch         |
| `src/renderer/drag-overlay.ts`                | Cross-window drag bridge using Electron IPC                      |
| `src/renderer/apps/app-registry.ts`           | App type registration (type ID → controller factory)             |
| `src/renderer/controllers/types.ts`           | TabController interface and AppTypeRegistration                  |
| `src/renderer/app.ts`                         | Entry point, service wiring, keyboard shortcuts                  |
| `src/renderer/global.d.ts`                    | `window.openp41ge.*` type declarations                           |
| `electron/preload.cjs`                        | contextBridge exposing `window.openp41ge.*` to renderer          |
| `electron/ipc-handlers/*.ts`                  | IPC handler registrations (one per domain)                       |
| `electron/main.ts`                            | Main process — wires services, creates windows                   |
| `src/styles/themes.css`                       | Dark and light theme CSS custom properties                       |

### Build & Test Commands

**Build** (platform package):

```bash
cd packages/openp41ge
pnpm build
```

**Tests** (Vitest, from the private code-tests repo beside this one):

```bash
cd ../../code-tests && pnpm test                 # everything
pnpm test --project openp41ge                   # one package
pnpm test -t "test name pattern"                # one test
```

### Layout Data Model

```
Workspace
 └── Window
      ├── activeOpenp41geId: string
      └── openp41ges: [{ id, name, grid }]
           └── Grid
                ├── rows: number (always 1 — column-based)
                ├── cols: number
                └── placements: [{ tabIds, position: { row, col } }]
```

- **Single-row grid**: Openp41ge uses a column-based layout (`rows = 1`). No nested containers.
- **Pure functions**: All tree operations are immutable — `(tree, args) => newTree` in
  `src/layout/operations.ts`.
- **Centralized state**: Workspace state is the single source of truth, dispatched via IPC.

### Communication Between Packages

Other packages (core libraries such as `openp41ge-core-terminal` and `openp41ge-core-logger`)
communicate with the openp41ge platform exclusively through:

1. **DOM CustomEvents** — dispatched on the element or `document`, bubbles up.
2. **Workspace State** — the single source of truth. Other packages never mutate state directly;
   they dispatch stringly-typed commands through `window.openp41ge.workspace.dispatch()`.
3. **PaneController (TabController) interface** — each app type implements
   `mount/unmount/setVisible/snapshot/restore` and is registered in the controller registry.

### App Type Registration

Each pane type (terminal, file-viewer, video, etc.) registers itself via
`registerAppType(registration)` in `src/renderer/apps/app-registry.ts`. The registration
includes a `createController(tabId)` factory. When a tab is created, the grid looks up the
registration and creates the appropriate controller. If no registration exists,
`PlaceholderController` is used as fallback.

### Drag & Drop System

Module-level state in `openp41ge-grid.ts`:

| Variable            | Purpose                                          |
| ------------------- | ------------------------------------------------ |
| `_activePaneId`     | The pane being dragged                           |
| `_activeTabId`      | The tab the pane came from (null for same-tab)   |
| `_activeWindowId`   | The window the pane came from                    |
| `_tabBarDropIntent` | Set during mousemove when cursor is over tab bar |
| `_ghostTargetCol`   | Current ghost target column for grid preview     |

Three drop scenarios:

1. **Same-tab**: `movePaneInGrid` — swaps/moves within existing grid. No `resizeGrid`.
2. **Cross-tab (same window)**: `resizeGrid(cols+1)` + `movePaneToTab` — adds column, places pane.
3. **Cross-window**: Same as cross-tab but across windows.

Column boundary insert threshold: `INSERT_BOUNDARY_THRESHOLD = 0.15` (15% of column width).

### Key Design Decisions

- **Vanilla Web Components** — no React/JSX. Custom elements with lifecycle callbacks.
  Other packages use Lit for convenience.
- **Module-level drag state** — survives grid DOM destruction/re-creation on tab switch.
- **getActiveGrid()** — dynamically resolves `document.querySelector("openp41ge-grid")` each time.
- **Cleanup ordering** — Always snapshot drag-intent flags into local variables BEFORE
  `clearDragState()`.
- **Empty grid handling** — Tab with no panes: don't add `+1` column, fill column 0.
- **No `resizeGrid` for same-tab** — moving within same tab just rearranges, no column count change.
- **Model-based DI** — External dependencies (filesystem, git) are wrapped in model interfaces
  with two implementations: production (IPC) and test (in-memory). See AGENTS.md for details.
