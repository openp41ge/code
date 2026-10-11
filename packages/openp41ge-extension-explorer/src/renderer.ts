/**
 * renderer.ts — the Explorer extension **renderer** entry (renderer process).
 *
 * `api: "0.2"` renderer-driven. Self-registers its sidebar surface at load via
 * `registerRenderers` (and its file-row drag source via `registerDragDecls`); the host wraps the import in an extension scope and
 * mounts the surface by invoking `render` inside a lit render root.
 *
 * The render function is a pure function of the host (see ./tree-view.ts). It
 * is typed to the api's `SurfaceHost` via a structural cast to the narrower
 * `ExplorerHost` shape the view logic needs — the platform host is a superset
 * (it additionally carries `surface`, `subscribe`, `config`).
 */

import { registerConfigSchema, registerDragDecls, registerRenderers } from "openp41ge-sdk";
import {
  EXPLORER_CONFIG_SCHEMA,
  FILE_DRAG_SOURCE_ID,
  renderExplorer,
  type ExplorerHost,
} from "./tree-view.js";

// Its settings (indent size, prefetch depth), edited in the platform's
// settings editor and read back through `host.config`.
registerConfigSchema(EXPLORER_CONFIG_SCHEMA);

registerRenderers([
  {
    kind: "sidebar",
    id: "explorer",
    title: "Explorer",
    defaultSide: "left",
    // The platform's SurfaceHost satisfies ExplorerHost structurally; the cast
    // narrows the generic `state`/`setState` to the Explorer's own state type.
    render: (host) => renderExplorer(host as unknown as ExplorerHost),
  },
]);

// File rows are draggable: into a workspace grid (opens the file), onto any
// surface that receives `file-path`, or out to another window / the desktop.
registerDragDecls({
  sources: [
    {
      id: FILE_DRAG_SOURCE_ID,
      label: "File",
      kind: "openp41ge/file-path",
      attrs: { filePath: "data-path" },
      contexts: ["workspace"],
      crossWindow: true,
    },
  ],
});

// Re-export the state type so tests/consumers can use it without reaching into
// the view implementation.
export type {
  ExplorerState,
  WorkspaceRepoInfo,
  WorkspaceWorktreeInfo,
  TreeNode,
  ReadDirEntry,
} from "./tree-view.js";
