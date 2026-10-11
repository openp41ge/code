/**
 * System-tab open helper — opens a system (sidebar) tab by app type.
 *
 * Uses the direct workspace dispatch → openSystemTab operation. This is the
 * proven path (the same one the sidebar's ＋ menu uses): it activates an
 * already-open tab in any sidebar, or creates it in the requested/default
 * side. The DOM-event route (tab-open-system → graph → handler) was found to
 * drop the positional args before reaching the operation, so we dispatch
 * directly instead.
 */

/**
 * Open a system (sidebar) tab.
 */
export function emitOpenSystemTab(
  winId: string,
  appType: string,
  title: string,
  side?: "left" | "right",
): void {
  const defaultSides: Record<string, "left" | "right"> = {
    projects: "left",
    search: "left",
  };
  const resolvedSide = side ?? defaultSides[appType] ?? "right";
  window.openp41ge?.workspace?.dispatch?.("openSystemTab", winId, resolvedSide, appType, title);
}
