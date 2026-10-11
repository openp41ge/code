/**
 * Openp41ge renderer — creates the bootstrap pipeline and starts it.
 *
 * This file is intentionally thin. All startup logic is in the bootstrap
 * module (bootstrap/), where each responsibility is its own step class.
 *
 * Design:
 *   - StartupContext holds all injected service instances (DI container)
 *   - Each IStartupStep has one responsibility
 *   - RendererBootstrap runs steps serially, catching errors per step
 *   - The UI renders synchronously on start(), before any async step
 *
 * Legacy exports (getWorkspace, dispatch, appServices) are preserved for
 * backward compatibility while components migrate to DI.
 */

import { createLogger, setMinLevel, LogLevel } from "openp41ge-core-logger";
const log = createLogger("openp41ge", "app");

// ─── Component registration (side-effect imports — must be at module level) ──
import "./components/openp41ge-windowview";
import "./components/openp41ge-window-manager";
import "./components/openp41ge-logs-window";
import "./components/openp41ge-releases-pane";
import "./components/openp41ge-cleanup-pane";
import "./components/openp41ge-migrations-pane";
import "./components/openp41ge-titlebar";
import "./components/openp41ge-topbar";
import "./components/openp41ge-contextmenu";
import "./components/openp41ge-pane-picker";
import "./components/openp41ge-sidebar";
import "./components/openp41ge-confirm-mask";
import "./components/focus-section";
import "./components/openp41ge-bottom-bar-btn";

import { isDebugSeed } from "./services/log-debug";

// Import openp41ge-sdk-uikit (registers <tab-grid>, <tab-bar>, <tab-content>, etc.)
import "openp41ge-sdk-uikit";
import { installGlobalScrollbarStyles } from "openp41ge-sdk-uikit";

// ─── Theme CSS variables (bundled by Vite) ────────────────────────────────
import "../styles/themes.css";

// ─── Shared action-button styles (sidebar bottom-bar buttons, etc.) ──────
import "../styles/action-buttons.css";

// ─── Bootstrap imports ───────────────────────────────────────────────────
import {
  RendererBootstrap,
  StartupContext,
  ExposeTestModelsStep,
  RegisterAppTypesStep,
  InitServicesStep,
  LoadConfigStep,
  RegisterEventListenersStep,
  FetchInitialStateStep,
  SubscribeStateUpdatesStep,
  RegisterTabActivationRecorderStep,
  RegisterShortcutsStep,
  RegisterIpcListenersStep,
  StartQuoteControllerStep,
  SignalReadyStep,
} from "./bootstrap/index";
import { InitEventControllerStep } from "./bootstrap/steps/init-event-controller.step";
import { ResolveWindowKindStep } from "./bootstrap/steps/resolve-window-kind.step";

import type { Workspace } from "../layout/types";
import type { EventRouter } from "./services/event-router";

// ═══════════════════════════════════════════════════════════════════════════
// Bootstrap pipeline
// ═══════════════════════════════════════════════════════════════════════════

const context = new StartupContext();

const steps = [
  new ExposeTestModelsStep(), // 1: Expose test models for test injection
  new InitEventControllerStep(), // 2: Initialize event controller (graph + router)
  new RegisterAppTypesStep(), // 3: Register app types
  new ResolveWindowKindStep(), // 4: Resolve window kind + workspace binding
  new InitServicesStep(), // 5: Wire cross-service dependencies
  new SubscribeStateUpdatesStep(), // 6: ** Register render subscriber BEFORE any async **
  new RegisterTabActivationRecorderStep(), // 6b: Record tab activations into TabActivationHistory
  new RegisterEventListenersStep(), // 7: Document-level event listeners
  new FetchInitialStateStep(), // 8: ** Async: fetch + set state → subscriber fires → UI RENDERS **
  new LoadConfigStep(), // 9: Async: load config (cosmetic, after UI is visible)
  new RegisterShortcutsStep(), // 10: Keyboard shortcuts
  new RegisterIpcListenersStep(), // 11: Zoom + confirm IPC listeners
  new StartQuoteControllerStep(), // 12: Quote rotation
  new SignalReadyStep(), // 13: Signal readiness
];

const bootstrap = new RendererBootstrap(steps, context);

// ═══════════════════════════════════════════════════════════════════════════
// Legacy exports (for backward compat while components migrate to DI)
// ═══════════════════════════════════════════════════════════════════════════

/** @deprecated Use context.workspaceState.getWorkspace() instead. */
export function getWorkspace(): Workspace | null {
  return context.workspaceState.getWorkspace();
}

