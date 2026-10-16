/**
 * sources.ts — where the open palette's results come from. Each source
 * reports its entries as soon as it has them (`onEntries`), so the palette
 * shows the platform's own at once and adds files and the extensions'
 * providers as they answer.
 *
 *   - Tabs on their own: every sidebar tab, every grid tab without `opens`.
 *   - Settings (the platform's, each extension's with a schema), log streams,
 *     releases and workspaces, as items of the platform's kinds.
 *   - Files of the workspace's worktrees (for a non-empty query).
 *   - Each extension search provider's items.
 *   - New file / new folder for the typed path (for a non-empty query).
 */

import { listLogStreams } from "openp41ge-core-logger";
import { parseSearchItems, type SearchItem } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import { getAllAppTypeRegistrations, getAllSystemTabRegistrations } from "../../apps/app-registry";
import { configEditorTitle } from "../../apps/config-editor/title";
import { workspaceName } from "../../components/openp41ge-workspaces-list";
import { getActiveExtensions } from "../extension-contributions";
import { buildWorkspaceContext } from "../extension-renderer-loader";
import { extensionOpenKinds } from "../open-kinds";
import { releasesDeps } from "../releases-deps";
import {
  PLATFORM_SETTINGS_ID,
  settingsBridge,
  type PlatformConfigBridge,
} from "../settings-sources";
import { workspaceFileService } from "../workspace-file-service";
import type { PaletteEntry } from "./model";

const log = createLogger("openp41ge", "open-palette");

/** Where a new file / folder goes: a worktree folder, and what to call it. */
export interface CreateTarget {
  readonly root: string;
  /** e.g. `gh/org/repo · main`. */
  readonly label: string;
}

export interface SourceOptions {
  /** Where new files and folders go (null: no worktree, none offered). */
  readonly createTarget: CreateTarget | null;
}

type OnEntries = (entries: readonly PaletteEntry[]) => void;

/** The icon a surface gets when it declares none (`deriveSurfaceCatalog`): not shown here. */
const PLACEHOLDER_ICON = "\uD83E\uDDF9";

const iconOf = (icon: string) => (icon === PLACEHOLDER_ICON ? {} : { icon });

/** The tab types offered on their own (the model drops those not offered now). */
function tabEntries(): PaletteEntry[] {
  const sidebar = getAllSystemTabRegistrations().map((r): PaletteEntry => ({
    type: "tab",
    tabType: r.id,
    title: r.label,
    ...iconOf(r.icon),
  }));
  const grid = getAllAppTypeRegistrations()
    .filter((r) => r.opens === undefined && !r.settings)
    .map((r): PaletteEntry => ({ type: "tab", tabType: r.id, title: r.label, ...iconOf(r.icon) }));
  return [...sidebar, ...grid];
}

function logEntries(): PaletteEntry[] {
  return listLogStreams().map((s): PaletteEntry => ({
    type: "open",
    item: {
      kind: "openp41ge/log-stream",
      params: { system: s.system },
      title: `${s.system} logs`,
      description: "Log stream",
    },
  }));
}

async function settingsEntries(): Promise<PaletteEntry[]> {
  const extension = window.openp41ge?.extension?.config;
  const platform = window.openp41ge?.config;
  if (!extension || !platform) return [];
  const bridge = settingsBridge(extension, platform as unknown as PlatformConfigBridge);
  const ids = [PLATFORM_SETTINGS_ID, ...getActiveExtensions().map((e) => e.id)];
  const found = await Promise.all(
    ids.map(async (id): Promise<PaletteEntry | null> => {
      try {
        const described = await bridge.describe(id);
        if (!described?.schema) return null;
      } catch {
        return null;
      }
      return {
        type: "open",
        item: {
          kind: "openp41ge/settings",
          params: { extensionId: id },
          title: configEditorTitle(id),
          description: "Settings",
        },
      };
    }),
  );
  return found.filter((e): e is PaletteEntry => e !== null);
}

async function releaseEntries(): Promise<PaletteEntry[]> {
  const snapshot = await releasesDeps().getReleases();
  return snapshot.releases.map((r): PaletteEntry => ({
    type: "open",
    item: {
      kind: "openp41ge/release",
      params: { tag: r.tag_name },
      title: r.name || r.tag_name,
      description: r.prerelease ? "Prerelease" : "Release",
    },
  }));
}

