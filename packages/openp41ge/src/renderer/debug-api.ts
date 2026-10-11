import type { EventGraph } from "./services/event-graph";
import type { EventLogBuffer, LogEntry, LogFilter } from "./services/event-log-buffer";
import type { AppState } from "./services/app-state";
import type { WorkspaceData } from "./services/workspace-data";
import type { PluginRegistry, PluginRegistration } from "./services/plugin-registry";
import type { WorkspaceFileService } from "./services/workspace-file-service";
import { queryLog, type LogQuery as BusLogQuery } from "openp41ge-core-logger";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "debug-api");

export interface DebugAPI {
  state: AppState;
  workspace: WorkspaceData;
  logs: {
    getLogs(filter?: LogFilter): LogEntry[];
    getEvent(eventId: string): LogEntry | undefined;
    clear(): void;
    /** Query the renderer's captured log bus (openp41ge-core-logger). */
    query(filter?: BusLogQuery): ReturnType<typeof queryLog>;
    /** Path to the persisted logs directory (app-data root + /logs). */
    path(): Promise<string | null>;
  };
  graph: {
    hash(): string;
    nodes(): { id: string }[];
    edges(): { id: string; from: string; when: Record<string, unknown> | null; to: string[] }[];
  };
  plugins: PluginRegistration[];
  workspaceFile: WorkspaceFileService;
}

/**
 * Wires up window.__openp41ge_debug for agent-side debugging.
 */
export function initDebugAPI(
  appState: AppState,
  workspaceData: WorkspaceData,
  graph: EventGraph,
  logBuffer: EventLogBuffer,
  pluginRegistry: PluginRegistry,
  workspaceFile: WorkspaceFileService,
): void {
  const api: DebugAPI = {
    state: appState,
    workspace: workspaceData,
    logs: {
      getLogs: (filter) => logBuffer.getLogs(filter),
      getEvent: (eventId) => logBuffer.getEvent(eventId),
      clear: () => logBuffer.clear(),
      query: (filter) => queryLog(filter),
      path: async () => {
        try {
          if (typeof window !== "undefined" && window.openp41ge?.logs?.getPath) {
            const r = await window.openp41ge.logs.getPath();
            return r.logsDir;
          }
        } catch (err) {
          // IPC may be unavailable in some contexts
          log.debug("debug-api logs.getPath failed:", err);
        }
        return null;
      },
    },
    graph: {
      hash: () => graph.hash(),
      nodes: () => graph.nodes,
      edges: () => graph.edges,
    },
    plugins: pluginRegistry.getAll(),
    workspaceFile,
  };

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__openp41ge_debug = api;
}
