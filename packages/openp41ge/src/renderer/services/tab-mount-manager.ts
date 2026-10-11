/**
 * TabMountManager — manages controller lifecycle for tab content.
 *
 * Controllers are mounted into `<tab-grid>` via its built-in `mountController`
 * API, which places them into `<tab-content>` controller slots. The
 * `<tab-content>` component handles show/hide based on `activeTabId`, so
 * no MutationObserver or manual injection is needed.
 *
 * Lifecycle per tab:
 *   createController → mount container into grid DOM → mount controller
 *
 * IMPORTANT: The container MUST be connected to the document DOM before
 * calling controller.mount(), because Lit custom elements (like <file-editor>)
 * require DOM connection for firstUpdated() to fire. Without it, internal
 * elements like _viewportEl are never created.
 */

import { createLogger } from "openp41ge-core-logger";
import { getAppTypeRegistration } from "../apps/app-registry";
import type { TabController } from "../controllers/types";
import type { Workspace, Tab } from "../../layout/types";
import type { TabGrid } from "../openp41ge-tabs-adapter";

const log = createLogger("openp41ge", "tab-mount-manager");

interface MountEntry {
  controller: TabController;
  container: HTMLElement;
}

export class TabMountManager {
  /** tabId → controller + container */
  private _mounts = new Map<string, MountEntry>();

  /** Lookup function imported directly — reads from window-shared Map. */
  private _getRegistration = getAppTypeRegistration;

  /**
   * Sync controller containers with the current workspace state.
   * Call after every grid render (from SubscribeStateUpdatesStep).
   *
   * Waits for the grid's Lit updateComplete to ensure
   * [data-tab-id] elements exist before mounting controllers.
   */
  async sync(workspace: Workspace, windowId: string): Promise<void> {
    const win = workspace.windows.find((w) => w.id === windowId);
    if (!win) return;

    const grid = this._findGrid();

    // Wait for the grid to finish rendering so [data-tab-id] elements exist
    if (grid && "updateComplete" in grid) {
      await (grid as unknown as { updateComplete: Promise<void> }).updateComplete;
      // Also wait for all <tab-content> children to finish their Lit updates.
      // grid.updateComplete only waits for the grid element itself, but
      // <tab-content> elements are queued for update during the grid's render
      // and may still be pending. Without this await, mountController queries
      // stale DOM with old data-tab-id placements and appends to controller
      // divs that will be removed when tab-content finally re-renders.
      const tabContents = document.querySelectorAll("tab-content");
      await Promise.all(
        Array.from(tabContents).map(
          (tc) => (tc as unknown as { updateComplete: Promise<void> }).updateComplete,
        ),
      );
    }

    const allCurrentTabIds = new Set<string>();

    for (const placement of win.grid.placements) {
      const col = placement.position.col;
      const activeTabId = placement.activeTabId ?? placement.tabIds[0] ?? "";

      for (const tabId of placement.tabIds) {
        allCurrentTabIds.add(tabId);
        const tab = workspace.editorTabs[tabId as keyof typeof workspace.editorTabs] as
          Tab | undefined;
        if (!tab) continue;

        // A mount/restore failure for one tab must never abort the sync — the
        // remaining placements would then never get their controllers.
        let entry: MountEntry | undefined;
        try {
          entry = this._getOrCreateEntry(tab, workspace, grid, tabId);
        } catch (err) {
          log.error("mount sync failed for tab, skipping", { tabId }, err);
          continue;
        }
        if (!entry) continue;

        // Re-mount the controller container on every sync. This ensures
        // that when the grid re-renders (e.g., tab moved to another column),
        // the container is re-parented to the correct column's tab-content
        // controller slot. mountController() is idempotent — it only appends
        // if the container isn't already a child.
        if (grid) {
          grid.mountController(tabId, entry.container);
        } else {
          // Legacy fallback: inject into grid cell directly
          this._injectIntoCell(entry.container, col);
        }

        // Show/hide based on active state
        const isActive = tabId === activeTabId;
        entry.container.style.display = isActive ? "" : "none";
        if (isActive) {
          entry.controller.setVisible(true);
        } else {
          entry.controller.setVisible(false);
        }
      }
    }

    // Remove tabs that no longer exist
    this._removeOrphans(allCurrentTabIds);
  }

  /**
   * Get a controller for a tab ID, creating it if needed.
   */
  getController(tabId: string): TabController | undefined {
    return this._mounts.get(tabId)?.controller;
  }

