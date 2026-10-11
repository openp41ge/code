/**
 * Tree node data structure for the <openp41ge-tree> component.
 *
 * Pure data — no platform dependencies. The host app maps its domain
 * model to TreeNode[] and handles events.
 */

import type { TemplateResult } from "lit";

/** Geometry passed to a node's custom label renderer so it can position its
 *  own content (e.g. a line-number gutter) relative to the row. */
export interface TreeNodeLabelContext {
  /** Depth of this node in the rendered tree (0 = top-level). */
  depth: number;
  /** The row's computed left padding in px (rowIndent + contentPad). */
  paddingLeft: number;
  /** Width consumed by the chevron cell + icon cell before the label, in px. */
  labelOffset: number;
  /** Pixels of indentation added per depth level. */
  indentPerLevel: number;
}

/** Renders a node's label as rich content (e.g. a code gutter + highlighted
 *  text). Return a TemplateResult or an HTML string. */
export type TreeNodeLabelRenderer = (
  node: TreeNode,
  ctx: TreeNodeLabelContext,
) => TemplateResult | string;

export interface TreeNodeAction {
  /** Unique action ID (e.g. "add", "delete", "refresh") */
  id: string;
  /** Icon name or SVG string */
  icon: string;
  /** Tooltip / aria-label */
  label: string;
}

/** Row visual variant */
export type RowVariant = "default" | "section" | "worktree";

export interface TreeNode {
  /** Unique node ID within the tree */
  id: string;
  /** Display label */
  label: string;
  /** Optional icon name (passed to renderIcon callback) */
  icon?: string;
  /** Icon render size in px (default: 14) */
  iconSize?: number;
  /** Child nodes */
  children?: TreeNode[];
  /** Whether the node is currently expanded (default: false) */
  expanded?: boolean;
  /** Whether the node can be dragged (default: false) */
  draggable?: boolean;
  /** Row visual variant */
  variant?: RowVariant;
  /** Action buttons shown on hover */
  actions?: TreeNodeAction[];
  /** Show a chevron toggle before the icon (default: true for nodes with children) */
  showChevron?: boolean;
  /**
   * Optional action icon rendered in the chevron/action cell instead of the
   * chevron (e.g. a "+" for create rows). When set it always occupies the
   * action cell, keeping the row layout uniform regardless of whether the
   * node has children.
   */
  actionIcon?: string;
  /**
   * Mark as expandable even when children[] is empty (for async/lazy loading).
   * When true, clicking the node toggles it and calls onToggle (if set) instead
   * of firing tree-node-click.
   */
  expandable?: boolean;
  /**
   * Row status — adds CSS class `tree-node--status-{status}` so consumers
   * can style via theme variables (e.g. --tree-status-untracked-opacity).
   */
  status?: "untracked" | "pending" | "warning" | "error" | "success";
  /** When true, the row's label text renders in the muted/secondary grey
   *  (e.g. for "+ new file" / "+ new folder" create rows). */
  muted?: boolean;
  /** Optional label rendered after the main label (e.g. "(pending)") */
  badge?: string;
  /** App-specific metadata passed through events */
  meta?: Record<string, unknown>;
  /** Optional rich label renderer (e.g. for content-match rows). When set it
   *  replaces the plain `label` text; it receives the row's geometry so it can
   *  render a custom gutter/highlight layout. */
  renderLabel?: TreeNodeLabelRenderer;
  /** Pixels to subtract from this row's computed indentation, so a child row
   *  (e.g. a content-match row under a file) can be pulled back toward its
   *  parent instead of sitting a full level deeper. */
  reduceIndent?: number;
}

/** Position of a drop relative to a target node */
export type DropPosition = "before" | "after" | "inside";

export interface TreeDropEventDetail {
  targetNodeId: string;
  position: DropPosition;
  dragData: unknown;
}

export interface TreeNodeClickEventDetail {
  nodeId: string;
  meta?: Record<string, unknown>;
}

export interface TreeNodeToggleEventDetail {
  nodeId: string;
  expanded: boolean;
  meta?: Record<string, unknown>;
}

export interface TreeNodeActionEventDetail {
  nodeId: string;
  actionId: string;
  meta?: Record<string, unknown>;
}

export interface TreeDragStartEventDetail {
  nodeId: string;
  meta?: Record<string, unknown>;
}

export interface TreeContextMenuEventDetail {
  nodeId: string;
  meta?: Record<string, unknown>;
  clientX: number;
  clientY: number;
}

export interface TreeToggleErrorEventDetail {
  nodeId: string;
  meta?: Record<string, unknown>;
  error: unknown;
}

export interface TreeNodeDblClickEventDetail {
  nodeId: string;
  meta?: Record<string, unknown>;
}

/** Callback type for rendering icons — host app provides its own resolver */
export type IconRenderer = (name: string, size: number) => TemplateResult | string;
