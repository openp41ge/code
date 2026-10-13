/**
 * migrations-view.ts — the migration window's view. While the data updates
 * this version needs run it shows only their progress: a bar and "n of N"
 * (what they are, and any error, stay in the journal and the logs). When one
 * fails it says so and suggests downloading the app again from GitHub
 * (Download / Quit); offline and a failed check say so plainly (Quit /
 * Retry). The status sits on the right of the top bar, red or green; while
 * offline it follows the connection (Offline / Online). The bottom bar holds
 * only the buttons (with the app's tooltips), and is left out without any.
 *
 * The page is as tall as its content; the window fits itself to it.
 *
 * Plain DOM (no app bootstrap): the window shows before the app starts, so
 * it depends on nothing else in the renderer. Styled as the prerequisites
 * window.
 */

import { tooltipController } from "openp41ge-sdk-uikit";

/** The window's state (mirrors the main-process `MigrationWindowView`). */
export interface MigrationsViewState {
  /**
   * `checking`: downloading the updates; `offline`: they could not be;
   * `newer`: the data was last used by a newer version (never opened);
   * `error`: the check itself failed.
   */
  readonly phase: "checking" | "offline" | "newer" | "error" | "running" | "done" | "failed";
  /** How many updates are done, of `total`. */
  readonly completed: number;
  readonly total: number;
  /** The version that last used the data (`newer`). */
  readonly dataVersion?: string;
}

export interface MigrationsActions {
  retry(): void;
  quit(): void;
  /** Open the app's releases on GitHub (after a failed update). */
  download(): void;
}

const REFRESH_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>';
const QUIT_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M440-440v-400h80v400h-80Zm40 320q-74 0-139.5-28.5T226-226q-49-49-77.5-114.5T120-480q0-80 33-151t93-123l56 56q-48 40-75 97t-27 121q0 116 82 198t198 82q117 0 198.5-82T760-480q0-64-26.5-121T658-698l56-56q60 52 93 123t33 151q0 74-28.5 139.5t-77.5 114.5q-49 49-114.5 77.5T480-120Z"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>';

const STYLES = `
  .mg { display:flex; flex-direction:column; background:var(--bg-primary, #1e1e1e); }
  .mg-titlebar { flex:none; height:35px; box-sizing:border-box; display:flex; align-items:center; gap:10px; padding:0 10px; border-bottom:1px solid var(--border-divider, #2d2d2d); background:var(--bg-gutter, #161616); -webkit-app-region:drag; user-select:none; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-secondary, #999); }
  .mg-body { display:flex; flex-direction:column; padding-bottom:14px; }
  .mg-intro { padding:14px 14px 0; font-size:12px; color:var(--text-secondary, #999); line-height:17px; }
  .mg-progress { margin:12px 14px 0; height:6px; border-radius:3px; background:var(--bg-tertiary, #2c2c2c); overflow:hidden; }
  .mg-progress-fill { height:100%; border-radius:3px; background:var(--accent, #4a9eff); transition:width .25s ease-out; }
  .mg-bottombar { flex:none; height:34px; box-sizing:border-box; display:flex; align-items:stretch; border-top:1px solid var(--border-divider, #2a2a2a); background:var(--bg-secondary, #161616); color:var(--text-secondary, #999); font-size:11px; user-select:none; }
  .mg-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mg-status { flex:none; text-transform:none; letter-spacing:0; font-weight:500; }
  .mg-status--ok { color:#6fc872; }
  .mg-status--bad { color:var(--accent-error, #f44747); }
  .mg-spacer { flex:1; }
  .mg-btn { display:inline-flex; align-items:center; justify-content:center; flex:none; height:100%; aspect-ratio:1 / 1; padding:0; border:none; border-left:1px solid var(--divider, #333); border-radius:0; background:transparent; color:var(--text-secondary, #999); cursor:pointer; }
  .mg-btn:hover { background:var(--bg-hover, #2a2d2e); color:var(--text-primary, #fff); }
  .mg-btn svg { display:block; width:16px; height:16px; }
  .mg-btn--primary { color:var(--accent, #4a9eff); }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A square icon button for the bottom bar, with the app's tooltip. */
function iconButton(
  action: string,
  label: string,
  icon: string,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const b = el("button", primary ? "mg-btn mg-btn--primary" : "mg-btn");
  b.type = "button";
  b.setAttribute("aria-label", label);
  tooltipController.attach(b, { type: "simple", text: label });
  b.setAttribute("data-action", action);
  b.innerHTML = icon;
  b.addEventListener("click", onClick);
  return b;
}

function statusText(state: MigrationsViewState, online: boolean): string {
  if (state.phase === "checking") return "Downloading the update…";
  if (state.phase === "offline") return online ? "Online" : "Offline";
  if (state.phase === "newer") return "Needs a newer version";
  if (state.phase === "error") return "Could not check";
  if (state.phase === "done") return "Done";
  if (state.phase === "failed") return "Update failed";
  return `${state.completed} of ${state.total} done`;
}

/** Green for good news, red for bad; plain while it is still working. */
function statusTone(state: MigrationsViewState, online: boolean): "ok" | "bad" | null {
  if (state.phase === "offline") return online ? "ok" : "bad";
  if (state.phase === "done") return "ok";
  if (state.phase === "failed" || state.phase === "error" || state.phase === "newer") return "bad";
  return null;
}

function introText(state: MigrationsViewState): string {
  switch (state.phase) {
    case "newer":
      return `This data was last used by openp41ge code ${state.dataVersion ?? "(a newer version)"}. This older version may not understand it, so it won't open it. Install ${state.dataVersion ?? "that version"} or newer.`;
    case "error":
      return "openp41ge code couldn't check whether your data needs updating, so it won't open it yet. Retry, or quit and try again later.";
    case "failed":
      return "This version of openp41ge code needs to update your data, and the update couldn't be finished, so the app won't open. Download the latest version from GitHub and install it again.";
    case "offline":
      return "This version of openp41ge code needs to be online once, to download an update to your data. Check your connection and retry.";
    case "checking":
      return "Downloading an update to your data…";
    default:
      return "Updating your data for this version of openp41ge code. It opens when this is done.";
  }
}

