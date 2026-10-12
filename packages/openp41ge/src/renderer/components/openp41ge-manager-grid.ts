/**
 * openp41ge-manager-grid — the Window Manager's grid region.
 *
 * Hosted in the manager's `.wm-main`. It owns a LOCAL grid model (placements /
 * active tabs / tab data) and drives a shared `<tab-grid>` the same way
 * `openp41ge-logs-window` does — but generic: each tab is a platform *app
 * type* (grid surface) mounted via its controller factory, so the extension
 * `ext:openp41ge-extension-workspaces:workspace-editor` surface runs inside a cell with
 * its per-tab config (`{ path, dir }`).
 *
 * The manager calls `openApp(appType, config)` to open/activate a tab — from a
 * workspace row click (and, once wired, a row drag onto the grid). Workspace
 * editors open one-per-cell (a fresh column per workspace) so a drag "creates a
 * grid cell."
 *
 * The grid remembers its tabs between launches: it restores them when it
 * opens and saves them after each change (`<app-data>/manager-grid.json`,
 * see manager-grid-layout.ts). A window opened for one management tab (a
 * drag-out) does not restore them. Test seam: the static `deps`.
 */

import { html, type TemplateResult } from "lit";
import { LitElement } from "lit";
import { state } from "lit/decorators.js";
import { createLogger } from "openp41ge-core-logger";
import { getAppTypeRegistration } from "../apps/app-registry";
import { settingsTabIcon } from "./grid-tab-decorations";
import type { TabController } from "../controllers/types";
import type { TabGrid } from "../openp41ge-tabs-adapter";
import {
  MANAGER_GRID_WIN_ID,
  parseManagerGrid,
  serializeManagerGrid,
} from "../services/manager-grid-layout";
import { PlaceholderController } from "./manager-grid-placeholder";

const log = createLogger("openp41ge", "manager-grid");

const WIN_ID = MANAGER_GRID_WIN_ID;

/** After a change, how long the grid waits before saving its tabs. */
const SAVE_DELAY_MS = 250;

/** Where the grid's tabs are kept between launches. Tests replace these. */
export interface ManagerGridDeps {
  /** The saved tabs (unchecked), or null. */
  load(): Promise<unknown>;
  save(grid: unknown): Promise<void>;
}

const defaultDeps: ManagerGridDeps = {
  // A window opened for one management tab (a drag-out) starts empty.
  load: async () =>
    window.openp41ge?.workspace?.getLaunchTab?.()
      ? null
      : ((await window.openp41ge?.windowManager?.loadGrid?.()) ?? null),
  save: async (grid) => {
    await window.openp41ge?.windowManager?.saveGrid?.(grid);
  },
};

interface Placement {
  position: { row: number; col: number };
  tabIds: string[];
  activeTabId: string;
}

interface GridTab {
  id: string;
  appType: string;
  title: string;
  icon?: string;
  config: Record<string, unknown>;
  /** Pinned tabs render non-italic and ignore double-click pinning. */
  pinned?: boolean;
}

interface MountEntry {
  controller: TabController;
  container: HTMLElement;
}

/** Signature the app-type registration factory returns for manager tabs. */
type AppRegistration = ReturnType<typeof getAppTypeRegistration>;

/** A tab's prefix icon: the settings gear for a settings tab, else the given
 *  icon, else the app-type registration's (so a caller that doesn't pass one,
 *  e.g. a drop, still shows the surface's icon). */
function tabIcon(appType: string, icon: string | undefined): string | undefined {
  return settingsTabIcon(appType) ?? icon ?? getAppTypeRegistration(appType)?.icon;
}

/** Where `openApp` opens a new tab (default: the focused cell). */
export interface OpenWhere {
  /** In this cell. */
  readonly col?: number;
  /** In a new column at this cell's left or right edge. */
  readonly split?: { readonly col: number; readonly left: boolean };
}

export class Openp41geManagerGrid extends LitElement {
  static tagName = "openp41ge-manager-grid";

  /** Test seam: where the tabs are loaded from and saved to. */
  static deps: ManagerGridDeps | null = null;

  /** Column-ordered placements: `_placements[i].position.col === i`. */
  @state() private _placements: Placement[] = [];
  @state() private _tabs: GridTab[] = [];
  @state() private _activeTabIds: Record<string, string> = {};

  private _mounts = new Map<string, MountEntry>();

  /** The saved tabs have been restored: changes are saved from now on. */
  private _restored = false;
  /** The last saved (or restored) grid, as JSON: an unchanged grid is not saved. */
  private _savedJson = "";
  private _saveTimer: ReturnType<typeof setTimeout> | null = null;