async function workspaceEntries(): Promise<PaletteEntry[]> {
  const list = await workspaceFileService.listWorkspaces();
  return list.map((ws): PaletteEntry => {
    const name = workspaceName(ws);
    return {
      type: "open",
      item: {
        kind: "openp41ge/workspace",
        params: { path: ws.filePath, name },
        title: name,
        description: "Workspace",
      },
    };
  });
}

async function fileEntries(query: string): Promise<PaletteEntry[]> {
  const files = (await window.openp41ge?.palette?.files(query, 200)) ?? [];
  return files.map((f): PaletteEntry => {
    const slash = f.relPath.lastIndexOf("/");
    const dir = slash >= 0 ? f.relPath.slice(0, slash) : "";
    return {
      type: "open",
      item: {
        kind: "openp41ge/file",
        params: { filePath: f.path },
        title: f.relPath.slice(slash + 1),
        description: [dir, `${f.repoName} · ${f.branch}`].filter(Boolean).join(" — "),
        key: f.path,
      },
      matchPath: f.relPath,
    };
  });
}

function providerEntry(extensionId: string, providerId: string, item: SearchItem): PaletteEntry {
  if ("create" in item) {
    return {
      type: "create",
      title: item.title,
      ...(item.description ? { description: item.description } : {}),
      ...(item.icon ? { icon: item.icon } : {}),
      provider: { extensionId, providerId, create: item.create },
    };
  }
  return { type: "open", item };
}

async function providerSearches(query: string, onEntries: OnEntries): Promise<void> {
  const palette = window.openp41ge?.palette;
  if (!palette) return;
  const providers = await palette.providers();
  await Promise.all(
    providers.map(async ({ extensionId, id }) => {
      const result = await palette.search(extensionId, id, query);
      if (!result.ok) return;
      const { items, problems } = parseSearchItems(result.items, extensionOpenKinds());
      if (problems.length > 0) {
        log.warn(`search provider '${extensionId}/${id}' returned items it should not:`, problems);
      }
      onEntries(items.map((item) => providerEntry(extensionId, id, item)));
    }),
  );
}

function createEntries(query: string, target: CreateTarget | null): PaletteEntry[] {
  const rel = query.trim().replace(/^\/+/, "");
  if (!target || rel === "" || rel.split("/").includes("..")) return [];
  const full = `${target.root.replace(/\/+$/, "")}/${rel}`;
  const where = `in ${target.label}`;
  return [
    {
      type: "create",
      title: `New file “${rel}”`,
      description: where,
      path: { target: full, what: "file" },
    },
    {
      type: "create",
      title: `New folder “${rel}”`,
      description: where,
      path: { target: full, what: "folder" },
    },
  ];
}

/**
 * Gather everything matching `query`, reporting each source's entries as
 * they arrive. Resolves once every source has answered (or failed — a
 * failing source is logged and contributes nothing).
 */
export async function gatherEntries(
  query: string,
  options: SourceOptions,
  onEntries: OnEntries,
): Promise<void> {
  onEntries([...tabEntries(), ...logEntries()]);
  const settled = async (what: string, run: () => Promise<PaletteEntry[] | void>) => {
    try {
      const entries = await run();
      if (entries) onEntries(entries);
    } catch (err) {
      log.warn(`palette source '${what}' failed:`, err);
    }
  };
  await Promise.all([
    settled("settings", settingsEntries),
    settled("releases", releaseEntries),
    settled("workspaces", workspaceEntries),
    query.trim() ? settled("files", () => fileEntries(query.trim())) : Promise.resolve(),
    settled("providers", () => providerSearches(query, onEntries)),
  ]);
  onEntries(createEntries(query, options.createTarget));
}

/**
 * Where a new file goes: the worktree holding `focusedFile` (the focused grid
 * tab's file), else the workspace's first worktree; null when it has none.
 */
export async function resolveCreateTarget(
  focusedFile: string | null,
): Promise<CreateTarget | null> {
  const ctx = await buildWorkspaceContext();
  const repos =
    (ctx.workspaceRepos as
      | ReadonlyArray<{ name: string; worktrees: ReadonlyArray<{ name: string; path: string }> }>
      | undefined) ?? [];
  const all = repos.flatMap((r) =>
    r.worktrees.map((w) => ({ root: w.path, label: `${r.name} · ${w.name}` })),
  );
  if (focusedFile) {
    const holding = all
      .filter((t) => focusedFile.startsWith(t.root.replace(/\/+$/, "") + "/"))
      .sort((a, b) => b.root.length - a.root.length)[0];
    if (holding) return holding;
  }
  return all[0] ?? null;
}
