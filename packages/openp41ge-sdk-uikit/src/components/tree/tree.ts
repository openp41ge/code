/**
 * <openp41ge-tree> — Generic tree web component.
 *
 * Renders a hierarchical TreeNode[] structure with expand/collapse,
 * keyboard navigation, configurable icon rendering, row variant
 * support (section headers, worktree rows, standard rows), hover
 * action buttons, and drag-and-drop.
 *
 * Keyboard navigation:
 *   ArrowUp/Down  — move selection
 *   ArrowRight    — expand node
 *   ArrowLeft     — collapse node
 *   Enter/Space   — toggle expand/collapse
 *   Home/End      — first/last visible node
 *
 * Events:
 *   tree-node-click   — { nodeId, meta }
 *   tree-node-toggle  — { nodeId, expanded, meta }
 *   tree-node-action  — { nodeId, actionId, meta }
 *   tree-drag-start   — { nodeId, meta }
 *   tree-drop         — { targetNodeId, position, dragData }
 */

import { LitElement, html, nothing, type PropertyValues, type TemplateResult } from "lit";
import { property, state } from "lit/decorators.js";
import { classMap } from "lit/directives/class-map.js";
import { styleMap } from "lit/directives/style-map.js";
import type { TreeNode, TreeNodeAction, DropPosition, IconRenderer } from "./types";
import { treeStyles } from "./tree-styles";

export {
  type TreeNode,
  type TreeNodeAction,
  type DropPosition,
  type IconRenderer,
  type TreeNodeClickEventDetail,
  type TreeNodeToggleEventDetail,
  type TreeNodeDblClickEventDetail,
  type TreeNodeActionEventDetail,
  type TreeDragStartEventDetail,
  type TreeDropEventDetail,
  type TreeContextMenuEventDetail,
  type TreeToggleErrorEventDetail,
} from "./types";

const DEFAULT_INDENT = 16; // pixels per depth level (default for --tree-indent)
const SECTION_EXTRA = 8; // extra indent for section headers

export class Openp41geTree extends LitElement {
  static styles = treeStyles;

  /** Tree data — flat or nested TreeNode[] */
  @property({ type: Array })
  nodes: TreeNode[] = [];

  /** Currently selected node ID */
  @property({ attribute: false })
  selectedId: string | null = null;

  /** Callback for rendering icons. Defaults to a simple inline SVG fallback. */
  @property({ attribute: false })
  renderIcon: IconRenderer | null = null;

  /** Current depth level (auto-managed for nested trees) */
  @property({ type: Number })
  depth = 0;

  /**
   * Optional async callback invoked when a collapsible node is expanded.
   * While the returned promise is pending, a loading spinner replaces the
   * chevron. If the promise resolves, the tree stays expanded (the consumer
   * is expected to have populated `node.children`). If it rejects, the node
   * collapses back.
   */
  @property({ attribute: false })
  onToggle: ((node: TreeNode) => Promise<void>) | null = null;

  /**
   * Optional callback fired whenever a node's expanded state changes.
   * The consumer can persist the state externally.
   */
  @property({ attribute: false })
  onExpandedChange: ((nodeId: string, expanded: boolean) => void) | null = null;

  @state()
  private _hoveredNodeId: string | null = null;

  @state()
  private _focusableNodeId: string | null = null;

  /** Node IDs currently being asynchronously loaded */
  @state()
  private _loadingNodeIds: Set<string> = new Set();

  /**
   * Virtualize the tree: render only the visible rows (plus an overscan
   * buffer) into a single flat scroll container instead of recursively
   * materialising the whole DOM. Enable for large/expanded trees (e.g. content
   * search results). Falls back to full rendering when the container has no
   * measurable height (e.g. jsdom/tests).
   */
  @property({ type: Boolean })
  virtualize = false;

  /** Fixed row height in px used by the virtualized layout. */
  @property({ type: Number })
  rowHeight = 26;

