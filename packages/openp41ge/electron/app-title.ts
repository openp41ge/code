/**
 * Window titles, as Mission Control and the Window menu show them: "openp41ge
 * code", or "openp41ge code development" for a dev build (not packaged), so
 * the two are told apart when both run.
 */
import type { BrowserWindow } from "electron";

/** The app's title, with `part` after a dash. */
export function appTitle(packaged: boolean, part?: string): string {
  const name = packaged ? "openp41ge code" : "openp41ge code development";
  return part ? `${name} — ${part}` : name;
}

/** Keep the window's title: the page's <title> would otherwise replace it. */
export function keepWindowTitle(win: Pick<BrowserWindow, "on">): void {
  win.on("page-title-updated", (e) => e.preventDefault());
}