/** The bar: `completed` of `total`. */
function progressBar(state: MigrationsViewState): HTMLElement {
  const track = el("div", "mg-progress");
  track.setAttribute("role", "progressbar");
  track.setAttribute("aria-label", "Updating your data");
  track.setAttribute("aria-valuemin", "0");
  track.setAttribute("aria-valuemax", String(state.total));
  track.setAttribute("aria-valuenow", String(state.completed));
  const fill = el("div", "mg-progress-fill");
  fill.style.width = `${state.total > 0 ? (100 * state.completed) / state.total : 0}%`;
  track.append(fill);
  return track;
}

/** Render (or re-render) the window into `root`. `mac` pads the title bar
 *  for the window buttons (the window uses the inset title bar); `online` is
 *  the connection (`navigator.onLine` unless given). */
export function renderMigrations(
  root: HTMLElement,
  state: MigrationsViewState,
  actions: MigrationsActions,
  opts: { mac?: boolean; online?: boolean } = {},
): void {
  const online = opts.online ?? navigator.onLine;
  const style = el("style", "");
  style.textContent = STYLES;
  const page = el("div", "mg");

  const titlebar = el("div", "mg-titlebar");
  titlebar.style.paddingLeft = opts.mac ? "82px" : "10px";
  const tone = statusTone(state, online);
  titlebar.append(
    el(
      "span",
      "mg-title",
      state.phase === "newer" || state.phase === "error" ? "Your data" : "Updating your data",
    ),
    el("span", tone ? `mg-status mg-status--${tone}` : "mg-status", statusText(state, online)),
  );

  const body = el("div", "mg-body");
  body.append(el("div", "mg-intro", introText(state)));
  if (state.phase === "running" || state.phase === "done") body.append(progressBar(state));

  const bar = el("div", "mg-bottombar");
  bar.append(el("span", "mg-spacer"));
  if (state.phase === "newer") {
    bar.append(iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()));
  } else if (state.phase === "failed") {
    bar.append(
      iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()),
      iconButton("download", "Download from GitHub", DOWNLOAD_ICON, () => actions.download(), true),
    );
  } else if (state.phase === "offline" || state.phase === "error") {
    bar.append(
      iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()),
      iconButton("retry", "Retry", REFRESH_ICON, () => actions.retry(), true),
    );
  }

  page.append(titlebar, body);
  if (bar.querySelector("[data-action]")) page.append(bar);
  root.replaceChildren(style, page);
}
