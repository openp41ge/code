/**
 * migrations-view.ts — the migration window's view: the data updates this
 * version needs, one row each with its description and a mark (pending,
 * running, done, failed). While they run the bottom bar shows the progress;
 * when one fails, its error, with Show the journal / Quit / Retry.
 *
 * Plain DOM (no app bootstrap): the window shows before the app starts, so
 * it depends on nothing else in the renderer. Styled as the prerequisites
 * window.
 */

/** One instruction set (mirrors the main-process `MigrationRow`). */
export interface MigrationRowView {
  readonly id: string;
  readonly description: string;
  readonly state: "pending" | "running" | "done" | "failed";
  readonly error?: string;
}

/** The window's state (mirrors the main-process `MigrationSessionState`). */
export interface MigrationsViewState {
  /**
   * `checking`: downloading the updates; `offline`: they could not be;
   * `newer`: the data was last used by a newer version (never opened);
   * `error`: the check itself failed.
   */
  readonly phase: "checking" | "offline" | "newer" | "error" | "running" | "done" | "failed";
  readonly rows: readonly MigrationRowView[];
  /** Why the download or the check failed (`offline`, `error`). */
  readonly error?: string;
  /** The version that last used the data (`newer`). */
  readonly dataVersion?: string;
}

export interface MigrationsActions {
  retry(): void;
  quit(): void;
  /** Show the journal (what ran, and the failure) in Finder. */
  showJournal(): void;
}

const CHECK_ICON =
  '<svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const CROSS_ICON =
  '<svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
const REFRESH_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>';
const QUIT_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M440-440v-400h80v400h-80Zm40 320q-74 0-139.5-28.5T226-226q-49-49-77.5-114.5T120-480q0-80 33-151t93-123l56 56q-48 40-75 97t-27 121q0 116 82 198t198 82q117 0 198.5-82T760-480q0-64-26.5-121T658-698l56-56q60 52 93 123t33 151q0 74-28.5 139.5t-77.5 114.5q-49 49-114.5 77.5T480-120Z"/></svg>';
const JOURNAL_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M320-240h320v-80H320v80Zm0-160h320v-80H320v80ZM240-80q-33 0-56.5-23.5T160-160v-640q0-33 23.5-56.5T240-880h320l240 240v480q0 33-23.5 56.5T720-80H240Zm280-520v-200H240v640h480v-440H520ZM240-800v200-200 640-640Z"/></svg>';

