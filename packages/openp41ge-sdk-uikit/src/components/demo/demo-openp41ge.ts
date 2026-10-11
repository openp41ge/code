/**
 * <demo-openp41ge> — fake window component for the grid layout system.
 *
 * Renders a mock window with grid columns, tab bars, content areas, and
 * optional ghost indicators (blue overlays), sidebar explorer tree, and
 * window chrome (traffic light buttons). Accepts props to configure
 * the layout for demos, storyboards, and the empty-state carousel.
 *
 * Uses inline tab-bar and content rendering (not the real <tab-bar>) to keep
 * the demo lightweight and dependency-free.
 */

import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";

export interface TabDef {
  id: string;
  title: string;
}

export interface ColumnPlacement {
  col: number;
  tabs: TabDef[];
}

export class DemoOpenp41ge extends LitElement {
  /** A label shown in the window title bar (optional). */
  @property({ type: String }) title: string = "";
  /** Number of columns in the grid. */
  @property({ type: Number }) cols: number = 1;

  /** Tabs per column. */
  @property({ type: Array }) placements: ColumnPlacement[] = [];

  /** Active tab ID (optional, highlighted). */
  @property({ type: String }) activeTab: string = "";

  /** Column index to show a ghost overlay in the content area. */
  @property({ type: Number, attribute: "ghost-col" }) ghostCol: number = -1;

  /** Column boundary index to show a blue split line. 0 = left edge, cols = right edge. */
  @property({ type: Number, attribute: "ghost-boundary-index" }) ghostBoundaryIndex: number = -1;

  /** Column whose tab bar gets a blue ghost indicator (vertical bar). */
  @property({ type: Number, attribute: "ghost-tabbar-col" }) ghostTabBarCol: number = -1;

  /** Position of ghost indicator within the tab bar (px offset from left). */
  @property({ type: Number, attribute: "ghost-tabbar-offset" }) ghostTabBarOffset: number = 0;

  /** Show/hide sidebar tree panel on the right. */
  @property({ type: Boolean }) sidebar: boolean = false;

  /** Show/hide window traffic-light buttons on the grid. */
  @property({ type: Boolean, attribute: "window-chrome" }) windowChrome: boolean = false;

  createRenderRoot() {
    return this;
  }

  private _getTabsForCol(col: number): TabDef[] {
    const p = this.placements.find((pl) => pl.col === col);
    return p ? p.tabs : [];
  }

  render() {
    return html`
      <div
        style="position:relative;width:100%;height:100%;background:#1e1e1e;border-radius:3px;border:1px solid #444;display:flex;flex-direction:column;overflow:hidden;"
      >
        <!-- Title bar -->
        <div
          style="display:flex;align-items:center;height:24px;background:#2a2a2a;border-bottom:1px solid #333;padding:0 8px;flex-shrink:0;"
        >
          <svg width="30" height="14" viewBox="0 0 30 14" style="flex-shrink:0;">
            <circle cx="8" cy="7" r="3" fill="#555" />
            <circle cx="17" cy="7" r="3" fill="#555" />
            <circle cx="26" cy="7" r="3" fill="#555" />
          </svg>
        </div>
        <!-- Grid area -->
        <div style="display:flex;flex-direction:row;flex:1;overflow:hidden;position:relative;">
          ${Array.from({ length: this.cols }, (_, i) => this._renderColumn(i))}
          <!-- Sidebar (right side) -->
          ${this.sidebar ? this._renderSidebar() : ""}
          <!-- Ghost split overlay (full column boundary) -->
          ${this.ghostBoundaryIndex >= 0 ? this._renderGhostBoundary() : ""}
        </div>
      </div>
    `;
  }

  private _renderColumn(colIndex: number): unknown {
    const tabs = this._getTabsForCol(colIndex);
    const isLast = colIndex === this.cols - 1 && !this.sidebar;
    const colWidth = this._getColWidth(colIndex);

    return html`
      <div
        style="display:flex;flex-direction:column;flex:${colWidth};min-width:0;border-right:${isLast ? "none" : "1px solid #333"};position:relative;"
      >
        <!-- Tab bar -->
        <div
          style="display:flex;align-items:center;height:30px;background:#2a2a2a;padding:0 4px;gap:4px;position:relative;flex-shrink:0;"
        >
          ${tabs.map((tab) => this._renderTab(tab))}
          <!-- Ghost indicator in tab bar (matches real tab-bar-drop-target) -->
          ${
            this.ghostTabBarCol === colIndex
              ? html`<div
                  style="position:absolute;left:${this.ghostTabBarOffset}px;top:4px;bottom:4px;width:2px;background:rgb(74,158,255);pointer-events:none;z-index:10;"
                ></div>`
              : ""
          }
        </div>

        <!-- Tab bar bottom separator -->
        <div style="height:4px;flex-shrink:0;background:#2a2a2a;"></div>
        <!-- Content area -->
        <div style="flex:1;background:#1e1e1e;position:relative;overflow:hidden;">
          <!-- Ghost overlay on content (matches real ghost-manager column highlight) -->
          ${
            this.ghostCol === colIndex
              ? html`<div
                  style="position:absolute;inset:0;box-shadow:inset 0 0 0 1px rgba(74,158,255,0.35);background:rgba(74,158,255,0.08);pointer-events:none;z-index:5;"
                ></div>`
              : ""
          }
          <!-- Content lines -->
          <div style="padding:12px 14px;display:flex;flex-direction:column;gap:8px;">
            <div style="width:60%;height:3px;border-radius:1px;background:#555;opacity:0.5;"></div>
            <div style="width:40%;height:3px;border-radius:1px;background:#444;opacity:0.4;"></div>
            <div style="width:75%;height:3px;border-radius:1px;background:#555;opacity:0.3;"></div>
          </div>
        </div>
      </div>
    `;
  }

