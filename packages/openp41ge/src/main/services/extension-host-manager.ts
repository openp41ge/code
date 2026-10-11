/**
 * ExtensionHostManager — owns the extension host in the main process.
 *
 * The single main-process surface for the extension system:
 *
 *   - Boots the host at startup (`init`), scanning the global
 *     `~/.openp41ge/extensions` root, the open workspace's
 *     `<workspace>/extensions` dir and any extra roots (dev packages).
 *   - Rebuilds/reloads the host when the workspace changes. No load order
 *     between extensions is guaranteed.
 *   - Routes renderer/component events to extension main handlers (`dispatch`).
 *
 * The manager itself is pure Node — window broadcasting is handled by the
 * caller (the application) via `onStateChange`, so this is testable without
 * Electron.
 */

import { join } from "node:path";
import { createLogger, type ILogger } from "openp41ge-core-logger";
import {
  ExtensionHost,
  type ActiveExtensionSummary,
  type ExtensionConfigStore,
  type ExtensionHostOptions,
} from "openp41ge-core-extension-host";
import type { HandlerCaller, HandlerPayload } from "openp41ge-sdk";

export const EXTENSIONS_DIR_NAME = "extensions";

export interface ExtensionHostManagerOptions {
  /** Global install root (`~/.openp41ge/extensions`). */
  readonly installDir: string;
  /** Extra discovery roots (e.g. the repo's `packages/` dir in dev). */
  readonly extraDiscoveryDirs?: readonly string[];
  /** Override host creation (tests). */
  readonly createHost?: (opts: Pick<ExtensionHostOptions, "discoveryDirs">) => ExtensionHost;
  /** Invoked whenever the active-extension set changes (e.g. to broadcast). */
  readonly onStateChange?: (active: ActiveExtensionSummary[]) => void;
  /** Invoked when a backend handler publishes a topic push. The platform
   *  wires this to broadcast to renderer windows. Topic is qualified. */
  readonly onPublish?: (topic: string, payload?: HandlerPayload) => void;
  /** Where extension config lives (backend schemas, `ctx.config`). */
  readonly config?: ExtensionConfigStore;
}

export class ExtensionHostManager {
  private readonly _installDir: string;
  private readonly _createHost: (
    opts: Pick<ExtensionHostOptions, "discoveryDirs" | "onPublish" | "config">,
  ) => ExtensionHost;
  private readonly _onStateChange: (active: ActiveExtensionSummary[]) => void;
  private readonly _onPublish: (topic: string, payload?: HandlerPayload) => void;
  private readonly _config: ExtensionConfigStore | undefined;
  private readonly _extraDiscoveryDirs: readonly string[] | undefined;
  private readonly _log: ILogger;

  private _host!: ExtensionHost;
  private _workspacePath: string | null = null;
  private _inited = false;

  constructor(options: ExtensionHostManagerOptions) {
    this._installDir = options.installDir;
    this._createHost = options.createHost ?? ((opts) => new ExtensionHost(opts));
    this._onStateChange = options.onStateChange ?? (() => {});
    this._onPublish = options.onPublish ?? (() => {});
    this._config = options.config;
    this._extraDiscoveryDirs = options.extraDiscoveryDirs;
    this._log = createLogger("openp41ge", "extension-host-manager");
  }

  /** Discovery roots: global install root + (optionally) the workspace dir. */
  get discoveryDirs(): string[] {
    const dirs = [this._installDir];
    if (this._workspacePath) dirs.push(join(this._workspacePath, EXTENSIONS_DIR_NAME));
    if (this._extraDiscoveryDirs) dirs.push(...this._extraDiscoveryDirs);
    return dirs;
  }

  /** Boot the host (call once at startup). */
  async init(): Promise<void> {
    await this._reload();
    this._inited = true;
    this._log.info(
      `Loaded ${this._host.loadedExtensions().length} extension(s) from ${this.discoveryDirs.join(", ")}`,
    );
  }

  /** Point the host at a workspace root so `<workspace>/extensions` is scanned. */
  async setWorkspacePath(path: string | null): Promise<void> {
    this._workspacePath = path;
    if (this._inited) await this._reload();
  }

  /** The currently active extensions (id, version, renderer entry) for the renderer. */
  activeExtensions(): ActiveExtensionSummary[] {
    return this._host?.activeExtensions() ?? [];
  }

  /**
   * The loaded extensions' install roots, for the `openp41ge-ext://` asset
   * protocol.
   */
  extensionAssetRoots(): { id: string; root: string }[] {
    return (this._host?.loadedExtensions() ?? []).map((e) => ({ id: e.id, root: e.root }));
  }

  /** Route a command to a registered extension backend handler.
   *  Returns the handler's result (or undefined for fire-and-forget).
   *  `caller` is what the platform provides about the calling window (its
   *  workspace's git). */
  dispatch(commandId: string, payload: HandlerPayload, caller?: HandlerCaller): Promise<unknown> {
    return this._host?.dispatch(commandId, payload, caller) ?? Promise.resolve(undefined);
  }

  hasHandler(commandId: string): boolean {
    return this._host?.hasHandler(commandId) ?? false;
  }

  // ── Internals ────────────────────────────────────────────────────────

  /**
   * Unload every extension (their registered cleanups run). Call at app quit:
   * cleanups run in order and only what they do synchronously is sure to
   * finish before the app exits.
   */
  async shutdown(): Promise<void> {
    await this._host?.deactivateAll();
  }

  /** Rebuild a fresh host against the current discovery dirs,
   *  unloading the previous one's extensions first. */
  private async _reload(): Promise<void> {
    await this._host?.deactivateAll();
    this._host = this._createHost({
      discoveryDirs: this.discoveryDirs,
      onPublish: this._onPublish,
      config: this._config,
    });
    await this._host.loadAll();
    this._onStateChange(this._host.activeExtensions());
  }
}
