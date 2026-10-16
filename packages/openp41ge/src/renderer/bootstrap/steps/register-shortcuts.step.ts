/**
 * Register keyboard shortcuts with the KeyboardManager.
 *
 * All keyboard bindings are registered here. New shortcuts should be added
 * by registering with the keyboardManager, not by adding switch cases.
 */

import type { IStartupStep } from "../startup-step";
import type { StartupContext } from "../startup-context";
import { emitEvent } from "../../app";
import { resolveCmdWTarget } from "../../services/cmd-w-target";
import { showOpenPalette } from "../../services/open-palette/show";
import { createLogger } from "openp41ge-core-logger";

const log = createLogger("openp41ge", "register-shortcuts");

export class RegisterShortcutsStep implements IStartupStep {
  readonly name = "register-shortcuts";

  async run(context: StartupContext): Promise<void> {
    const km = context.keyboardManager;

    // ── Open ────────────────────────────────────────────────────────
    // Cmd+N: the open palette. A new window is Cmd+Shift+N (the Window
    // menu's accelerator).
    km.register({
      modifiers: 8, // Meta
      key: "n",
      code: "KeyN",
      handler: () => showOpenPalette(km, () => context.workspaceState.getWorkspace()),
      description: "Open…",
      category: "Tab",
    });

    // ── Tab ─────────────────────────────────────────────────────────
    // Cmd+T for new tab/workset is removed — will be replaced with something else.
    // Keeping the IPC handler for backward compat but the keyboard shortcut is unbound.
    // km.register({ modifiers: 8, key: "t", code: "KeyT", handler: () => window.openp41ge.workspace.cmdNewTab(), description: "New Tab", category: "Tab" });

    km.register({
      modifiers: 8,
      key: "w",
      code: "KeyW",
      handler: () => {
        try {
          const ws = context.workspaceState.getWorkspace();
          const myWindowId = window.openp41ge?.workspace?.getWindowId?.();
          if (!myWindowId) return;

          // Cmd+W closes the grid tab the user is CURRENTLY focused on (the
          // active tab of the focused column). When no grid tabs remain, close
          // the window. Sidebar (system) tabs are never closed by Cmd+W. The
          // closed tab stays in the activation log (only skipped when
          // navigating).
          const target = resolveCmdWTarget(ws, myWindowId);
          if (!target) return;
          if (target.kind === "close-window") {
            window.openp41ge.window.close();
            return;
          }
          emitEvent("tab-remove-from-cell", {
            windowId: myWindowId,
            paneId: target.tabId,
          });
          // The closed tab stays in the activation log (it is only skipped when
          // navigating); the tab-remove-from-cell reducer updates the grid.
        } catch (err) {
          log.error("Cmd+W handler error:", err, { skipToast: true });
        }
      },
      description: "Close Tab",
      category: "Tab",
    });

    // ── View: Sidebar toggles ───────────────────────────────────────
    // Cmd+B toggles the primary (right) sidebar
    km.register({
      modifiers: 8,
      key: "b",
      code: "KeyB",
      handler: () => {
        try {
          const myWindowId = window.openp41ge?.workspace?.getWindowId?.();
          if (!myWindowId) return;
          emitEvent("sidebar-toggle", { windowId: myWindowId, side: "right" });
        } catch (_err) {
          // ignore
        }
      },
      description: "Toggle Right Sidebar",
      category: "View",
    });

    // Cmd+Option+B toggles the secondary (left) sidebar
    km.register({
      modifiers: 10,
      key: "b",
      code: "KeyB",
      handler: () => {
        try {
          const myWindowId = window.openp41ge?.workspace?.getWindowId?.();
          if (!myWindowId) return;
          emitEvent("sidebar-toggle", { windowId: myWindowId, side: "left" });
        } catch (_err) {
          // ignore
        }
      },
      description: "Toggle Left Sidebar",
      category: "View",
    });

    // Cmd+Shift+H opens Git History Search in the right sidebar
    km.register({
      modifiers: 12,
      key: "h",
      code: "KeyH",
      handler: () => {
        try {
          const myWindowId = window.openp41ge?.workspace?.getWindowId?.();
          if (!myWindowId) return;
          emitEvent("sidebar-open", { windowId: myWindowId, side: "right", appType: "" });
          emitEvent("tab-open-system", {
            windowId: myWindowId,
            side: "right",
            appType: "ext:openp41ge-extension-git:history-search",
            title: "Git History Search",
          });
        } catch (_err) {
          // ignore
        }
      },
      description: "Open Git History Search",
      category: "View",
    });

    // ── View: Zoom ──────────────────────────────────────────────────
    const zoomIn = () => context.zoomService.zoomIn();

    km.register({
      modifiers: 12, // Meta + Shift
      key: "+",
      code: "Equal",
      handler: zoomIn,
      description: "Zoom In",
      category: "View",
    });
    km.register({
      modifiers: 12,
      key: "=",
      code: "Equal",
      handler: zoomIn,
      description: "Zoom In",
      category: "View",
    });
    km.register({
      modifiers: 8,
      key: "=",
      code: "Equal",
      handler: zoomIn,
      description: "Zoom In",
      category: "View",
    });

    km.register({
      modifiers: 8,
      key: "-",
      code: "Minus",
      handler: () => context.zoomService.zoomOut(),
      description: "Zoom Out",
      category: "View",
    });
    km.register({
      modifiers: 8,
      key: "_",
      code: "Minus",
      handler: () => context.zoomService.zoomOut(),
      description: "Zoom Out",
      category: "View",
    });

    km.register({
      modifiers: 8,
      key: "0",
      code: "Digit0",
      handler: () => context.zoomService.zoomReset(),
      description: "Reset Zoom",
      category: "View",
    });

    // ── File: Save ──────────────────────────────────────────────────
    const handleSave = () => {
      try {
        // handleCmdS — save file (dispatches via command bus)
        emitEvent("file-save-active", {});
      } catch (err) {
        log.error("Save handler error:", err, { skipToast: true });
      }
    };

    km.register({
      modifiers: 8,
      key: "s",
      code: "KeyS",
      handler: handleSave,
      description: "Save File",
      category: "File",
    });
    km.register({
      modifiers: 1, // Ctrl
      key: "s",
      code: "KeyS",
      handler: handleSave,
      description: "Save File",
      category: "File",
    });

    // ── Global keydown listener ─────────────────────────────────────
    document.addEventListener("keydown", (e) => {
      km.handleKeyDown(e);
    });

    log.info("keyboard shortcuts registered");
  }
}