  private _renderTab(tab: TabDef): unknown {
    const isActive = tab.id === this.activeTab;
    return html`
      <div
        style="display:flex;align-items:center;height:18px;padding:0 8px;border-radius:3px;background:${isActive ? "#555" : "#4a4a4a"};font-size:10px;color:#d4d4d4;font-family:var(--font-ui);white-space:nowrap;flex-shrink:0;cursor:default;"
      >
        ${tab.title}
      </div>
    `;
  }

  private _renderSidebar(): unknown {
    return html`
      <div
        style="width:88px;flex-shrink:0;background:#252526;border-left:1px solid #333;display:flex;flex-direction:column;padding:0;"
      >
        <div
          style="padding:6px 8px 4px;font-size:8px;color:#999;font-weight:600;font-family:var(--font-ui);border-bottom:1px solid #333;"
        >
          EXPLORER
        </div>
        <div style="padding:4px 8px;display:flex;flex-direction:column;gap:2px;">
          <div style="display:flex;align-items:center;gap:2px;">
            <span style="color:#888;font-size:7px;">▼</span>
            <span style="color:#ccc;font-size:9px;font-weight:600;">src</span>
          </div>
          <div style="padding-left:8px;display:flex;align-items:center;gap:2px;">
            <span style="color:#888;font-size:7px;">▼</span>
            <span style="color:#ccc;font-size:9px;font-weight:600;">components</span>
          </div>
          <div style="padding-left:14px;display:flex;align-items:center;gap:3px;">
            <svg width="5" height="7" viewBox="0 0 5 7" style="flex-shrink:0;">
              <rect
                x="0"
                y="0"
                width="5"
                height="7"
                rx="1"
                stroke="#888"
                stroke-width="0.7"
                fill="none"
              />
              <line x1="1" y1="2" x2="3" y2="2" stroke="#888" stroke-width="0.6" />
              <line x1="1" y1="4" x2="2.5" y2="4" stroke="#888" stroke-width="0.4" />
            </svg>
            <span style="color:#aaa;font-size:7px;">app.tsx</span>
          </div>
          <div style="padding-left:14px;display:flex;align-items:center;gap:3px;">
            <svg width="5" height="7" viewBox="0 0 5 7" style="flex-shrink:0;">
              <rect
                x="0"
                y="0"
                width="5"
                height="7"
                rx="1"
                stroke="#888"
                stroke-width="0.7"
                fill="none"
              />
              <line x1="1" y1="2" x2="3" y2="2" stroke="#888" stroke-width="0.6" />
              <line x1="1" y1="4" x2="2.5" y2="4" stroke="#888" stroke-width="0.4" />
            </svg>
            <span style="color:#aaa;font-size:7px;">header.tsx</span>
          </div>
          <div style="padding-left:8px;display:flex;align-items:center;gap:2px;">
            <span style="color:#888;font-size:7px;">▶</span>
            <span style="color:#999;font-size:9px;">utils</span>
          </div>
        </div>
      </div>
    `;
  }

  private _renderGhostBoundary(): unknown {
    if (this.ghostBoundaryIndex < 0 || this.ghostBoundaryIndex > this.cols) return "";
    // Calculate the left position of the boundary between columns
    const boundaryX = this._getBoundaryX(this.ghostBoundaryIndex);
    return html`
      <div
        style="position:absolute;left:${boundaryX}px;top:0;bottom:0;width:2px;background:rgb(74,158,255);pointer-events:none;z-index:15;"
      ></div>
      <div
        style="position:absolute;left:${boundaryX}px;top:0;right:0;bottom:0;box-shadow:inset 2px 0 0 0 rgba(74,158,255,0.35);background:rgba(74,158,255,0.08);pointer-events:none;z-index:14;"
      ></div>
    `;
  }

  /**
   * Calculate the flex factor for a column. Columns are equal width.
   */
  private _getColWidth(_colIndex: number): number {
    return 1;
  }

  /**
   * Calculate the pixel X position of a column boundary, as a percentage string.
   * This approximates where the boundary falls in the flex layout.
   * sidebar (88px) is subtracted from the total, and boundaries are
   * evenly distributed across the remaining width.
   */
  private _getBoundaryX(boundaryIndex: number): string {
    if (this.cols === 0) return "0";
    // Calculate boundary position as a percentage of the grid area
    const totalPct = 100;
    const sidebarPct = this.sidebar ? 20 : 0; // sidebar ~20% of width
    const gridPct = totalPct - sidebarPct;
    const colPct = gridPct / this.cols;
    return `${boundaryIndex * colPct}%`;
  }
}

if (!customElements.get("demo-openp41ge")) {
  customElements.define("demo-openp41ge", DemoOpenp41ge);
}
