import { OperationDispatcher } from "./operation-dispatcher.js";
import type { Workspace } from "../../layout/types.js";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "workspace-registry");

/** Per-workspace callbacks wired into every dispatcher the registry creates. */
export interface WorkspaceRegistryOptions {
  /** Broadcast this workspace's serialized state to every window bound to it. */
  broadcast: (workspacePath: string, serialized: string) => void;
  /** Persist this workspace's layout session to its `.openp41ge-workspace` file. */
  save: (workspacePath: string, ws: Workspace) => void;
  /** Kill terminals owned by a pane when it is removed. */
  terminalCleanup: (paneId: string) => void;
}

/**
 * Multi-workspace state registry.
 *
 * The app was single-workspace-per-process: one `OperationDispatcher` held the
 * one active workspace and every window shared it. To let several workspaces be
 * open simultaneously (each with its own layout, tabs, editors), each workspace
 * path now gets its OWN dispatcher. Windows are bound to a workspace path (via
 * `openp41geWindowMeta`), so all state ops (`get-state`, `dispatch`,
 * `state-update`, save) route to the owning workspace's dispatcher.
 *
 * The default (unbound) dispatcher — set via `setDispatcher` — remains the
 * fallback for windows with no workspace binding (window-manager / logs).
 */
export class WorkspaceRegistry {
  private readonly _dispatchers = new Map<string, OperationDispatcher>();

  constructor(private readonly _opts: WorkspaceRegistryOptions) {}

  /** Get (or lazily create) the dispatcher for a workspace path. */
  getOrCreate(workspacePath: string): OperationDispatcher {
    let d = this._dispatchers.get(workspacePath);
    if (!d) {
      d = new OperationDispatcher();
      d.setBroadcast((serialized) => this._opts.broadcast(workspacePath, serialized));
      d.setSaveHandler((ws) => this._opts.save(workspacePath, ws));
      d.setTerminalCleanup(this._opts.terminalCleanup);
      this._dispatchers.set(workspacePath, d);
      log.info("registry-created", { workspacePath });
    }
    return d;
  }

  /** The dispatcher for a workspace path, or null if that workspace is not open. */
  get(workspacePath: string): OperationDispatcher | null {
    return this._dispatchers.get(workspacePath) ?? null;
  }

  has(workspacePath: string): boolean {
    return this._dispatchers.has(workspacePath);
  }

  /** Save every open workspace's layout to its own file (on app quit). */
  persistAll(): void {
    for (const d of this._dispatchers.values()) d.persist();
  }

  /** Every workspace path currently open in the registry. */
  paths(): string[] {
    return Array.from(this._dispatchers.keys());
  }
}