const STYLES = `
  .mg { display:flex; flex-direction:column; height:100%; background:var(--bg-primary, #1e1e1e); }
  .mg-titlebar { flex:none; height:35px; box-sizing:border-box; display:flex; align-items:center; padding:0 10px; border-bottom:1px solid var(--border-divider, #2d2d2d); background:var(--bg-gutter, #161616); -webkit-app-region:drag; user-select:none; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-secondary, #999); }
  .mg-body { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; }
  .mg-intro { padding:14px; font-size:12px; color:var(--text-secondary, #999); line-height:17px; border-bottom:1px solid var(--border-divider, #2d2d2d); }
  .mg-row { display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border-divider, #2d2d2d); }
  .mg-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .mg-desc { font-size:13px; color:var(--text-primary, #d4d4d4); line-height:17px; }
  .mg-row[data-state="pending"] .mg-desc { color:var(--text-secondary, #999); }
  .mg-error { font-size:12px; color:var(--accent-error, #f44747); line-height:16px; user-select:text; overflow-wrap:anywhere; }
  .mg-mark { flex-shrink:0; width:20px; height:20px; display:flex; align-items:center; justify-content:center; }
  .mg-mark[data-state="done"] { color:var(--accent-success, #4caf50); }
  .mg-mark[data-state="failed"] { color:var(--accent-error, #f44747); }
  .mg-mark[data-state="running"] { color:#4a9eff; }
  .mg-mark[data-state="running"] svg { width:16px; height:16px; animation:mg-spin .9s linear infinite; }
  .mg-mark[data-state="pending"]::before { content:""; width:6px; height:6px; border-radius:50%; background:var(--text-muted, #666); }
  @keyframes mg-spin { to { transform:rotate(360deg); } }
  .mg-bottombar { flex:none; height:34px; box-sizing:border-box; display:flex; align-items:stretch; border-top:1px solid var(--border-divider, #2a2a2a); background:var(--bg-secondary, #161616); color:var(--text-secondary, #999); font-size:11px; user-select:none; }
  .mg-status { flex:1; min-width:0; display:flex; align-items:center; padding:0 8px; }
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

/** A square icon button for the bottom bar. */
function iconButton(
  action: string,
  label: string,
  icon: string,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const b = el("button", primary ? "mg-btn mg-btn--primary" : "mg-btn");
  b.type = "button";
  b.title = label;
  b.setAttribute("aria-label", label);
  b.setAttribute("data-action", action);
  b.innerHTML = icon;
  b.addEventListener("click", onClick);
  return b;
}

const MARK_LABELS = { pending: "Waiting", running: "Updating", done: "Done", failed: "Failed" };

function row(r: MigrationRowView): HTMLElement {
  const item = el("div", "mg-row");
  item.setAttribute("data-migration", r.id);
  item.setAttribute("data-state", r.state);
  const text = el("div", "mg-text");
  text.append(el("div", "mg-desc", r.description));
  if (r.state === "failed" && r.error) text.append(el("div", "mg-error", r.error));
  const mark = el("span", "mg-mark");
  mark.setAttribute("data-state", r.state);
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", MARK_LABELS[r.state]);
  mark.innerHTML =
    r.state === "done"
      ? CHECK_ICON
      : r.state === "failed"
        ? CROSS_ICON
        : r.state === "running"
          ? REFRESH_ICON
          : "";
  item.append(text, mark);
  return item;
}

function statusText(state: MigrationsViewState): string {
  if (state.phase === "checking") return "Downloading the update…";
  if (state.phase === "offline") return "Offline";
  if (state.phase === "newer") return "Needs a newer version";
  if (state.phase === "error") return "Could not check";
  if (state.phase === "done") return "Done";
  if (state.phase === "failed") return "Update failed";
  const current = state.rows.findIndex((r) => r.state === "running" || r.state === "pending");
  return `Updating ${Math.max(1, current + 1)} of ${state.rows.length}…`;
}

function introText(state: MigrationsViewState): string {
  switch (state.phase) {
    case "newer":
      return `This data was last used by Openp41ge ${state.dataVersion ?? "(a newer version)"}. This older version may not understand it, so it will not open it. Install ${state.dataVersion ?? "that version"} or newer.`;
    case "error":
      return "Openp41ge could not check whether your data needs updating, so it will not open it yet. Retry, or quit and try again later.";
    case "failed":
      return "An update to your data did not finish. Nothing after it has run. Retry, or quit and try again later.";
    case "offline":
      return "This version of Openp41ge needs to be online once, to download an update to your data. Check your connection and retry.";
    case "checking":
      return "Downloading an update to your data…";
    default:
      return "This version of Openp41ge moves some of your data to a new layout. It opens when this is done.";
  }
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

  const titlebar = el(
    "div",
    "mg-titlebar",
    state.phase === "newer" || state.phase === "error" ? "Your data" : "Updating your data",
  );
  titlebar.style.paddingLeft = opts.mac ? "82px" : "10px";

  const body = el("div", "mg-body");
  body.append(
    el("div", "mg-intro", introText(state)),
    ...((state.phase === "offline" || state.phase === "error") && state.error
      ? [el("div", "mg-row mg-error mg-offline", state.error)]
      : []),
    ...state.rows.map(row),
  );

  const bar = el("div", "mg-bottombar");
  bar.append(el("span", "mg-status", statusText(state)));
  if (state.phase === "newer") {
    bar.append(iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()));
  } else if (state.phase === "failed" || state.phase === "offline" || state.phase === "error") {
    if (state.phase === "failed") {
      bar.append(
        iconButton("show-journal", "Show the journal", JOURNAL_ICON, () => actions.showJournal()),
      );
    }
    bar.append(
      iconButton("quit", "Quit", QUIT_ICON, () => actions.quit()),
      iconButton("retry", "Retry", REFRESH_ICON, () => actions.retry(), true),
    );
  }

  page.append(titlebar, body, bar);
  root.replaceChildren(style, page);
}
