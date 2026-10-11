2026-08-29

# Cmd+N: Quick-Create / Quick-Action Modal (Plan B)

## Goal

Reassign **`Cmd+N`** from "new window" to a **centered modal** ("quick-create")
that opens in the middle of the screen and lets the user **type to filter** a set
of quick actions, including **creating a new file with the given name** (and a
new folder), creating a **new agent chat** that auto-opens in the grid, and
(other actions as listed). Move **"New Window"** to **`Cmd+Shift+N`** (currently
unbound).

This supersedes the earlier "new tab with pane-type picker" reading (Plan A).
The chosen direction (Plan B) is a single predictable entry point rather than a
contextual, focus-dependent shortcut, because focus detection across the
multi-window, shadow-DOM, grid layout is fragile and hard to predict.

## Rationale / Current State

- **`Cmd+N`** → `cmdNewWindow()` → new Electron window (still bound at
  `register-shortcuts.step.ts:29`).
- **`Cmd+Shift+N`** → free (only Meta+Shift+E/H/O/+/-/_/0/S/D are bound; no
  Meta+Shift+N).
- **`Cmd+P`** pane picker is **orphaned** — `register-shortcuts.step.ts:79`
  dispatches `openp41ge:show-pane-picker` but no listener exists, and
  `<openp41ge-pane-picker>` is never instantiated. Its styling/panel pattern is
  reusable. _(Optional follow-up, see Scope.)_
- **No Explorer file/folder creation exists today** — the worktree/repo tree has
  no "new file"/"new folder" command and no `file:create` IPC. The only path to a
  new file is `saveAs()` in the file editor (Save dialog). Quick-create needs a
  new main-process IPC to write a file / make a directory.
- **Agents "New chat" already works** — `agents-system-tab` `_newChat()` creates
  a chat and dispatches `openp41ge:open-chat` (`{ chatId, title, pinned: true }`)
  → opens it pinned in the grid. Reuse this event for the modal's "New chat".
- Reusable UI patterns: `openp41ge-pane-picker` / `openp41ge-confirm-modal`
  overlay styling, backdrop/panel theme vars (`--bg-primary`, `--border-color`,
  `--accent`, `--text-secondary`), `ITEM_HEIGHT` from `openp41ge-core-constants`.

## Approach

### 1. Shortcut remap (`src/renderer/bootstrap/steps/register-shortcuts.step.ts`)

- `Cmd+N` handler → open the new quick-create modal (instead of
  `cmdNewWindow()`). Always opens the modal; never a no-op.
- Register `Cmd+Shift+N` (`modifiers: 12`) → `cmdNewWindow()` ("New Window"
  relocated).

### 2. Quick-create modal component

`src/renderer/components/openp41ge-quick-create.ts` (new; Lit, light DOM like
other overlays). Centered panel with a **filter input** (autofocused) and a
filterable action list; arrow keys + Enter to select, Escape closes, backdrop
click closes.

- Exposes `.open()` and can be opened programmatically (dispatches/receives a
  custom event, following `openp41ge-confirm-modal`/`openp41ge-pane-picker`
  patterns).
- State lives in a module singleton so it survives HMR/re-mount churn (mirrors
  the `workspacesOverlayService` pattern).

### 3. Actions in the modal

The modal lists quick actions, filtered by what the user types. Actions are
registry-ish so new ones are additive:

- **Create new file** — type a name after the action (or use the "new file"
  action with an inline path field); creates the file via a new `file:create`
  IPC and opens it in the grid. Target directory resolution:
  - If an Explorer tree folder is currently selected, use that directory;
  - Else fall back to the first workspace root;
  - (Alternative) prompt for a full path. _(Open Question 2.)_
- **Create new folder** — new `file:createFolder` IPC (mkdir) under the same
  resolved directory.
- **New agent chat** — calls the existing create-chat path and dispatches
  `openp41ge:open-chat` (reuse `_newChat()` wiring) → opens pinned in the grid.
- **Open pane** (optional) — fold in the orphaned pane-picker actions
  (terminal/file-explorer/markdown/table/video) via `addColumnTab`, so the modal
  becomes a single quick-open/quick-create entry point. _(Open Question 3.)_

### 4. New main-process IPC for file/folder creation

- `electron/ipc-handlers/file-handlers.ts`: add
  - `file:create` → `{ path, content? }` — `fs.writeFile` (recursively create
    parent dirs); returns the created path.
  - `file:createFolder` → `{ path }` — `fs.mkdir` (recursive); returns the path.
  - Guard against path traversal / out-of-scope writes (basic validation).
- `electron/preload.cjs` + `src/renderer/global.d.ts`: expose `file.create` /
  `file.createFolder`.

### 5. Wire the controller

