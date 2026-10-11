/**
 * workspace-of-sender.ts — which workspace an IPC call is about.
 *
 * Chat threads and repositories belong to a workspace and live in its data
 * folder. A call is about the workspace open in the window that sent it
 * (window → workspace file → its id and data folder), or, for a call that
 * names one, that workspace file.
 */

import fs from "fs";
import {
  workspaceDataDirOf,
  type WorkspaceDataDir,
  type WorkspaceGit,
} from "../src/main/services/workspace-repositories.js";
import { workspacePathForSender } from "./window-manager.js";

/** Workspace file path → its id and data folder, cached. */
const byFile = new Map<string, WorkspaceDataDir>();

/**
 * The id and data folder of the workspace file at `file`. Null when it cannot
 * be read or has no id.
 */
export function workspaceOfFile(file: string, appDataDir: string): WorkspaceDataDir | null {
  const known = byFile.get(file);
  if (known) return known;
  let ws: WorkspaceDataDir | null = null;
  try {
    ws = workspaceDataDirOf(JSON.parse(fs.readFileSync(file, "utf-8")), appDataDir);
  } catch {
    ws = null;
  }
  // Only a workspace is remembered: a file not written yet may be next time.
  if (ws) byFile.set(file, ws);
  return ws;
}

/**
 * The workspace of the window that sent `event`. Null for a window without a
 * workspace (the manager) or a workspace file without an id.
 */
export function workspaceOfSender(
  event: { sender: Electron.WebContents },
  appDataDir: string,
): WorkspaceDataDir | null {
  const file = workspacePathForSender(event);
  return file ? workspaceOfFile(file, appDataDir) : null;
}

/**
 * The git services an IPC call is about: those of the sender's workspace, or
 * of `workspaceFile` when the call names one. Null without a workspace.
 */
export type WorkspaceGitResolver = (
  event: { sender: Electron.WebContents },
  workspaceFile?: string,
) => WorkspaceGit | null;

/** The git services of a call that needs a workspace; throws without one. */
export function requireWorkspaceGit(
  resolve: WorkspaceGitResolver,
  event: { sender: Electron.WebContents },
  workspaceFile?: string,
): WorkspaceGit {
  const git = resolve(event, workspaceFile);
  if (!git) throw new Error("Repositories belong to a workspace; this window has none.");
  return git;
}
