/**
 * The Log Streams and Log Search sidebar tabs.
 * They open streams into the window's grid; stream rows drag as the
 * platform's `openp41ge/log-stream` payloads.
 */

import type { DragSourceDecl } from "openp41ge-sdk";
import { registerSystemTabType } from "../app-registry";
import { PaneTabController } from "../pane-tab";
import { extensionDrag } from "../../services/extension-drag";
import { openLogStream } from "./open-logs";
import { requestLogTab } from "./log-tab-requests";
import type { Openp41geLogStreamsPane } from "../../components/openp41ge-log-streams-pane";
import type { Openp41geLogSearchPane } from "../../components/openp41ge-log-search-pane";
import "../../components/openp41ge-log-streams-pane";
import "../../components/openp41ge-log-search-pane";

const STREAM_ROW_SOURCE = "log-stream-row";

const STREAM_ROW: DragSourceDecl = {
  id: STREAM_ROW_SOURCE,
  label: "Log stream",
  kind: "openp41ge/log-stream",
  attrs: { system: "data-system" },
  contexts: ["workspace"],
};

function streamsPane(): HTMLElement {
  const pane = document.createElement("openp41ge-log-streams-pane") as Openp41geLogStreamsPane;
  pane.dragSourceId = STREAM_ROW_SOURCE;
  pane.onOpen = (system) => openLogStream(system, false);
  return pane;
}

function searchPane(): HTMLElement {
  const pane = document.createElement("openp41ge-log-search-pane") as Openp41geLogSearchPane;
  pane.onOpen = (system, query) => {
    openLogStream(system, false);
    requestLogTab(system, { kind: "find", query });
  };
  return pane;
}

/** Register the log sidebar tabs (offered in the sidebars' + menu) and the
 *  stream rows' drag source. */
export function registerLogSidebarTabs(): void {
  registerSystemTabType({
    id: "log-streams",
    label: "Log Streams",
    icon: "",
    description: "Every log stream: click to preview, drag to the grid to open",
    defaultSide: "left",
    workspace: "none",
    createController: (tabId) => new PaneTabController(tabId, "log-streams", streamsPane),
  });
  registerSystemTabType({
    id: "log-search",
    label: "Log Search",
    icon: "",
    description: "Search the logs of every stream",
    defaultSide: "left",
    workspace: "none",
    createController: (tabId) => new PaneTabController(tabId, "log-search", searchPane),
  });
  extensionDrag.registerPlatformSources([STREAM_ROW]);
}