  private get _deps(): ManagerGridDeps {
    return Openp41geManagerGrid.deps ?? defaultDeps;
  }

  /** The cell last focused (a tab or its content clicked, or a tab opened
   *  there): where a preview replaces the preview tab. Starts at the first
   *  cell, the one <tab-grid> shows focused, so a restored grid has one. */
  private _focusedCol = 0;

  // ── Public API ──────────────────────────────────────────────────────

  /**
   * Open (or focus) an app in the grid. A tab already open for
   * `config.path` is activated (and pinned when asked). Otherwise the tab
   * opens where `where` says — a new column at a cell's edge (`split`), or in
   * a cell (`col`) — or, by default, in the focused cell: a preview replaces
   * that cell's preview tab, if it has one, else joins the cell. Only an
   * empty grid (or a missing cell) gets a new column. The tab's cell becomes
   * the focused one.
   */
  openApp(
    appType: string,
    title: string,
    config: Record<string, unknown>,
    icon?: string,
    pinned = false,
    where: OpenWhere = {},
  ): void {
    const existing = this._findByKey(config);
    if (existing) {
      // Re-opening with a pin request promotes an existing (preview) tab. A
      // `pinned: false` open never unpins — it just activates the tab.
      if (pinned && !existing.pinned) {
        this._tabs = this._tabs.map((t) => (t.id === existing.id ? { ...t, pinned: true } : t));
      }
      this._activate(existing);
      return;
    }
    const tab: GridTab = {
      id: crypto.randomUUID(),
      appType,
      title,
      icon: tabIcon(appType, icon),
      config: { ...config },
      pinned,
    };
    const boxes = this._placements.map((p) => ({
      tabIds: [...p.tabIds],
      activeTabId: p.activeTabId,
    }));
    let replaced: string | undefined;
    let col: number;
    if (where.split) {
      const at = where.split.left ? where.split.col : where.split.col + 1;
      col = Math.max(0, Math.min(at, boxes.length));
      boxes.splice(col, 0, { tabIds: [tab.id], activeTabId: tab.id });
    } else {
      col = where.col ?? this._focusedCol;
      const box = boxes[col];
      if (!box) {
        col = boxes.length;
        boxes.push({ tabIds: [tab.id], activeTabId: tab.id });
      } else {
        replaced = pinned
          ? undefined
          : box.tabIds.find((id) => this._tabs.find((t) => t.id === id)?.pinned === false);
        box.tabIds = replaced
          ? box.tabIds.map((id) => (id === replaced ? tab.id : id))
          : [...box.tabIds, tab.id];
        box.activeTabId = tab.id;
      }
    }
    if (replaced) this._release(replaced);
    this._tabs = [...this._tabs.filter((t) => t.id !== replaced), tab];
    this._focusedCol = col;
    this._applyBoxes(boxes);
    this.requestUpdate();
  }

  /** Whether any tabs are open. */
  get hasTabs(): boolean {
    return this._tabs.length > 0;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    // Close buttons in each tab-bar bubble a click; `tab-grid` ignores them so
    // the owning component removes the tab (mirrors openp41ge-tabs-event-handler).
    // The tab-grid lives in this element's shadow root, so listen there.
    this.renderRoot?.addEventListener?.("click", this._onClick);
    window.addEventListener("pagehide", this._flushSave);
    void this._restore();
  }

  /** Reopen the saved tabs (before any opened meanwhile), then start saving. */
  private async _restore(): Promise<void> {
    let raw: unknown = null;
    try {
      raw = await this._deps.load();
    } catch (err) {
      log.debug("manager-grid saved tabs could not be loaded", err);
    }
    const saved = parseManagerGrid(raw);
    if (saved && saved.columns.length > 0) {
      const tabs: GridTab[] = [];
      const restored: Placement[] = saved.columns.map((c) => {
        const ids = c.tabs.map((t) => {
          const tab: GridTab = {
            id: crypto.randomUUID(),
            appType: t.appType,
            title: t.title,
            icon: tabIcon(t.appType, t.icon),
            config: { ...t.config },
            pinned: t.pinned,
          };
          tabs.push(tab);
          return tab.id;
        });
        return { position: { row: 0, col: 0 }, tabIds: ids, activeTabId: ids[c.active] ?? ids[0] };
      });
      this._tabs = [...tabs, ...this._tabs];
      this._setPlacements([
        ...restored,
        ...this._placements.map((p) => ({
          ...p,
          position: { row: 0, col: p.position.col + restored.length },
        })),
      ]);
      this._reconcileActives();
      void this._mountControllers();
    }
    this._savedJson = JSON.stringify(serializeManagerGrid(this._placements, this._tabs));
    this._restored = true;
  }