/** @deprecated Use context.commandBus.dispatch() instead. */
export function dispatch(fn: string, ...args: unknown[]) {
  context.commandBus.dispatch(fn, ...args);
}

// ─── Event Router ────────────────────────────────────────────────────

let _eventRouter: EventRouter | null = null;

/** Set the event router instance (called during bootstrap). */
export function setEventRouter(router: EventRouter): void {
  _eventRouter = router;
}

/**
 * Emit an event through the event router.
 * Components should use this instead of dispatch() for user interactions.
 * The router handles routing to handlers, which may call IPC dispatch.
 */
export function emitEvent(eventType: string, payload?: Record<string, unknown>): void {
  _eventRouter?.emit(eventType, payload ?? {});
}

/**
 * @deprecated Components should receive services via DI.
 * Legacy access for components that haven't migrated yet.
 */
export const appServices = {
  commandBus: context.commandBus,
  workspaceState: context.workspaceState,
  keyboardManager: context.keyboardManager,
  zoomService: context.zoomService,
  configService: context.configService,
  fileOpenHandler: context.fileOpenHandler,
  contextMenuBuilder: context.contextMenuBuilder,
  quoteController: context.quoteController,
  fileDropHandler: context.fileDropHandler,
  modelRegistry: context.modelRegistry,
};

// ═══════════════════════════════════════════════════════════════════════════
// App reset function (for test fast-reset)
// ═══════════════════════════════════════════════════════════════════════════

import { unmountAllControllers } from "./controllers/registry";
import { resetTabDragState } from "./services/drag-context";

import { injectGlobalTailwind } from "./services/inject-global-tailwind";

/**
 * Renderer-side teardown for app state reset.
 *
 * The reset happens in two parts across processes:
 *   1. Main process — resets OperationDispatcher state and broadcasts fresh
 *      workspace to all windows (handled by workspace:reset IPC handler).
 *   2. Renderer    — this function: cancel drags, unmount controllers, clear
 *      module-level state, remove DOM overlays.
 *
 * The main process broadcast triggers the existing onStateUpdate subscriber,
 * which calls WorkspaceStateManager.setState() and re-renders the UI.
 *
 * Used by tests to reuse a single Electron instance across scenarios.
 */
export function resetApp(): void {
  // ── Phase A: Teardown ─────────────────────────────────────────────────

  // 1. Clear tab drag state (module-level)
  resetTabDragState();

  // 4. Unmount all pane controllers and clear registry
  unmountAllControllers();

  // 5. Remove any lingering DOM overlays (ghost, indicator, context menu, confirm modal)
  document
    .querySelectorAll(
      ".openp41ge-ghost-overlay, .openp41ge-split-overlay, .openp41ge-cell-target-highlight, " +
        "" +
        "#openp41ge-confirm-mask-root, .tab-drop-indicator",
    )
    .forEach((el) => el.remove());

  // 6. Clear the #root contents (remove all openp41ge-windowview children)
  const root = document.getElementById("root");
  if (root) {
    root.innerHTML = "";
  }

  // 7. Clear any pending file/state globals
  window.__pendingFilePath = null;
  window.__pendingFileName = undefined;

  log.info("app reset complete (renderer teardown done; main process broadcast will re-render)");
}

/**
 * Wire the IPC listener so window.openp41ge.workspace.reset() triggers resetApp().
 * Called during the register-ipc-listeners bootstrap step.
 */
export function wireResetListener(): void {
  if (typeof window.openp41ge === "undefined") return;
  window.openp41ge.workspace.onReset(() => {
    resetApp();
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Singleton renderer
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// Singleton renderer
// ═══════════════════════════════════════════════════════════════════════════

export const renderer = {
  /** Start the renderer bootstrap. Returns immediately — UI renders synchronously. */
  start(): void {
    log.info("starting renderer");

    // Seed a debug session when OPENP41GE_DEBUG=1 (build) or
    // localStorage["openp41ge-debug"]="1": capture DEBUG, open the Logs window.
    if (isDebugSeed()) {
      log.info("debug session seeded by environment flag");
      setMinLevel(LogLevel.DEBUG);
      window.openp41ge?.logs?.setDebug?.(true);
      window.openp41ge?.windowManager?.openLogsWindow?.();
    }

    // Inject global Tailwind utility classes before any UI renders
    injectGlobalTailwind();

    // Install consistent global scrollbar styles before any UI renders
    installGlobalScrollbarStyles();

    // Start the bootstrap (returns a promise, but we don't await it)
    // The UI renders synchronously in the first phase of start()
    bootstrap.start().catch((err) => {
      log.error("bootstrap failed:", err);
    });
  },
};
