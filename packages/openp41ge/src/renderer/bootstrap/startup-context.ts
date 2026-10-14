/**
 * StartupContext — shared mutable state and injected services for bootstrap steps.
 *
 * All services are injected via constructor so tests can substitute mocks.
 * Mutable state (initialWorkspace, windowId) is set by steps and read by
 * subsequent steps.
 *
 * Because TypeScript interfaces don't exist for some services (ConfigService,
 * FileOpenHandler, etc.), we use the concrete types. For testing, the test
 * creates its own instances (possibly of test doubles that extend the originals).
 */

import type { ICommandBus } from "../interfaces/command-bus";
import type { IWorkspaceStateManager } from "../interfaces/workspace-state-manager";
import type { IKeyboardManager } from "../interfaces/keyboard-manager";
import type { IZoomService } from "../interfaces/zoom-service";
import type { IQuoteController } from "../interfaces/quote-controller";
import type { IFileOpenHandler } from "../interfaces/file-open-handler";
import type { IFileDropHandler } from "../interfaces/file-drop-handler";
import type { IContextMenuBuilder } from "../interfaces/context-menu-builder";
import type { EventGraph } from "../services/event-graph";
import type { EventRouter } from "../services/event-router";
import type { EventLogBuffer } from "../services/event-log-buffer";
import type { PluginRegistry } from "../services/plugin-registry";
import type { DOMBridge } from "../services/dom-bridge";

import { WorkspaceStateManager } from "../services/workspace-state-manager";
import { CommandBus } from "../services/command-bus";
import { KeyboardManager } from "../services/keyboard-manager";
import { ZoomService } from "../services/zoom-service";
import { ConfigService } from "../services/config-service";
import { FileOpenHandler } from "../services/file-open-handler";
import { ContextMenuBuilder } from "../services/context-menu-builder";
import { QuoteController } from "../services/quote-controller";
import { FileDropHandler } from "../services/file-drop-handler";
import { Openp41geTabsEventHandler } from "../services/openp41ge-tabs-event-handler";
import { TabMountManager } from "../services/tab-mount-manager";
import { ModelRegistry } from "../models/model-registry";
import { engageDrag, initDragSystem, startPayloadDrag } from "../services/init-drag-system";
import { extensionDrag } from "../services/extension-drag";
import { initRendererLogTransport } from "../services/renderer-log-transport";

import type { Workspace } from "../../layout/types";

export class StartupContext {
  // ── Injected services ──────────────────────────────────────────────
  readonly commandBus: ICommandBus;
  readonly workspaceState: IWorkspaceStateManager;
  readonly keyboardManager: IKeyboardManager;
  readonly zoomService: IZoomService;
  readonly configService: ConfigService;
  readonly fileOpenHandler: IFileOpenHandler;
  readonly contextMenuBuilder: IContextMenuBuilder;
  readonly quoteController: IQuoteController;
  readonly fileDropHandler: IFileDropHandler;
  readonly openp41geTabsEventHandler: Openp41geTabsEventHandler;
  readonly tabMountManager: TabMountManager;
  readonly modelRegistry: ModelRegistry;

  // ── Pre-started IPC promises (fired early, awaited later) ───────────
  /**
   * Promise for the initial workspace state, started at bootstrap time
   * so the IPC call is in flight while sync steps execute.
   * Set by RendererBootstrap.start() before any steps run.
   */
  initialStatePromise: Promise<string> | null = null;

  // ── Mutable state set by steps ──────────────────────────────────────
  /** Initial workspace state fetched from main process. */
  initialWorkspace: Workspace | null = null;

  /** This window's ID, resolved during startup. */
  windowId: string | null = null;

  /**
   * The `.openp41ge-workspace` path of the workspace this window shows, or
   * null when it has none open. Set by the `resolve-window-workspace` step.
   */
  workspacePath: string | null = null;

  // ── Ad-hoc references set by steps ───────────────────────────────────
  /**
   * Event-system references (graph, router, log buffer, plugin registry,
   * DOM bridge) populated by the init-event-controller step during bootstrap.
   */
  __eventController?: {
    graph: EventGraph;
    router: EventRouter;
    logBuffer: EventLogBuffer;
    pluginRegistry: PluginRegistry;
    domBridge: DOMBridge;
  };

  constructor() {
    // Instantiate all services (only construction, no init/wiring)
    this.commandBus = new CommandBus();
    this.workspaceState = new WorkspaceStateManager();
    this.keyboardManager = new KeyboardManager();
    this.zoomService = new ZoomService();
    this.configService = new ConfigService();
    this.fileOpenHandler = new FileOpenHandler();
    this.contextMenuBuilder = new ContextMenuBuilder();
    this.quoteController = new QuoteController();
    this.fileDropHandler = new FileDropHandler();
    this.openp41geTabsEventHandler = new Openp41geTabsEventHandler();
    this.tabMountManager = new TabMountManager();
    this.modelRegistry = new ModelRegistry();
  }

  /**
   * Wire cross-service dependencies after all services are constructed.
   * Called as part of the init-services step.
   */
  wireServices(): void {
    // Let the command bus resolve the close-focus tab from live state.
    this.commandBus.setWorkspaceGetter(() => this.workspaceState.getWorkspace());

    this.contextMenuBuilder.init(this.commandBus);
    this.fileOpenHandler.init(this.commandBus, this.workspaceState, this.tabMountManager);
    this.fileDropHandler.init(this.commandBus);

    // The tab system (event handler + drag orchestrator), bound to the
    // workspace state.
    this.openp41geTabsEventHandler.init(this.commandBus, this.tabMountManager, {
      getWorkspace: () => this.workspaceState.getWorkspace(),
    });
    initDragSystem();

    // Extension drag & drop: this window's context, the payload pipeline,
    // and the grid's kind → consumer resolver (extensions loaded earlier, in
    // RegisterAppTypesStep).
    extensionDrag.init({
      windowContext: "workspace",
      pipeline: { startPayloadDrag, engageDrag },
      getOverrides: () =>
        (this.configService.get("dragConsumers") as Record<string, string> | undefined) ?? {},
    });

    // Forward renderer log bus to the main process (<dataDir>/logs).
    initRendererLogTransport();
  }
}