  /**
   * Scroll container to virtualize against, when the tree does NOT own its own
   * scroller — e.g. the Explorer, which stacks several trees inside one panel
   * scroll area. The window is then computed from where this tree sits within
   * that container's content, and the root renders as a plain block.
   */
  @property({ attribute: false })
  scrollContainer: HTMLElement | null = null;

  /** Rows to render above/below the visible viewport as a buffer. */
  @property({ type: Number })
  overscan = 6;

  /** Scroll offset (px) of the virtualized container. */
  @state()
  private _scrollTop = 0;

  /** Measured client height (px) of the virtualized container. */
  @state()
  private _viewportHeight = 0;

  private _scrollEl: HTMLElement | null = null;
  private _virtualResizeObserver: ResizeObserver | null = null;
  private _scrollRaf: number | null = null;
  /** Node ids in the most recently rendered virtual window. */
  private _windowNodeIds: string[] = [];
  private _lastWindowKey = "";

  // @ts-expect-error unused - kept for potential future use
  private _rootEl: HTMLElement | null = null;

  // @ts-expect-error unused - kept for potential future use
  private _isInternalUpdate = false;

  // ─── Lifecycle ───────────────────────────────────────────────────

  connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("keydown", this._onKeyDown);
    this.addEventListener("focus", this._onFocus);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("keydown", this._onKeyDown);
    this.removeEventListener("focus", this._onFocus);
    this._teardownVirtualScroll();
  }

  firstUpdated(): void {
    this._rootEl = this.renderRoot?.querySelector(".tree-root") as HTMLElement | null;
    this._ensureFocusableNode();
    this._setupVirtualScroll();
  }

  protected updated(changed: PropertyValues): void {
    // Virtualization can switch on after the first render (a tree grows past
    // its consumer's threshold) and the scroll container can be swapped, so
    // rebind rather than leaving the listener attached to the old target.
    if (changed.has("virtualize") || changed.has("scrollContainer")) {
      this._teardownVirtualScroll();
      this._setupVirtualScroll();
    }
    this._notifyWindowChange();
  }

  /**
   * Announce which rows the virtual window currently holds, so a consumer can
   * load what scrolled into view (the Explorer prefetches match lines this
   * way). Only fires while windowing, and only when the set actually changes.
   */
  private _notifyWindowChange(): void {
    if (!this.virtualize || this._viewportHeight <= 0) return;
    const key = this._windowNodeIds.join("\u0000");
    if (key === this._lastWindowKey) return;
    this._lastWindowKey = key;
    this.dispatchEvent(
      new CustomEvent("tree-visible-nodes", {
        bubbles: true,
        composed: true,
        detail: { nodeIds: [...this._windowNodeIds] },
      }),
    );
  }

  private _teardownVirtualScroll(): void {
    if (this._scrollEl) {
      this._scrollEl.removeEventListener("scroll", this._onVirtualScroll);
      this._scrollEl = null;
    }
    if (this._scrollRaf !== null) {
      if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(this._scrollRaf);
      else clearTimeout(this._scrollRaf);
      this._scrollRaf = null;
    }
    if (this._virtualResizeObserver) {
      this._virtualResizeObserver.disconnect();
      this._virtualResizeObserver = null;
    }
  }

  // ─── Helpers ───────────────────────────────────────────────────

  private _hasChildren(node: TreeNode): boolean {
    return !!(node.children && node.children.length > 0);
  }

  /** True if node can be toggled (has actual children or is marked expandable for async). */
  private _isExpandable(node: TreeNode): boolean {
    return this._hasChildren(node) || !!node.expandable;
  }

  private _showChevron(node: TreeNode): boolean {
    if (node.showChevron !== undefined) return node.showChevron;
    return this._isExpandable(node);
  }

  private _isSection(node: TreeNode): boolean {
    return node.variant === "section";
  }

  // ─── Virtualized layout ──────────────────────────────────────

  private _setupVirtualScroll(): void {
    if (!this.virtualize) return;
    this._scrollEl =
      this.scrollContainer ??
      (this.renderRoot?.querySelector(".tree-root--virtual") as HTMLElement | null);
    if (!this._scrollEl) return;
    this._scrollEl.addEventListener("scroll", this._onVirtualScroll, { passive: true });
    this._measureViewport();
    if (typeof ResizeObserver !== "undefined") {
      this._virtualResizeObserver = new ResizeObserver(() => this._measureViewport());
      // Observe whatever defines the viewport height so we detect when it
      // becomes measurable (0 → N) and can switch from the fallback full
      // render to the virtualized window.
      this._virtualResizeObserver.observe(this.scrollContainer ?? this);
    }
  }

  private _onVirtualScroll = (): void => {
    // Coalesce a scroll burst into one measurement per frame.
    if (this._scrollRaf !== null) return;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn: () => void) => setTimeout(fn, 16) as unknown as number;
    this._scrollRaf = raf(() => {
      this._scrollRaf = null;
      this._measureViewport();
    }) as unknown as number;
  };

  /**
   * Offset (px) of this tree's first row within the scroll container's
   * content. Zero when the tree owns its scroller.
   */
  private _offsetWithinScroller(): number {
    const el = this.scrollContainer;
    if (!el || el !== this._scrollEl) return 0; // the tree owns its scroller
    const host = this.getBoundingClientRect();
    const container = el.getBoundingClientRect();
    return host.top - container.top + el.scrollTop;
  }

  private _measureViewport(): void {
    const el = this._scrollEl;
    if (!el) return;
    // With an external scroller the window is the slice of the container's
    // viewport that overlaps this tree, so subtract where the tree starts.
    const offset = this._offsetWithinScroller();
    const scrollTop = Math.max(0, el.scrollTop - offset);
    const h = this.scrollContainer ? el.clientHeight : this.clientHeight;
    if (this._scrollTop !== scrollTop || this._viewportHeight !== h) {
      this._scrollTop = scrollTop;
      // Re-render if the viewport became measurable (0 → N) so we switch from
      // the fallback full render to the virtualized window.
      this._viewportHeight = h;
    }
  }

  /** Flatten visible nodes with their global (flattened) depth. */
  private _collectVisibleWithDepth(): Array<{ node: TreeNode; depth: number }> {
    const result: Array<{ node: TreeNode; depth: number }> = [];
    this._collectVisibleDepth(this.nodes, 0, result);
    return result;
  }

  private _collectVisibleDepth(
    nodes: TreeNode[],
    depth: number,
    out: Array<{ node: TreeNode; depth: number }>,
  ): void {
    for (const node of nodes) {
      out.push({ node, depth });
      if (this._hasChildren(node) && this._isExpandedLocal(node)) {
        this._collectVisibleDepth(node.children!, depth + 1, out);
      }
    }
  }

  // ─── Flatten visible nodes for keyboard nav ──────────────────────

  /** Get all currently visible nodes in order (flat list). */
  private _getVisibleNodes(): TreeNode[] {
    const result: TreeNode[] = [];
    this._collectVisible(this.nodes, result);
    return result;
  }

  private _collectVisible(nodes: TreeNode[], out: TreeNode[]): void {
    for (const node of nodes) {
      out.push(node);
      if (this._hasChildren(node) && this._isExpandedLocal(node)) {
        this._collectVisible(node.children!, out);
      }
    }
  }

  /** Resolve expanded from node.expanded or our local override. */
  private _isExpandedLocal(node: TreeNode): boolean {
    if (node.expanded !== undefined) return node.expanded;
    if (this._hasChildren(node)) return false;
    return false;
  }

  // @ts-expect-error unused - kept for persistence API
  private _getExpandedNodes(): Set<string> {
    const set = new Set<string>();
    this._collectExpanded(this.nodes, set);
    return set;
  }

  private _collectExpanded(nodes: TreeNode[], out: Set<string>): void {
    for (const node of nodes) {
      if (this._isExpandedLocal(node)) {
        out.add(node.id);
        if (node.children) this._collectExpanded(node.children, out);
      }
    }
  }

  // ─── Keyboard Navigation ────────────────────────────────────────

  private _onFocus(): void {
    if (!this._focusableNodeId && this.nodes.length > 0) {
      this._focusableNodeId = this.nodes[0].id;
    }
  }

  private _onKeyDown(e: KeyboardEvent): void {
    const visible = this._getVisibleNodes();
    if (visible.length === 0) return;

    let idx = this.selectedId ? visible.findIndex((n) => n.id === this.selectedId) : -1;

    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        idx = Math.min(idx + 1, visible.length - 1);
        this._selectAndFocus(visible[idx].id);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        idx = Math.max(idx - 1, 0);
        this._selectAndFocus(visible[idx].id);
        break;
      }
      case "ArrowRight": {
        e.preventDefault();
        const node = visible[idx];
        if (node && this._hasChildren(node) && !this._isExpandedLocal(node)) {
          this._toggleNode(node);
        }
        break;
      }
      case "ArrowLeft": {
        e.preventDefault();
        const node = visible[idx];
        if (node && this._hasChildren(node) && this._isExpandedLocal(node)) {
          this._toggleNode(node);
        }
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        const node = visible[idx];
        if (node && this._hasChildren(node)) {
          this._toggleNode(node);
        } else if (node) {
          // Activate leaf node (click)
          this._emitClick(node);
        }
        break;
      }
      case "Home": {
        e.preventDefault();
        if (visible.length > 0) {
          this._selectAndFocus(visible[0].id);
        }
        break;
      }
      case "End": {
        e.preventDefault();
        if (visible.length > 0) {
          this._selectAndFocus(visible[visible.length - 1].id);
        }
        break;
      }
    }
  }

  private _selectAndFocus(nodeId: string): void {
    this.selectedId = nodeId;
    this._focusableNodeId = nodeId;
    this._ensureFocusableNode();
    // Scroll into view
    const el = this.renderRoot?.querySelector(
      `[data-node-id="${CSS.escape(nodeId)}"]`,
    ) as HTMLElement | null;
    el?.scrollIntoView({ block: "nearest" });
    this.requestUpdate();
  }

  private _ensureFocusableNode(): void {
    if (
      !this._focusableNodeId ||
      !this.nodes.find((n) => this._findNode(n, this._focusableNodeId!))
    ) {
      this._focusableNodeId =
        this.nodes.length > 0 ? (this._getVisibleNodes()[0]?.id ?? null) : null;
    }
  }

  private _findNode(root: TreeNode, id: string): TreeNode | undefined {
    if (root.id === id) return root;
    if (root.children) {
      for (const child of root.children) {
        const found = this._findNode(child, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  // ─── Toggle / Select ────────────────────────────────────────────

  private _toggleNode(node: TreeNode): void {
    const expanded = !this._isExpandedLocal(node);

    if (expanded && this.onToggle && this._isExpandable(node)) {
      // Async expansion: mark loading, flip expanded, do async, then resolve
      this._loadingNodeIds = new Set(this._loadingNodeIds).add(node.id);
      this._updateExpanded(node.id, true);
      this.onToggle(node)
        .then(() => {
          // Consumer populated children — keep expanded
          const next = new Set(this._loadingNodeIds);
          next.delete(node.id);
          this._loadingNodeIds = next;
          this.requestUpdate();
        })
        .catch((err) => {
          // Async failure — collapse back
          const next = new Set(this._loadingNodeIds);
          next.delete(node.id);
          this._loadingNodeIds = next;
          this._updateExpanded(node.id, false);
          this.dispatchEvent(
            new CustomEvent("tree-node-toggle-error", {
              bubbles: true,
              composed: true,
              detail: { nodeId: node.id, meta: node.meta, error: err },
            }),
          );
        });
      // Fire toggle event even while loading
      this._notifyToggle(node, true);
      return;
    }

    if (!expanded && this._loadingNodeIds.has(node.id)) {
      // Collapse a loading node — cancel by removing from loading set
      const next = new Set(this._loadingNodeIds);
      next.delete(node.id);
      this._loadingNodeIds = next;
      // Don't attempt to collapse children that never loaded
    }

    this._updateExpanded(node.id, expanded);
    this._notifyToggle(node, expanded);
  }

  private _notifyToggle(node: TreeNode, expanded: boolean): void {
    this.dispatchEvent(
      new CustomEvent("tree-node-toggle", {
        bubbles: true,
        composed: true,
        detail: { nodeId: node.id, expanded, meta: node.meta },
      }),
    );
    if (this.onExpandedChange) {
      this.onExpandedChange(node.id, expanded);
    }
  }

  private _emitClick(node: TreeNode): void {
    this.selectedId = node.id;
    this.dispatchEvent(
      new CustomEvent("tree-node-click", {
        bubbles: true,
        composed: true,
        detail: { nodeId: node.id, meta: node.meta },
      }),
    );
  }

  // ─── Event Handlers ────────────────────────────────────────────

  private _onChevronClick(e: Event, node: TreeNode): void {
    e.stopPropagation();
    this._toggleNode(node);
  }

  private _onNodeClick(e: MouseEvent, node: TreeNode): void {
    e.stopPropagation();
    this._focusableNodeId = node.id;
    // Don't toggle on dblclick — the dblclick handler will fire separately
    if (e.detail >= 2) return;
    // Toggle expand/collapse for expandable nodes (with children or expandable flag)
    // Activate (click) for leaf nodes
    if (this._isExpandable(node)) {
      this._toggleNode(node);
    } else {
      this._emitClick(node);
    }
  }

  private _onNodeDblClick(e: MouseEvent, node: TreeNode): void {
    e.stopPropagation();
    if (this._isExpandable(node)) {
      this._toggleNode(node);
    } else {
      this._emitDblClick(node);
    }
  }

  private _emitDblClick(node: TreeNode): void {
    this.selectedId = node.id;
    this.dispatchEvent(
      new CustomEvent("tree-node-dblclick", {
        bubbles: true,
        composed: true,
        detail: { nodeId: node.id, meta: node.meta },
      }),
    );
  }

  private _onActionClick(e: Event, node: TreeNode, action: TreeNodeAction): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("tree-node-action", {
        bubbles: true,
        composed: true,
        detail: { nodeId: node.id, actionId: action.id, meta: node.meta },
      }),
    );
  }

  private _onDragStart(e: DragEvent, node: TreeNode): void {
    if (!node.draggable) return;
    e.dataTransfer?.setData("text/plain", node.id);
    e.dataTransfer!.effectAllowed = "move";
    this.dispatchEvent(
      new CustomEvent("tree-drag-start", {
        bubbles: true,
        composed: true,
        detail: { nodeId: node.id, meta: node.meta },
      }),
    );
  }

  private _onContextMenu(e: MouseEvent, node: TreeNode): void {
    e.preventDefault();
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("tree-node-contextmenu", {
        bubbles: true,
        composed: true,
        detail: {
          nodeId: node.id,
          meta: node.meta,
          clientX: e.clientX,
          clientY: e.clientY,
        },
      }),
    );
  }

  private _onDragOver(e: DragEvent): void {
    e.preventDefault();
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = "move";
    }
  }

  private _onDrop(e: DragEvent, targetNode: TreeNode): void {
    e.preventDefault();
    e.stopPropagation();
    const dragData = e.dataTransfer?.getData("text/plain");
    const position = this._computeDropPosition(e, targetNode);
    this.dispatchEvent(
      new CustomEvent("tree-drop", {
        bubbles: true,
        composed: true,
        detail: { targetNodeId: targetNode.id, position, dragData },
      }),
    );
  }

  private _computeDropPosition(e: DragEvent, _targetNode: TreeNode): DropPosition {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const relY = (e.clientY - rect.top) / rect.height;
    if (relY < 0.25) return "before";
    if (relY > 0.75) return "after";
    return "inside";
  }

  // ─── State Management ──────────────────────────────────────────

  private _updateExpanded(nodeId: string, expanded: boolean): void {
    this.nodes = this._setExpanded(this.nodes, nodeId, expanded);
    this.requestUpdate();
  }

  private _setExpanded(nodes: TreeNode[], nodeId: string, expanded: boolean): TreeNode[] {
    return nodes.map((n) => {
      if (n.id === nodeId) {
        return { ...n, expanded };
      }
      if (n.children) {
        return { ...n, children: this._setExpanded(n.children, nodeId, expanded) };
      }
      return n;
    });
  }

  // ─── Icon rendering ────────────────────────────────────────────

  /** Cache of chevron-cell + icon-cell widths consumed before the label. */
  private _labelOffsetCache: number | null = null;

  private _labelOffset(): number {
    if (this._labelOffsetCache !== null) return this._labelOffsetCache;
    const cs = getComputedStyle(this);
    const chevron = parseInt(cs.getPropertyValue("--chevron-width").trim() || "0", 10) || 16;
    const icon = parseInt(cs.getPropertyValue("--icon-width").trim() || "0", 10) || 16;
    this._labelOffsetCache = chevron + icon;
    return this._labelOffsetCache;
  }

  /** The indentation unit added per depth level (px), read from --tree-indent. */
  private _indentPerLevel(): number {
    const cs = getComputedStyle(this);
    const v = parseInt(cs.getPropertyValue("--tree-indent").trim() || "0", 10);
    return Number.isFinite(v) && v > 0 ? v : DEFAULT_INDENT;
  }

  private _resolveIcon(name: string | undefined, size: number): TemplateResult | string {
    if (!name) return "";
    if (this.renderIcon) {
      return this.renderIcon(name, size);
    }
    // Default: use openp41ge-icon component
    return html`<openp41ge-icon name=${name} size=${size}></openp41ge-icon>`;
  }

  private _renderChevron(expanded: boolean): TemplateResult {
    return html` <span class="tree-chevron">
      <openp41ge-icon
        name=${expanded ? "chevron-down" : "chevron-right"}
        size="12"
      ></openp41ge-icon>
    </span>`;
  }

  // ─── Render ────────────────────────────────────────────────────

  render(): TemplateResult {
    if (!this.nodes || this.nodes.length === 0) {
      return html`<div class="tree-empty">No items</div>`;
    }
    // Virtualized mode renders a single flat scroll container. When it has no
    // measurable viewport (jsdom / tests, or before layout) it falls back to
    // rendering every row so the DOM stays predictable for assertions.
    if (this.virtualize) {
      return this._renderVirtualized();
    }
    return html`
      <div class="tree-root" role="tree">${this._renderNodes(this.nodes, this.depth)}</div>
    `;
  }

  private _renderNodes(nodes: TreeNode[], depth: number): TemplateResult[] {
    return nodes.map((node) => this._renderNode(node, depth));
  }

  private _renderNode(node: TreeNode, depth: number): TemplateResult {
    const row = this._renderRow(node, depth);
    const expanded = this._isExpandedLocal(node);
    const hasChildren = this._hasChildren(node);
    const isLoading = this._loadingNodeIds.has(node.id);

    return html`${row}${this._renderChildren(node, depth, expanded, hasChildren, isLoading)}`;
  }

  private _renderChildren(
    node: TreeNode,
    depth: number,
    expanded: boolean,
    hasChildren: boolean,
    isLoading: boolean,
  ): TemplateResult | typeof nothing {
    if (!(hasChildren && expanded && !isLoading)) return nothing;
    return html`<openp41ge-tree
      .nodes=${node.children!}
      .selectedId=${this.selectedId}
      .renderIcon=${this.renderIcon}
      .onToggle=${this.onToggle}
      .onExpandedChange=${this.onExpandedChange}
      depth=${depth + 1}
      @tree-node-click=${(e: Event) => this._forwardEvent(e, "tree-node-click")}
      @tree-node-toggle=${(e: Event) => this._forwardEvent(e, "tree-node-toggle")}
      @tree-node-toggle-error=${(e: Event) => this._forwardEvent(e, "tree-node-toggle-error")}
      @tree-node-action=${(e: Event) => this._forwardEvent(e, "tree-node-action")}
      @tree-node-dblclick=${(e: Event) => this._forwardEvent(e, "tree-node-dblclick")}
      @tree-node-contextmenu=${(e: Event) => this._forwardEvent(e, "tree-node-contextmenu")}
      @tree-drag-start=${(e: Event) => this._forwardEvent(e, "tree-drag-start")}
      @tree-drop=${(e: Event) => this._forwardEvent(e, "tree-drop")}
    ></openp41ge-tree>`;
  }

  private _renderVirtualized(): TemplateResult {
    const visible = this._collectVisibleWithDepth();
    const total = visible.length;
    // With an external scroller the root is a plain block inside someone
    // else's scroll area; only the self-scrolling variant owns a scrollbar.
    const rootClass = this.scrollContainer
      ? "tree-root tree-root--virtual-external"
      : "tree-root tree-root--virtual";

    // Fallback: no measurable viewport → render every row (tests/jsdom/0-size).
    if (this._viewportHeight <= 0) {
      return html`
        <div class=${rootClass} role="tree" @scroll=${this._onVirtualScroll}>
          ${visible.map((entry) => this._renderRow(entry.node, entry.depth))}
        </div>
      `;
    }

    // Windowed render: only the visible rows plus an overscan buffer.
    const rowH = Math.max(1, this.rowHeight);
    const overscan = Math.max(0, this.overscan);
    const first = Math.max(0, Math.floor(this._scrollTop / rowH) - overscan);
    const last = Math.min(
      total,
      Math.ceil((this._scrollTop + this._viewportHeight) / rowH) + overscan,
    );
    const slice = visible.slice(first, last);
    this._windowNodeIds = slice.map((entry) => entry.node.id);
    return html`
      <div class=${rootClass} role="tree" @scroll=${this._onVirtualScroll}>
        ${
          first > 0
            ? html`<div class="tree-virtual-spacer" style="height:${first * rowH}px"></div>`
            : nothing
        }
        ${slice.map((entry) => this._renderRow(entry.node, entry.depth))}
        ${
          last < total
            ? html`<div
                class="tree-virtual-spacer"
                style="height:${(total - last) * rowH}px"
              ></div>`
            : nothing
        }
      </div>
    `;
  }

  private _renderRow(node: TreeNode, depth: number): TemplateResult {
    const expanded = this._isExpandedLocal(node);
    const hasChildren = this._hasChildren(node);
    const showChevron = this._showChevron(node);
    const selected = this.selectedId === node.id;
    const hovered = this._hoveredNodeId === node.id;
    const isSection = this._isSection(node);
    const isFocusable = this._focusableNodeId === node.id;
    const isLoading = this._loadingNodeIds.has(node.id);

    // Indentation: the indent unit per depth level is configurable via
    // --tree-indent (a fixed px value, changed in the explorer settings).
    const indentPerLevel = this._indentPerLevel();
    const rowIndent = isSection ? depth * indentPerLevel + SECTION_EXTRA : depth * indentPerLevel;
    // A node may opt to be pulled back toward its parent (e.g. content-match
    // rows rendered as children of a file), reducing its effective indent.
    const appliedIndent = Math.max(0, rowIndent - (node.reduceIndent ?? 0));
    const contentPad = isSection ? 8 : 8; // base padding on left

    // Width consumed before the label by the (always-rendered) chevron cell
    // and the icon cell / spacer. Used by custom label renderers so they can
    // position a gutter relative to the row's left edge.
    const labelOffset = this._labelOffset();

    // Label content: a custom renderer may provide rich HTML (e.g. a gutter
    // + highlighted code), otherwise fall back to the plain label text. The
    // renderer receives the row geometry so it can position a gutter.
    const labelContent = node.renderLabel
      ? node.renderLabel(node, {
          depth,
          paddingLeft: rowIndent + contentPad,
          labelOffset,
          indentPerLevel,
        })
      : node.label;

    // Status CSS class
    const statusClass = node.status ? `tree-node--status-${node.status}` : "";

    // Expose the node's file path to host apps (e.g. the platform's custom
    // drag pipeline) via a data attribute. Only draggable nodes that declare
    // a `meta.filePath` qualify — directories carry a filePath too but are not
    // marked draggable, so this reliably targets files.
    const filePath =
      node.draggable && typeof node.meta?.filePath === "string"
        ? (node.meta.filePath as string)
        : undefined;

    return html`
      <div
        class="tree-node ${classMap({
          selected,
          hovered,
          "is-section": isSection,
          "has-children": hasChildren,
          "is-loading": isLoading,
          "tree-node--cm": !!node.renderLabel,
          "tree-node--muted": !!node.muted,
          [statusClass]: !!node.status,
        })}"
        style=${styleMap({
          paddingLeft: `${appliedIndent + contentPad}px`,
          // Create rows (“+ add file” / “+ add folder”) are full-width rows whose
          // confirm/cancel buttons must sit flush against the right edge, so they
          // opt out of the standard 8px right padding.
          paddingRight: node.id.startsWith("new:") ? "0px" : "8px",
        })}
        role="treeitem"
        tabindex=${isFocusable ? "0" : "-1"}
        data-node-id=${node.id}
        aria-expanded=${hasChildren ? (expanded ? "true" : "false") : undefined}
        aria-selected=${selected ? "true" : "false"}
        draggable=${node.draggable ? "true" : "false"}
        data-file-path=${filePath ?? nothing}
        @click=${(e: MouseEvent) => this._onNodeClick(e, node)}
        @dblclick=${(e: MouseEvent) => this._onNodeDblClick(e, node)}
        @contextmenu=${(e: MouseEvent) => this._onContextMenu(e, node)}
        @mouseenter=${() => (this._hoveredNodeId = node.id)}
        @mouseleave=${() => (this._hoveredNodeId === node.id ? (this._hoveredNodeId = null) : null)}
        @dragstart=${(e: DragEvent) => this._onDragStart(e, node)}
        @dragover=${this._onDragOver}
        @drop=${(e: DragEvent) => this._onDrop(e, node)}
      >
        <!-- Action cell: chevron (▶/▼), custom action icon (e.g. + on create
             rows), or a loading spinner. Always the same width, so every row's
             action icon occupies identical space regardless of row type. -->
        <span class="tree-chevron-cell" @click=${(e: Event) => this._onChevronClick(e, node)}>
          ${
            isLoading
              ? this._renderSpinner()
              : node.actionIcon
                ? this._resolveIcon(node.actionIcon, 11)
                : showChevron
                  ? this._renderChevron(expanded)
                  : nothing
          }
        </span>

        <!-- Icon column (may be empty for section headers) -->
        ${
          node.icon
            ? html`
                <span class="tree-icon-cell">
                  ${this._resolveIcon(node.icon, node.iconSize ?? 14)}
                </span>
              `
            : html`<span class="tree-icon-spacer"></span>`
        }

        <!-- Label -->
        <span class="tree-label">${labelContent}</span>

        <!-- Badge -->
        ${node.badge ? html`<span class="tree-badge">${node.badge}</span>` : nothing}

        <!-- Actions (show on hover) -->
        ${
          hovered && node.actions && node.actions.length > 0
            ? html`<span class="tree-actions">
                ${node.actions.map(
                  (action) => html`
                    <span
                      class="tree-action-btn"
                      title=${action.label}
                      aria-label=${action.label}
                      role="button"
                      tabindex="-1"
                      @click=${(e: Event) => this._onActionClick(e, node, action)}
                    >
                      ${this._resolveIcon(action.icon, 14)}
                    </span>
                  `,
                )}
              </span>`
            : nothing
        }
      </div>
    `;
  }

  private _renderSpinner(): TemplateResult {
    return html` <span class="tree-spinner" part="spinner"></span> `;
  }

  /** Forward nested tree events up through the parent component. */
  private _forwardEvent(e: Event, eventName: string): void {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent(eventName, {
        bubbles: true,
        composed: true,
        detail: (e as CustomEvent).detail,
      }),
    );
  }
}

if (!customElements.get("openp41ge-tree")) {
  customElements.define("openp41ge-tree", Openp41geTree);
}

declare global {
  interface HTMLElementTagNameMap {
    "openp41ge-tree": Openp41geTree;
  }
}
