/**
 * platform-drag-consumers.ts — the platform's own tab consumers.
 *
 * The platform registers its built-in panes as consumers through the same
 * registry extensions use, before any extension loads. Each maps a payload to
 * the tab config its existing `grid-open-tab` handling already expects.
 *
 * `git-repository` and `git-commit` are the git extension's (its Repository
 * and Commit tabs); `chat-thread` is the agents extension's (its chat tab).
 *
 * `command-run` opens the platform's scoped terminal for the run's binary
 * and worktree, the run marked.
 *
 * `config-overrides` opens the JSON config editor for the extension named by
 * `settingsId`.
 *
 * `workspace-config` has no platform consumer: the workspace editor is the
 * Workspaces extension's surface, and that extension registers it.
 */

import type { DragPayload, PlatformDragKind, PlatformDragPayload } from "openp41ge-sdk";
import type { PlatformDragConsumer } from "./drag-consumer-registry";

/** Copy only the defined fields, so absent optionals don't appear as undefined. */
function pick<P extends DragPayload>(
  payload: P,
  keys: readonly (keyof P)[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    if (payload[key] !== undefined) out[key as string] = payload[key];
  }
  return out;
}

type Of<K extends PlatformDragKind> = Extract<PlatformDragPayload, { kind: K }>;

export const PLATFORM_DRAG_CONSUMERS: readonly PlatformDragConsumer[] = [
  {
    id: "file-viewer",
    label: "File viewer",
    accepts: ["openp41ge/file-path"],
    placement: ["grid"],
    open: { kind: "app", appType: "file-viewer" },
    toTabConfig: (p) => pick(p as Of<"openp41ge/file-path">, ["filePath"]),
  },
  {
    id: "log-viewer",
    label: "Log viewer",
    accepts: ["openp41ge/log-stream"],
    placement: ["grid"],
    open: { kind: "app", appType: "log-viewer" },
    toTabConfig: (p) => pick(p as Of<"openp41ge/log-stream">, ["system"]),
  },
  {
    id: "config-editor",
    label: "Settings editor",
    accepts: ["openp41ge/config-overrides"],
    placement: ["grid"],
    open: { kind: "app", appType: "config-editor" },
    toTabConfig: (p) => ({ extensionId: (p as Of<"openp41ge/config-overrides">).settingsId }),
  },
  {
    id: "terminal",
    label: "Terminal",
    accepts: ["openp41ge/command-run"],
    placement: ["grid"],
    open: { kind: "app", appType: "terminal" },
    toTabConfig: (p) =>
      pick(p as Of<"openp41ge/command-run">, ["binary", "repo", "worktree", "runId"]),
  },
];