- `src/renderer/components/openp41ge-quick-create.ts` holds the action list; on
  selection it dispatches the relevant op:
  - create file/folder → `openp41ge:create-file` / `openp41ge:create-folder`
    events handled by the explorer/file-open layer (or call `file.create` then
    open via `actionOpenFile`);
  - new chat → dispatch `openp41ge:open-chat` (existing event).
- Register the component in `src/renderer/app.ts`.

## Files Changed

- `src/renderer/bootstrap/steps/register-shortcuts.step.ts` — remap Cmd+N, add
  Cmd+Shift+N.
- `src/renderer/components/openp41ge-quick-create.ts` — **new** component + action
  list + singleton state.
- `src/renderer/app.ts` — import/register the component.
- `electron/ipc-handlers/file-handlers.ts` — add `file:create` / `file:createFolder`.
- `electron/preload.cjs` + `src/renderer/global.d.ts` — expose the new IPC.
- `src/renderer/services/…` — resolver that maps a selected Explorer directory /
  workspace root → creation path (could live in the component).
- Reuse (no change): `agents-system-tab` `_newChat()` / `openp41ge:open-chat`.
- Optional: `src/renderer/components/openp41ge-pane-picker.ts` — only if we fix
  Cmd+P / fold panes into the modal (see Scope).

## Testing Strategy

- Unit: quick-create modal renders actions; typing filters; Enter/Escape/backdrop
  behave; selecting "New chat"/"new file" dispatches the expected event with the
  resolved directory; never creates an empty tab/file on cancel or no-match.
- Unit (pure): selection → dispatch mapping; directory resolution (selected
  folder → root fallback).
- Integration: `file:create` / `file:createFolder` IPC shapes + real temp-file
  write/read; `addColumnTab` for pane actions if panes are folded in.
- Manual (debug skill): Cmd+N opens modal; Escape/backdrop closes with no state
  change; "New chat" opens a chat in the grid; "new file `foo.ts`" creates the
  file and opens it; Cmd+Shift+N opens a new window; no console errors.
- Quality gate: `nx run-many -t typecheck`, `nx lint`; `nx run openp41ge:test`.

## UX Considerations

- **Focus**: modal input autofocuses on open; Enter selects the highlighted
  action/item; type-to-filter; Escape or backdrop closes. After creation, focus
  returns to the app (new file/chat takes focus naturally).
- **Keyboard**: no conflicts — Cmd+N / Cmd+Shift+N are free or relocatable.
- **Visual**: reuse the pane-picker/confirm-modal backdrop + panel styling and
  theme CSS vars; `ITEM_HEIGHT` from `openp41ge-core-constants`.
- **Empty/error states**: no registered actions → "No actions"; invalid/empty
  create path → inline validation, never create an empty file; failed IPC →
  silent close or toast, no orphan tab.
- **Create-new-file UX**: when the user types into the filter and it doesn't
  match an existing action, show a "Create new file `…`" action at the top so
  typing a name directly creates the file (Plan B's core behaviour).

## Scope

- **In**: Cmd+N → quick-create modal (filter + actions: new file, new folder,
  new chat); Cmd+Shift+N → new window; `file:create` / `file:createFolder` IPC.
- **Out (pending user call)**: reviving the orphaned Cmd+P pane picker / folding
  pane-opening into the modal — flagging because it's dead, but this plan only
  touches it if requested.
- **Out**: contextual/focus-dependent Cmd+N behaviour (Plan A) — explicitly
  rejected for predictability; a future nicety is contextual _preselection_
  inside the modal, but Cmd+N always opens the modal.

## Open Questions

1. **Create-new-file target directory** — default: use the selected Explorer tree
   folder, else first workspace root. Alternative: prompt for a full path. Confirm.
2. **New file naming flow** — inline path field on the action, or "type a name in
   the filter and hit Enter" (quick-create style). Default: the latter, with
   `new file` as an explicit action.
3. **Fold pane-opening into the modal** (and/or fix Cmd+P)? Default: leave pane
   opening out of this pass; reuse the pane-picker only if requested.

## Completion Criteria

- [ ] Cmd+N opens the quick-create modal (no new window).
- [ ] Cmd+Shift+N opens a new window.
- [ ] Modal lets the user type to filter actions; Enter/Escape/backdrop behave; no
      empty tab/file on cancel or no-match.
- [ ] "New file `<name>`" creates the file (via `file:create`) under the resolved
      directory and opens it in the grid.
- [ ] "New folder" creates a directory (via `file:createFolder`).
- [ ] "New chat" creates a chat and opens it pinned in the grid (reuses
      `openp41ge:open-chat`).
- [ ] `nx run-many -t typecheck`, `nx lint` clean; `nx run openp41ge:test` passes;
      runtime-verified in dev (debug skill), no console errors.