  /** Save the tabs soon (after a change). */
  private _scheduleSave(): void {
    if (!this._restored) return;
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(this._flushSave, SAVE_DELAY_MS);
  }

  /** Save the tabs now, if they changed since the last save. */
  private _flushSave = (): void => {
    if (this._saveTimer) clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (!this._restored) return;
    const grid = serializeManagerGrid(this._placements, this._tabs);
    const json = JSON.stringify(grid);
    if (json === this._savedJson) return;
    this._savedJson = json;
    void this._deps.save(grid).catch((err: unknown) => {
      log.debug("manager-grid tabs could not be saved", err);
    });
  };

  override updated(changed: Map<string, unknown>): void {
    super.updated(changed);
    if (changed.has("_tabs") || changed.has("_placements")) {
      this._scheduleSave();
      this.dispatchEvent(
        new CustomEvent("manager-grid-change", {
          detail: { hasTabs: this._tabs.length > 0 },
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  override disconnectedCallback(): void {
    this.renderRoot?.removeEventListener?.("click", this._onClick);
    window.removeEventListener("pagehide", this._flushSave);
    this._flushSave();
    this._disposeAll();
    super.disconnectedCallback();
  }

  // ── Grid model helpers ──────────────────────────────────────────────

  private _findByKey(config: Record<string, unknown>): GridTab | undefined {
    const key = config.path;
    if (typeof key !== "string" || key === "") return undefined;
    return this._tabs.find((t) => t.config.path === key);
  }

  private _activate(tab: GridTab): void {
    const col = this._placements.findIndex((p) => p.tabIds.includes(tab.id));
    if (col < 0) return;
    this._focusedCol = col;
    this._placements = this._placements.map((p, i) =>
      i === col ? { ...p, activeTabId: tab.id } : p,
    );
    this._activeTabIds = { ...this._activeTabIds, [String(col)]: tab.id };
    void this._mountControllers();
  }

  /** Sort placements by column and renumber so `[i].position.col === i` (the
   *  invariant <tab-grid>'s drop targets rely on). */
  private _setPlacements(placements: Placement[]): void {
    const sorted = [...placements].sort((a, b) => a.position.col - b.position.col);
    this._placements = sorted.map((p, i) => ({
      position: { row: 0, col: i },
      tabIds: [...p.tabIds],
      activeTabId: p.activeTabId ?? p.tabIds[0] ?? "",
    }));
  }

  private _removeTab(tabId: string): void {
    const tab = this._tabs.find((t) => t.id === tabId);
    let placements = this._placements
      .map((p) => ({
        ...p,
        tabIds: p.tabIds.filter((id) => id !== tabId),
        activeTabId:
          p.activeTabId === tabId ? (p.tabIds.find((id) => id !== tabId) ?? "") : p.activeTabId,
      }))
      .filter((p) => p.tabIds.length > 0);
    if (placements.length === 0) placements = [];
    this._setPlacements(placements);
    this._tabs = this._tabs.filter((t) => t.id !== tabId);
    this._release(tabId);
    this._reconcileActives();
    void this._mountControllers();
    if (tab) log.debug("manager-grid tab removed", { tabId, appType: tab.appType });
  }

  private _reconcileActives(): void {
    const next: Record<string, string> = {};
    for (const p of this._placements) {
      const active =
        p.activeTabId && p.tabIds.includes(p.activeTabId) ? p.activeTabId : p.tabIds[0];
      next[String(p.position.col)] = active ?? "";
    }
    this._activeTabIds = next;
  }

  // ── Grid event handlers ─────────────────────────────────────────────

  private _onClick = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    const close = target?.closest?.(".tab-close[data-close-tab-id]") as HTMLElement | null;
    if (!close) return;
    const tabId = close.getAttribute("data-close-tab-id") ?? "";
    if (!tabId) return;
    e.preventDefault();
    e.stopPropagation();
    this._removeTab(tabId);
  };

  private _onGridRemove = (e: Event): void => {
    const tabId = (e as CustomEvent).detail?.tabId as string | undefined;
    if (tabId) this._removeTab(tabId);
  };

  private _onGridActivate = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    const col =
      typeof detail.col === "number"
        ? detail.col
        : this._placements.findIndex((p) => p.tabIds.includes(tabId));
    if (col < 0) return;
    this._focusedCol = col;
    this._placements = this._placements.map((p, i) =>
      i === col ? { ...p, activeTabId: tabId } : p,
    );
    this._activeTabIds = { ...this._activeTabIds, [String(col)]: tabId };
    void this._mountControllers();
  };

  /** A click in a cell's content focuses that cell. */
  private _onGridFocusCol = (e: Event): void => {
    const col = (e as CustomEvent).detail?.col;
    if (typeof col === "number" && col >= 0) this._focusedCol = col;
  };

  private _onGridMove = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._moveTab(tabId, Number(detail.targetCol) || 0);
  };

  private _onGridSplit = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._splitTab(tabId, Number(detail.splitCol) || 0, Boolean(detail.splitLeft));
  };

  private _onReorder = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    this._reorder(Number(detail.col) || 0, Number(detail.fromIndex), Number(detail.toIndex));
  };

