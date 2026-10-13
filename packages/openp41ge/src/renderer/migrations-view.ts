/**
 * migrations-view.ts — the migration window's view. While the data updates
 * this version needs run it shows only their progress: a bar and "n of N"
 * (what they are, and any error, stay in the journal and the logs). When one
 * fails it says so and suggests downloading the app again from GitHub
 * (Download / Quit). Offline, a checklist shows what the download needs
 * (internet, the distribution servers; the main process checks them every
 * few seconds, with a blue spinner while one is being checked), and
 * Continue is disabled until every item is met; the user presses it to go
 * on. A failed check says so plainly (Quit / Continue). Otherwise the status
 * sits right below the text, red or green; the top bar holds only the title. The bottom bar holds only
 * the buttons (with the app's tooltips), and is left out without any.
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
  /** `offline`: what the download needs, once checked (mirrors the main
   *  process's `Requirements`). */
  readonly requirements?: {
    readonly internet: boolean;
    readonly github: "ok" | "unreachable" | "rate-limited" | "checking";
    /** When GitHub takes requests again (epoch ms). */
    readonly githubResetAt?: number;
  };
}

export interface MigrationsActions {
  retry(): void;
  quit(): void;
  /** Open the app's releases on GitHub (after a failed update). */
  download(): void;
}

const CONTINUE_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M647-440H160v-80h487L423-744l57-56 320 320-320 320-57-56 224-224Z"/></svg>';
const QUIT_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
const CHECK_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const DOWNLOAD_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-320 280-520l56-58 104 104v-326h80v326l104-104 56 58-200 200ZM240-160q-33 0-56.5-23.5T160-240v-120h80v120h480v-120h80v120q0 33-23.5 56.5T720-160H240Z"/></svg>';

const STYLES = `
  .mg { display:flex; flex-direction:column; background:var(--bg-primary, #1e1e1e); }
  .mg-titlebar { flex:none; height:35px; box-sizing:border-box; display:flex; align-items:center; gap:10px; padding:0 10px; border-bottom:1px solid var(--border-divider, #2d2d2d); background:var(--bg-gutter, #161616); -webkit-app-region:drag; user-select:none; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-secondary, #999); }
  .mg-body { display:flex; flex-direction:column; padding-bottom:14px; }
  .mg-intro { padding:14px 14px 0; font-size:12px; color:var(--text-secondary, #999); line-height:17px; }
  .mg-checklist { margin:12px 14px 0; padding:0; list-style:none; display:flex; flex-direction:column; gap:6px; font-size:12px; line-height:17px; color:var(--text-primary, #d4d4d4); }
  .mg-check { display:flex; align-items:flex-start; gap:8px; }
  .mg-check-icon { flex:none; width:16px; height:17px; display:flex; align-items:center; justify-content:center; }
  .mg-check-icon svg { width:16px; height:16px; }
  .mg-check[data-state="ok"] .mg-check-icon { color:#6fc872; }
  .mg-check[data-state="bad"] .mg-check-icon { color:var(--accent-error, #f44747); }
  .mg-check[data-state="checking"] { color:var(--text-secondary, #999); }
  .mg-spinner { width:10px; height:10px; border-radius:50%; border:2px solid rgba(74,158,255,.25); border-top-color:var(--accent, #4a9eff); animation:mg-spin .8s linear infinite; }
  @keyframes mg-spin { to { transform:rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .mg-spinner { animation:none; } }
  .mg-progress { margin:12px 14px 0; height:6px; border-radius:3px; background:var(--bg-tertiary, #2c2c2c); overflow:hidden; }
  .mg-progress-fill { height:100%; border-radius:3px; background:var(--accent, #4a9eff); transition:width .25s ease-out; }
  .mg-bottombar { flex:none; height:34px; box-sizing:border-box; display:flex; align-items:stretch; border-top:1px solid var(--border-divider, #2a2a2a); background:var(--bg-secondary, #161616); color:var(--text-secondary, #999); font-size:11px; user-select:none; }
  .mg-title { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .mg-status { padding:8px 14px 0; font-size:12px; line-height:17px; font-weight:500; color:var(--text-primary, #d4d4d4); }
  .mg-status--ok { color:#6fc872; }
  .mg-status--bad { color:var(--accent-error, #f44747); }
  .mg-spacer { flex:1; }
  .mg-btn { display:inline-flex; align-items:center; justify-content:center; flex:none; height:100%; aspect-ratio:1 / 1; padding:0; border:none; border-left:1px solid var(--divider, #333); border-radius:0; background:transparent; color:var(--text-secondary, #999); cursor:pointer; }
  .mg-btn:hover { background:var(--bg-hover, #2a2d2e); color:var(--text-primary, #fff); }
  .mg-btn svg { display:block; width:16px; height:16px; }
  .mg-btn--primary { color:var(--accent, #4a9eff); }
  .mg-btn[aria-disabled="true"] { color:var(--text-muted, #666); cursor:default; }
  .mg-btn[aria-disabled="true"]:hover { background:transparent; color:var(--text-muted, #666); }
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

/** A square icon button for the bottom bar, with the app's tooltip. A
 *  disabled one is `aria-disabled` (not `disabled`, which would hide its
 *  tooltip) and ignores clicks. */
function iconButton(
  action: string,
  label: string,
  icon: string,
  onClick: () => void,
  opts: { primary?: boolean; disabled?: boolean } = {},
): HTMLButtonElement {
  const b = el("button", opts.primary ? "mg-btn mg-btn--primary" : "mg-btn");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.setAttribute("aria-disabled", opts.disabled ? "true" : "false");
  tooltipController.attach(b, { type: "simple", text: label });
  b.setAttribute("data-action", action);
  b.innerHTML = icon;
  b.addEventListener("click", () => {
    if (!opts.disabled) onClick();
  });
  return b;
}

type CheckState = "ok" | "bad" | "checking";

/** The offline checklist: what the download needs. */
function checklist(state: MigrationsViewState): HTMLElement {
  const r = state.requirements;
  const items: Array<[CheckState, string]> = [
    r
      ? r.internet
        ? ["ok", "Connected to the internet"]
        : ["bad", "Not connected to the internet"]
      : ["checking", "Checking the internet connection…"],
    !r || r.github === "checking"
      ? ["checking", "Checking the distribution servers…"]
      : r.github === "ok"
        ? ["ok", "Distribution servers are reachable"]
        : r.github === "rate-limited"
          ? ["bad", rateLimited(r.githubResetAt)]
          : ["bad", "Distribution servers can't be reached"],
  ];
  const list = el("ul", "mg-checklist");
  for (const [checkState, text] of items) {
    const item = el("li", "mg-check");
    item.dataset.state = checkState;
    const icon = el("span", "mg-check-icon");
    if (checkState === "ok") icon.innerHTML = CHECK_ICON;
    if (checkState === "bad") icon.innerHTML = QUIT_ICON;
    if (checkState === "checking") icon.append(el("span", "mg-spinner"));
    item.append(icon, el("span", "mg-check-text", text));
    list.append(item);
  }
  return list;
}

function rateLimited(resetAt: number | undefined): string {
  const base = "The distribution servers have limited requests from this network";
  if (resetAt === undefined) return `${base}. Try again later.`;
  const time = new Date(resetAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${base}. Try again at ${time}.`;
}

