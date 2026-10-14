/**
 * The management sidebar tabs — Workspaces, Settings, Releases, Cleanup,
 * Migrations — as platform sidebar tabs a workspace window opens on either
 * side, like any extension's sidebar tab (plans/2026-10-14-one-window.md).
 *
 * Each mounts the pane the management window shows for it. What a pane opens
 * (a workspace's editor, a settings schema's editor, a release) goes into the
 * window's grid through its `grid-open-tab` open path, in the last focused
 * column. Workspace and settings rows also drag onto the grid, as the
 * platform's `openp41ge/workspace-config` / `openp41ge/config-overrides`
 * payloads.
 */

import type { DragSourceDecl } from "openp41ge-sdk";
import type { SystemTabRegistration } from "../../controllers/types";
import { registerSystemTabType } from "../app-registry";
import { openInGrid, PaneTabController } from "../pane-tab";
import { extensionDrag } from "../../services/extension-drag";
import { dataDirWorkspaces } from "../../services/extension-renderer-loader";
import { CONFIG_EDITOR_APP_TYPE } from "../config-editor/title";
import { RELEASE_APP_TYPE } from "../release/index";
import { settingsIcon } from "../../icons";
import { CLEANUP_ICON, RELEASES_ICON, WORKSPACES_ICON } from "./icons";
import type { Openp41geSettingsList } from "../../components/openp41ge-settings-list";
import {
  workspaceName,
  type Openp41geWorkspacesList,
} from "../../components/openp41ge-workspaces-list";
import "../../components/openp41ge-settings-list";
import "../../components/openp41ge-releases-pane";
import "../../components/openp41ge-cleanup-pane";
import "../../components/openp41ge-migrations-pane";

/** The workspaces extension's editor surface (opened by app type, never imported). */
const WORKSPACE_EDITOR_APP_TYPE = "ext:openp41ge-extension-workspaces:workspace-editor";

/** The rows these panes let the platform drag. */
const WORKSPACE_ROW_SOURCE = "workspace-row";
const SETTINGS_ROW_SOURCE = "settings-row";

export const MANAGEMENT_DRAG_SOURCES: readonly DragSourceDecl[] = [
  {
    id: WORKSPACE_ROW_SOURCE,
    label: "Workspace",
    kind: "openp41ge/workspace-config",
    attrs: { path: "data-workspace-path", name: "data-workspace-name" },
    contexts: ["workspace"],
  },
  {
    id: SETTINGS_ROW_SOURCE,
    label: "Settings",
    kind: "openp41ge/config-overrides",
    attrs: { settingsId: "data-settings-id" },
    contexts: ["workspace"],
  },
];

function workspacesPane(): HTMLElement {
  const list = document.createElement("openp41ge-workspaces-list") as Openp41geWorkspacesList;
  list.dragSourceId = WORKSPACE_ROW_SOURCE;
  list.onOpen = (ws, pinned) =>
    openInGrid(
      WORKSPACE_EDITOR_APP_TYPE,
      { path: ws.filePath, name: workspaceName(ws), dir: dataDirWorkspaces() },
      pinned,
    );
  return list;
}

function settingsPane(): HTMLElement {
  const list = document.createElement("openp41ge-settings-list") as Openp41geSettingsList;
  list.dragSourceId = SETTINGS_ROW_SOURCE;
  list.onOpen = (id, pinned) => openInGrid(CONFIG_EDITOR_APP_TYPE, { extensionId: id }, pinned);
  return list;
}

function releasesPane(): HTMLElement {
  const pane = document.createElement("openp41ge-releases-pane");
  pane.addEventListener("open-release", (e) => {
    const { tag, pinned } = (e as CustomEvent<{ tag: string; pinned: boolean }>).detail;
    openInGrid(RELEASE_APP_TYPE, { tag }, pinned);
  });
  return pane;
}

interface PaneTab {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  readonly create: () => HTMLElement;
}

const PANE_TABS: readonly PaneTab[] = [
  {
    id: "workspaces",
    label: "Workspaces",
    icon: WORKSPACES_ICON,
    description: "Your workspaces: open one's editor, add or delete them",
    create: workspacesPane,
  },
  {
    id: "settings",
    label: "Settings",
    icon: settingsIcon(16),
    description: "The platform's and each extension's settings",
    create: settingsPane,
  },
  {
    id: "releases",
    label: "Releases",
    icon: RELEASES_ICON,
    description: "Releases of the app",
    create: releasesPane,
  },
  {
    id: "cleanup",
    label: "Cleanup",
    icon: CLEANUP_ICON,
    description: "Data the app no longer uses",
    create: () => document.createElement("openp41ge-cleanup-pane"),
  },
  {
    id: "migrations",
    label: "Migrations",
    icon: "",
    description: "Data migrations and their state",
    create: () => document.createElement("openp41ge-migrations-pane"),
  },
];

/** The management sidebar tab types. */
export function managementSidebarTabs(): SystemTabRegistration[] {
  return PANE_TABS.map((t) => ({
    id: t.id,
    label: t.label,
    icon: t.icon,
    description: t.description,
    defaultSide: "left",
    workspace: "none",
    createController: (tabId: string) => new PaneTabController(tabId, t.id, t.create),
  }));
}

/** Register the management sidebar tabs (offered in the sidebars' + menu) and
 *  the drag sources of their rows. */
export function registerManagementSidebarTabs(): void {
  for (const reg of managementSidebarTabs()) registerSystemTabType(reg);
  extensionDrag.registerPlatformSources(MANAGEMENT_DRAG_SOURCES);
}