  private _onMoveCell = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabId = detail.tabId as string | undefined;
    if (!tabId) return;
    this._moveTab(tabId, Number(detail.targetCol) || 0);
  };

  /** An `open-tab` drag (workspace row) landed on the grid: open a workspace
   *  editor cell for it. `GridDropTarget` fires `grid-open-tab` with
   *  `tabType` = the source's `appType` and `tabConfig` = its target path. */
  private _onGridOpenTab = (e: Event): void => {
    const detail = (e as CustomEvent).detail ?? {};
    const tabType = detail.tabType as string | undefined;
    if (!tabType) return;
    const config = (detail.tabConfig as Record<string, unknown> | undefined) ?? {};
    const title = (detail.title as string | undefined) ?? "Workspace editor";
    const pinned = Boolean(detail.pinned);
    // Where it landed: a cell's edge (a new column) or a cell.
    const where: OpenWhere = detail.isBoundary
      ? { split: { col: Number(detail.splitCol) || 0, left: Boolean(detail.splitLeft) } }
      : typeof detail.targetCol === "number"
        ? { col: detail.targetCol }
        : {};
    // Consume the event here so the app-wide grid handler (openp41ge-tabs-…
    // event-handler) doesn't try to open an unknown app type as a file.
    e.stopPropagation();
    this.openApp(tabType, title, config, undefined, pinned, where);
  };

  private _moveTab(tabId: string, targetCol: number): void {
    const from = this._placements.findIndex((p) => p.tabIds.includes(tabId));
    if (from < 0) return;
    const target = Math.max(0, Math.min(targetCol, this._placements.length - 1));
    if (from === target) return;
    const boxes = this._placements.map((p) => ({
      tabIds: [...p.tabIds],
      activeTabId: p.activeTabId,
    }));
    boxes.splice(from, 1);
    if (boxes[target]) {
      // Insert before the existing column's first tab (move into the column).
      boxes[target].tabIds.unshift(tabId);
      boxes[target].activeTabId = tabId;
    } else {
      boxes.splice(target, 0, { tabIds: [tabId], activeTabId: tabId });
    }
    this._applyBoxes(boxes);
  }

  private _splitTab(tabId: string, splitCol: number, splitLeft: boolean): void {
    const from = this._placements.findIndex((p) => p.tabIds.includes(tabId));
    if (from < 0) return;
    const boxes = this._placements.map((p) => ({
      tabIds: [...p.tabIds],
      activeTabId: p.activeTabId,
    }));
    const idx = boxes[from].tabIds.indexOf(tabId);
    if (idx >= 0) boxes[from].tabIds.splice(idx, 1);
    const at = Math.max(0, Math.min(splitLeft ? splitCol : splitCol + 1, boxes.length));
    boxes.splice(at, 0, { tabIds: [tabId], activeTabId: tabId });
    this._applyBoxes(boxes);
  }

  private _reorder(col: number, from: number, to: number): void {
    const p = this._placements[col];
    if (!p) return;
    const boxes = this._placements.map((pl) => ({
      tabIds: [...pl.tabIds],
      activeTabId: pl.activeTabId,
    }));
    const ids = boxes[col].tabIds;
    if (from >= 0 && from < ids.length && to >= 0 && to <= ids.length) {
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
    }
    this._applyBoxes(boxes);
  }

  private _applyBoxes(boxes: Array<{ tabIds: string[]; activeTabId: string }>): void {
    const placements = boxes
      .filter((b) => b.tabIds.length > 0)
      .map((b, i) => ({
        position: { row: 0, col: i },
        tabIds: [...b.tabIds],
        activeTabId:
          b.activeTabId && b.tabIds.includes(b.activeTabId) ? b.activeTabId : b.tabIds[0],
      }));
    this._setPlacements(placements);
    this._reconcileActives();
    void this._mountControllers();
  }

  // ── Controller mounting ─────────────────────────────────────────────

  private _grid(): TabGrid | null {
    const grid = this.renderRoot?.querySelector("tab-grid");
    return grid ? (grid as unknown as TabGrid) : null;
  }

  private async _mountControllers(): Promise<void> {
    const grid = this._grid();
    if (!grid) return;
    try {
      await (grid as unknown as { updateComplete: Promise<void> }).updateComplete;
      const contents = grid.querySelectorAll("tab-content");
      await Promise.all(
        Array.from(contents).map(
          (tc) => (tc as unknown as { updateComplete: Promise<void> }).updateComplete,
        ),
      );
    } catch (err) {
      log.debug("manager-grid update-complete wait failed; skipping", err);
    }
    for (const p of this._placements) {
      for (const tabId of p.tabIds) {
        const tab = this._tabs.find((t) => t.id === tabId);
        if (!tab) continue;
        const entry = this._ensureMount(tab);
        grid.mountController(tabId, entry.container);
        const isActive = tabId === (p.activeTabId ?? p.tabIds[0]);
        entry.container.style.display = isActive ? "" : "none";
        entry.controller.setVisible(isActive);
      }
    }
  }

  private _ensureMount(tab: GridTab): MountEntry {
    let entry = this._mounts.get(tab.id);
    if (entry) return entry;
    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    const reg = getAppTypeRegistration(tab.appType) as AppRegistration | undefined;
    const controller =
      reg?.createController(tab.id) ??
      (new PlaceholderController(tab.id, tab.appType) as TabController);
    controller.restore(tab.config);
    controller.mount(container);
    // Preview tabs (unpinned) are promoted to permanent on the first user
    // interaction with the surface — editing or clicking in the editor pins
    // the tab (VS Code preview model). The listeners live on the per-tab
    // container, so they are torn down with it on close (`_release`).
    if (!tab.pinned) {
      const pin = (): void => this._pinTab(tab.id);
      container.addEventListener("pointerdown", pin);
      container.addEventListener("keydown", pin);
      container.addEventListener("input", pin);
      container.addEventListener("change", pin);
    }
    entry = { controller, container };
    this._mounts.set(tab.id, entry);
    return entry;
  }

  /** Promote a preview (unpinned) tab to a permanent tab, in place. */
  private _pinTab(tabId: string): void {
    const tab = this._tabs.find((t) => t.id === tabId);
    if (!tab || tab.pinned) return;
    this._tabs = this._tabs.map((t) => (t.id === tabId ? { ...t, pinned: true } : t));
  }

  private _release(tabId: string): void {
    const entry = this._mounts.get(tabId);
    if (!entry) return;
    entry.container.parentNode?.removeChild(entry.container);
    try {
      entry.controller.unmount();
    } catch (err) {
      log.debug("controller unmount failed", { tabId }, err);
    }
    this._mounts.delete(tabId);
  }

  private _disposeAll(): void {
    for (const id of Array.from(this._mounts.keys())) this._release(id);
  }

  // ── Render ──────────────────────────────────────────────────────────

  private _tabData(): Record<
    string,
    { title: string; content: string; pinned: boolean; icon?: string }
  > {
    const data: Record<string, { title: string; content: string; pinned: boolean; icon?: string }> =
      {};
    for (const t of this._tabs)
      data[t.id] = { title: t.title, content: "", pinned: t.pinned ?? true, icon: t.icon };
    return data;
  }

  override render(): TemplateResult {
    const cols = Math.max(this._placements.length, 1);
    return html`
      <style>
        :host {
          display: block;
          position: relative;
          width: 100%;
          height: 100%;
        }
      </style>
      <tab-grid
        .winId=${WIN_ID}
        .cols=${cols}
        .placements=${this._placements}
        .tabData=${this._tabData()}
        .activeTabIds=${this._activeTabIds}
        .barShowAdd=${false}
        .edgeLeft=${true}
        .edgeRight=${true}
        @grid-activate=${this._onGridActivate}
        @grid-move=${this._onGridMove}
        @grid-split=${this._onGridSplit}
        @grid-remove=${this._onGridRemove}
        @grid-open-tab=${this._onGridOpenTab}
        @grid-focus-col=${this._onGridFocusCol}
        @tab-bar-reorder=${this._onReorder}
        @tab-bar-move-cell=${this._onMoveCell}
      ></tab-grid>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-manager-grid": Openp41geManagerGrid;
  }
}

customElements.define(Openp41geManagerGrid.tagName, Openp41geManagerGrid);
