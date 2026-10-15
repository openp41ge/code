/**
 * renderer.ts — the Git extension **renderer** entry (renderer process).
 *
 * Self-registers the Repositories sidebar (the workspace's repos and their
 * worktrees), the Git output, Repository, File diff and Commit grid tabs,
 * the Git History Search sidebar (commit search), and the drag sources for the
 * Repositories rows and the commit rows (Repository tab, Git History Search results). Dropped repos and worktrees (`git-repository`) open as the
 * Repository tab, dropped commits (`git-commit`) as the Commit tab.
 */

import { registerDragDecls, registerRenderers } from "openp41ge-sdk";
import {
  REPOSITORY_DRAG_SOURCE_ID,
  renderRepositories,
  type RepositoriesHost,
} from "./repositories-view.js";
import { renderGitOutput } from "./git-output-view.js";
import { fileDiffTabLabel, renderFileDiff } from "./file-diff-view.js";
import { renderRepository, repositoryTabLabel, type RepositoryHost } from "./repository-cell.js";
import { commitTabLabel, renderCommit, type CommitHost } from "./commit-cell.js";
import { COMMIT_DRAG_SOURCE_ID } from "./repository-cell-view.js";
import { renderHistorySearch, type HistorySearchHost } from "./history-search.js";

registerRenderers([
  {
    kind: "sidebar",
    id: "repositories",
    title: "Repositories",
    defaultSide: "left",
    // The platform's SurfaceHost satisfies RepositoriesHost structurally; the
    // cast narrows the generic state to the view's own state type.
    render: (host) => renderRepositories(host as unknown as RepositoriesHost),
  },
  {
    // A read-only, terminal-style view of a git command and its output
    // (opened from a failed add's error icon).
    kind: "grid",
    id: "git-output",
    title: "Git output",
    render: (host) => renderGitOutput(host),
  },
  {
    // A repository, or one of its worktrees ({ repoName, branch? }):
    // branches, commits and the files they change.
    kind: "grid",
    id: "repository",
    title: "Repository",
    tabLabel: repositoryTabLabel,
    render: (host) => renderRepository(host as unknown as RepositoryHost),
  },
  {
    // One file as an inline diff: at a commit, or a worktree's uncommitted
    // change ({ repoName, path, hash?, branch? }).
    kind: "grid",
    id: "file-diff",
    title: "File diff",
    tabLabel: fileDiffTabLabel,
    render: (host) => renderFileDiff(host),
  },
  {
    // One commit ({ repoName, hash, shortHash? }): its message and files.
    kind: "grid",
    id: "commit",
    title: "Commit",
    tabLabel: commitTabLabel,
    render: (host) => renderCommit(host as unknown as CommitHost),
  },
  {
    // Search the workspace's commits; results open in the grid.
    kind: "sidebar",
    id: "history-search",
    title: "Git History Search",
    defaultSide: "right",
    render: (host) => renderHistorySearch(host as unknown as HistorySearchHost),
  },
]);

/** This extension's payload kinds: a repository (or worktree) and a commit. */
const REPOSITORY_KIND = "openp41ge-extension-git/repository";
const COMMIT_KIND = "openp41ge-extension-git/commit";

registerDragDecls({
  kinds: [
    {
      id: "repository",
      label: "Repository",
      schema: {
        type: "object",
        properties: { repoName: { type: "string" }, branch: { type: "string" } },
        required: ["repoName"],
      },
    },
    {
      id: "commit",
      label: "Commit",
      schema: {
        type: "object",
        properties: {
          repoName: { type: "string" },
          hash: { type: "string" },
          shortHash: { type: "string" },
        },
        required: ["repoName", "hash"],
      },
    },
  ],
  // A dropped repository or worktree opens as the Repository tab.
  consumers: [
    {
      id: "repository",
      label: "Repository",
      accepts: [REPOSITORY_KIND],
      placement: ["grid"],
      open: { kind: "renderer-surface", surface: "grid:repository" },
    },
    {
      id: "commit",
      label: "Commit",
      accepts: [COMMIT_KIND],
      placement: ["grid"],
      open: { kind: "renderer-surface", surface: "grid:commit" },
    },
  ],
  sources: [
    {
      id: REPOSITORY_DRAG_SOURCE_ID,
      label: "Repository",
      kind: REPOSITORY_KIND,
      // Worktree rows also carry data-branch; repo rows do not.
      attrs: { repoName: "data-repo-name", branch: "data-branch" },
      contexts: ["workspace"],
      crossWindow: true,
    },
    {
      // The Repository tab's commit rows.
      id: COMMIT_DRAG_SOURCE_ID,
      label: "Commit",
      kind: COMMIT_KIND,
      attrs: { repoName: "data-repo-name", hash: "data-hash", shortHash: "data-short-hash" },
      contexts: ["workspace"],
      crossWindow: true,
    },
  ],
});