  /**
   * Show the container for a specific tab (called on grid-activate).
   * Hides siblings in the same parent, shows the target tab.
   */
  activateTab(tabId: string): void {
    const entry = this._mounts.get(tabId);
    if (!entry) return;

    // Hide siblings in the same parent
    const parent = entry.container.parentElement;
    if (parent) {
      for (const child of parent.children) {
        if (child instanceof HTMLElement && child !== entry.container) {
          child.style.display = "none";
        }
      }
    }

    entry.container.style.display = "";
    log.debug("controller-visible", { tabId, appType: entry.controller.appType });
    entry.controller.setVisible(true);
  }

  /**
   * Clean up all mounts (on destroy).
   */
  destroy(): void {
    for (const [, entry] of this._mounts) {
      log.debug("controller-unmount", {
        tabId: entry.controller.tabId,
        appType: entry.controller.appType,
        reason: "destroy",
      });
      entry.controller.unmount();
      entry.container.remove();
    }
    this._mounts.clear();
  }

  // ── Private helpers ─────────────────────────────────────────────

  /** Legacy: inject container into a grid cell. Used when <tab-grid> isn't available. */
  private _injectIntoCell(container: HTMLElement, col: number): void {
    const cell = this._findGridCell(col);
    if (!cell) return;
    if (container.parentElement !== cell) {
      cell.appendChild(container);
    }
  }

  /** Legacy: find a grid cell element. */
  private _findGridCell(col: number): HTMLElement | null {
    const grid = document.querySelector("tab-grid");
    if (!grid) return null;
    return grid.querySelector(`.grid-cell[data-cell-col="${col}"]`);
  }

  private _findGrid(): TabGrid | null {
    const grid = document.querySelector("tab-grid");
    if (!grid) return null;
    const tg = grid as unknown as TabGrid;
    if (typeof tg.mountController !== "function") return null;
    return tg;
  }

  /**
   * Get or create a mount entry for a tab.
   *
   * The container + controller are created here but controller.mount()
   * is NOT called until the container is connected to the DOM (in sync()).
   * This ensures Lit custom elements get their connectedCallback.
   */
  private _getOrCreateEntry(
    tab: Tab,
    _workspace: Workspace,
    grid: TabGrid | null,
    tabId: string,
  ): MountEntry | undefined {
    const existing = this._mounts.get(tab.id);
    if (existing) return existing;

    const reg = this._getRegistration(tab.appType);
    if (!reg) return undefined;

    const controller = reg.createController(tab.id);

    // Restore saved state if available
    if (tab.config && typeof tab.config === "object") {
      const config = tab.config as Record<string, unknown>;
      log.debug("controller-restore", { tabId: tab.id, appType: tab.appType });
      controller.restore({ ...config });
    }

    const container = document.createElement("div");
    container.dataset.tabId = tab.id;
    container.style.cssText = [
      "flex:1",
      "min-height:0",
      "overflow:hidden",
      "position:relative",
    ].join(";");

    // Attach container to grid DOM BEFORE controller.mount() so Lit
    // lifecycle (connectedCallback / firstUpdated) fires for custom elements
    // like <file-editor> that the controller creates during mount().
    let mounted = false;
    if (grid) {
      mounted = grid.mountController(tabId, container);
    }
    if (!mounted) {
      // mountController failed — fall back to appending container to grid
      const gridEl = document.querySelector("tab-grid");
      const controllerDiv = gridEl?.querySelector(".tab-content-controller");
      if (controllerDiv) {
        controllerDiv.appendChild(container);
        mounted = true;
      }
    }

    // NOW mount the controller — Lit lifecycle will fire for any elements
    // created inside mount() since the container is in the DOM.
    log.debug("controller-mount", { tabId: tab.id, appType: tab.appType });
    try {
      controller.mount(container);
    } catch (err) {
      // A failing mount must not poison the sync: remove the half-mounted
      // container so no orphan/duplicate accumulates on later syncs, and skip
      // this tab. Without this, one bad tab would (a) abort mounting for every
      // later tab and (b) leave the unregistered container behind to be
      // re-created (duplicated) on the next sync.
      container.remove();
      log.error("controller-mount failed, skipping tab", {
        tabId: tab.id,
        appType: tab.appType,
      }, err);
      return undefined;
    }

    const entry: MountEntry = { controller, container };
    this._mounts.set(tab.id, entry);
    return entry;
  }

  private _removeOrphans(currentTabIds: Set<string>): void {
    for (const [tabId, entry] of this._mounts) {
      if (!currentTabIds.has(tabId)) {
        log.debug("controller-unmount", {
          tabId,
          appType: entry.controller.appType,
          reason: "orphan",
        });
        entry.controller.unmount();
        entry.container.remove();
        this._mounts.delete(tabId);
      }
    }
  }
}