function requirementsMet(state: MigrationsViewState): boolean {
  return state.requirements?.internet === true && state.requirements.github === "ok";
}

/** The status below the text (offline shows the checklist instead). */
function statusText(state: MigrationsViewState): string | null {
  if (state.phase === "checking") return "Downloading the update…";
  if (state.phase === "offline") return null;
  if (state.phase === "newer") return "Needs a newer version";
  if (state.phase === "error") return "Could not check";
  if (state.phase === "done") return "Done";
  if (state.phase === "failed") return "Update failed";
  return `${state.completed} of ${state.total} done`;
}

/** Green for good news, red for bad; plain while it is still working. */
function statusTone(state: MigrationsViewState): "ok" | "bad" | null {
  if (state.phase === "done") return "ok";
  if (state.phase === "failed" || state.phase === "error" || state.phase === "newer") return "bad";
  return null;
}

function introText(state: MigrationsViewState): string {
  switch (state.phase) {
    case "newer":
      return `This data was last used by openp41ge code ${state.dataVersion ?? "(a newer version)"}. This older version may not understand it, so it won't open it. Install ${state.dataVersion ?? "that version"} or newer.`;
    case "error":
      return "openp41ge code couldn't check whether your data needs updating, so it won't open it yet. Continue to try again, or quit and try later.";
    case "failed":
      return "This version of openp41ge code needs to update your data, and the update couldn't be finished, so the app won't open. Download the latest version from GitHub and install it again.";
    case "offline":
      return "This version of openp41ge code needs to download an update to your data, and couldn't. Once everything below is ticked, continue.";
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
 *  for the window buttons (the window uses the inset title bar). */
export function renderMigrations(
  root: HTMLElement,
  state: MigrationsViewState,
  actions: MigrationsActions,
  opts: { mac?: boolean } = {},
): void {
  const style = el("style", "");
  style.textContent = STYLES;
  const page = el("div", "mg");

  const titlebar = el("div", "mg-titlebar");
  titlebar.style.paddingLeft = opts.mac ? "82px" : "10px";
  titlebar.append(
    el(
      "span",
      "mg-title",
      state.phase === "newer" || state.phase === "error" ? "Your data" : "Updating your data",
    ),
  );

  const body = el("div", "mg-body");
  body.append(el("div", "mg-intro", introText(state)));
  const status = statusText(state);
  if (status !== null) {
    const tone = statusTone(state);
    body.append(el("div", tone ? `mg-status mg-status--${tone}` : "mg-status", status));
  }
  if (state.phase === "running" || state.phase === "done") body.append(progressBar(state));
  if (state.phase === "offline") body.append(checklist(state));

  const bar = el("div", "mg-bottombar");
  bar.append(el("span", "mg-spacer"));
  if (state.phase === "newer") {
    bar.append(iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()));
  } else if (state.phase === "failed") {
    bar.append(
      iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()),
      iconButton("download", "Download from GitHub", DOWNLOAD_ICON, () => actions.download(), {
        primary: true,
      }),
    );
  } else if (state.phase === "offline" || state.phase === "error") {
    bar.append(
      iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()),
      iconButton("retry", "Continue", CONTINUE_ICON, () => actions.retry(), {
        primary: true,
        disabled: state.phase === "offline" && !requirementsMet(state),
      }),
    );
  }

  page.append(titlebar, body);
  if (bar.querySelector("[data-action]")) page.append(bar);
  root.replaceChildren(style, page);
}
