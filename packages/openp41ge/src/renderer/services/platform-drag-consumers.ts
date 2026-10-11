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
 * `config-overrides` opens the JSON config editor for the extension named by
 * `settingsId`.
 *
 * Not yet registered: `workspace-config` (the workspace editor is an extension
 * surface; the Workspaces extension registers it when it migrates).
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
    accepts: ["openp41ge/file-path"],
    placement: ["grid"],
    open: { kind: "app", appType: "file-viewer" },
    toTabConfig: (p) => pick(p as Of<"openp41ge/file-path">, ["filePath"]),
  },
  {
    id: "log-viewer",
    accepts: ["openp41ge/log-stream"],
    placement: ["grid"],
    open: { kind: "app", appType: "log-viewer" },
    toTabConfig: (p) => pick(p as Of<"openp41ge/log-stream">, ["system"]),
  },
  {
    id: "config-editor",
    accepts: ["openp41ge/config-overrides"],
    placement: ["grid"],
    open: { kind: "app", appType: "config-editor" },
    toTabConfig: (p) => ({ extensionId: (p as Of<"openp41ge/config-overrides">).settingsId }),
  },
];
