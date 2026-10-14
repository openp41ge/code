/**
 * renderer.ts — the Workspaces extension **renderer** entry (renderer process).
 *
 * `api: "0.2"` renderer-driven. Self-registers surfaces at load via
 * `registerRenderers`; the host wraps the import in an extension scope and
 * mounts each surface by invoking its `render` inside a lit render root.
 *
 *   - a **grid** surface `workspace-editor` — edits a workspace config.
 *
 * There is no workspaces list surface: the platform's Workspaces tab lists
 * workspaces; a row dropped on a grid (`openp41ge/workspace-config`) opens
 * here, the platform's workspaces directory standing in for `dir`.
 *
 * The directory the surfaces operate on (`dir`) is platform-injected via
 * `host.context.dir`; the editor's target file is carried per-tab as
 * `host.context.path` (set by the platform from the tab's config).
 */

import { registerDragDecls, registerRenderers } from "openp41ge-sdk";
import { renderWorkspaceEditor, type WorkspaceEditorHost } from "./workspace-editor.js";

/** Workspaces glyph (material account-tree), as SVG markup for the grid tab handle. */
export const WORKSPACE_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" height="16px" viewBox="0 -960 960 960" width="16px" fill="currentColor"><path d="M120-80v-280h120v-160h200v-80H320v-280h320v280H520v80h200v160h120v280H520v-280h120v-80H320v80h120v280H120Zm280-600h160v-120H400v120ZM200-160h160v-120H200v120Zm400 0h160v-120H600v120ZM480-680ZM360-280Zm240 0Z"/></svg>';

registerRenderers([
  {
    kind: "grid",
    id: "workspace-editor",
    title: "Workspace editor",
    icon: WORKSPACE_ICON,
    description: "Edit a workspace's `.openp41ge-workspace` config (JSON / UI).",
    // Edits a workspace by its file, so it needs none open.
    workspace: "none",
    // Titled by the workspace's name (a Workspaces row's, or a dropped one's).
    tabLabel: (params) => ({
      title: typeof params.name === "string" && params.name ? params.name : "Workspace editor",
    }),
    render: (host) => renderWorkspaceEditor(host as unknown as WorkspaceEditorHost),
  },
]);

// A dropped workspace (a Workspaces row) opens as its editor.
registerDragDecls({
  consumers: [
    {
      id: "workspace-editor",
      accepts: ["openp41ge/workspace-config"],
      placement: ["grid"],
      open: { kind: "renderer-surface", surface: "grid:workspace-editor" },
    },
  ],
});

// Re-export the state/host types so tests/consumers can reach them without
// reaching into the view implementations.
export type {
  WorkspaceEditorState,
  WorkspaceEditorHost,
  WorkspaceEditorContext,
} from "./workspace-editor.js";
export type { WorkspaceEntry, WorkspaceFileData, WorkspaceRepo } from "./workspace-file.js";
export { WORKSPACE_FILE_SCHEMA } from "./workspace-schema.js";
export { WORKSPACE_EDITOR_APP_TYPE } from "./workspace-editor.js";
