/**
 * Deterministic ordering for the workspaces overlay list: most-recently
 * activated first, tie-broken by the existing case-insensitive alphabetical
 * name ordering.
 *
 * Workspaces without a recorded `lastActivatedAt` (created before this feature,
 * or never activated) sort as if they were activated at the epoch — i.e. they
 * drop to the bottom, grouped alphabetically among themselves.
 */

/** Fallback timestamp for workspaces with no recorded activation time. */
export const EPOCH_ISO = "1970-01-01T00:00:00.000Z";

/** The minimal shape a workspace needs to take part in the sort. */
export interface SortableWorkspace {
  id: string;
  name?: string;
  lastActivatedAt?: string;
}

/** Numeric timestamp; unparseable/missing values fall back to the epoch. */
function timeOf(ws: SortableWorkspace): number {
  if (!ws.lastActivatedAt) return 0;
  const n = Date.parse(ws.lastActivatedAt);
  return Number.isNaN(n) ? 0 : n;
}

/** Case-insensitive name (falling back to id), matching the old list sort. */
function label(ws: SortableWorkspace): string {
  return (ws.name ?? ws.id).toLowerCase();
}

/**
 * Comparator: newest `lastActivatedAt` first; equal/missing timestamps are
 * tie-broken by the case-insensitive alphabetical name order, keeping the
 * pre-existing grouping for never-activated workspaces stable.
 */
export function sortWorkspacesByLastActivated(a: SortableWorkspace, b: SortableWorkspace): number {
  const diff = timeOf(b) - timeOf(a);
  if (diff !== 0) return diff;
  return label(a).localeCompare(label(b));
}
