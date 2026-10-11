/**
 * prerequisites-view.ts — the prerequisites window's view: what the app needs
 * installed, one row each, ending in a green check (found) or a red cross
 * (missing), with a help link for what is missing and Check again / Quit.
 *
 * Plain DOM (no app bootstrap): the window shows when the app cannot start
 * normally, so it depends on nothing else in the renderer.
 */

/** One prerequisite (mirrors the main-process `PrerequisiteResult`). */
export interface PrerequisiteRow {
  readonly id: string;
  readonly name: string;
  readonly requirement: string;
  readonly ok: boolean;
  readonly detail: string;
  readonly helpUrl?: string;
}

export interface PrerequisitesActions {
  recheck(): void;
  quit(): void;
  /** Open the help page of the prerequisite with this id. */
  openHelp(id: string): void;
}

const CHECK_ICON =
  '<svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M382-240 154-468l57-57 171 171 367-367 57 57-424 424Z"/></svg>';
const CROSS_ICON =
  '<svg viewBox="0 -960 960 960" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>';
const REFRESH_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>';
const QUIT_ICON =
  '<svg viewBox="0 -960 960 960" fill="currentColor" aria-hidden="true"><path d="M440-440v-400h80v400h-80Zm40 320q-74 0-139.5-28.5T226-226q-49-49-77.5-114.5T120-480q0-80 33-151t93-123l56 56q-48 40-75 97t-27 121q0 116 82 198t198 82q117 0 198.5-82T760-480q0-64-26.5-121T658-698l56-56q60 52 93 123t33 151q0 74-28.5 139.5t-77.5 114.5q-49 49-114.5 77.5T480-120Z"/></svg>';

// The app's chrome: a 35px title bar and a 34px bottom bar on the gutter /
// secondary backgrounds, 1px dividers, straight edges, and square full-height
// icon buttons in the bottom bar (as the workspace editor's bottom bar).
const STYLES = `
  .pq { display:flex; flex-direction:column; height:100%; background:var(--bg-primary, #1e1e1e); }
  .pq-titlebar { flex:none; height:35px; box-sizing:border-box; display:flex; align-items:center; padding:0 10px; border-bottom:1px solid var(--border-divider, #2d2d2d); background:var(--bg-gutter, #161616); -webkit-app-region:drag; user-select:none; font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.04em; color:var(--text-secondary, #999); }
  .pq-body { flex:1; min-height:0; overflow:auto; display:flex; flex-direction:column; }
  .pq-intro { padding:14px; font-size:12px; color:var(--text-secondary, #999); line-height:17px; border-bottom:1px solid var(--border-divider, #2d2d2d); }
  .pq-row { display:flex; align-items:center; gap:12px; padding:10px 14px; border-bottom:1px solid var(--border-divider, #2d2d2d); }
  .pq-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
  .pq-name { font-size:13px; color:var(--text-primary, #d4d4d4); }
  .pq-req { color:var(--text-secondary, #999); font-size:12px; margin-left:6px; }
  .pq-detail { font-size:12px; color:var(--text-secondary, #999); line-height:16px; user-select:text; overflow-wrap:anywhere; }
  .pq-help { align-self:flex-start; padding:0; border:none; border-radius:0; background:none; color:var(--accent, #4a9eff); font-size:12px; cursor:pointer; }
  .pq-help:hover { text-decoration:underline; }
  .pq-mark { flex-shrink:0; display:flex; }
  .pq-mark[data-status="met"] { color:var(--accent-success, #4caf50); }
  .pq-mark[data-status="missing"] { color:var(--accent-error, #f44747); }
  .pq-bottombar { flex:none; height:34px; box-sizing:border-box; display:flex; align-items:stretch; border-top:1px solid var(--border-divider, #2a2a2a); background:var(--bg-secondary, #161616); color:var(--text-secondary, #999); font-size:11px; user-select:none; }
  .pq-status { flex:1; min-width:0; display:flex; align-items:center; padding:0 8px; }
  .pq-btn { display:inline-flex; align-items:center; justify-content:center; flex:none; height:100%; aspect-ratio:1 / 1; padding:0; border:none; border-left:1px solid var(--divider, #333); border-radius:0; background:transparent; color:var(--text-secondary, #999); cursor:pointer; }
  .pq-btn:hover { background:var(--bg-hover, #2a2d2e); color:var(--text-primary, #fff); }
  .pq-btn svg { display:block; width:16px; height:16px; }
  .pq-btn--primary { color:var(--accent, #4a9eff); }
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

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el("button", className, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** A square icon button for the bottom bar. */
function iconButton(
  label: string,
  icon: string,
  onClick: () => void,
  primary = false,
): HTMLButtonElement {
  const b = button(primary ? "pq-btn pq-btn--primary" : "pq-btn", "", onClick);
  b.title = label;
  b.setAttribute("aria-label", label);
  b.innerHTML = icon;
  return b;
}

function row(p: PrerequisiteRow, actions: PrerequisitesActions): HTMLElement {
  const r = el("div", "pq-row");
  r.setAttribute("data-prerequisite", p.id);

  const text = el("div", "pq-text");
  const name = el("div", "pq-name", p.name);
  name.append(el("span", "pq-req", p.requirement));
  text.append(name, el("div", "pq-detail", p.detail));
  if (!p.ok && p.helpUrl) {
    const help = button("pq-help", `Get ${p.name}`, () => actions.openHelp(p.id));
    help.setAttribute("data-help", p.id);
    text.append(help);
  }

  const mark = el("span", "pq-mark");
  mark.setAttribute("data-status", p.ok ? "met" : "missing");
  mark.setAttribute("role", "img");
  mark.setAttribute("aria-label", p.ok ? "Found" : "Missing");
  mark.innerHTML = p.ok ? CHECK_ICON : CROSS_ICON;

  r.append(text, mark);
  return r;
}

/** Render (or re-render) the prerequisites into `root`. `mac` pads the title
 *  bar for the window buttons (the window uses the inset title bar). */
export function renderPrerequisites(
  root: HTMLElement,
  list: readonly PrerequisiteRow[],
  actions: PrerequisitesActions,
  opts: { mac?: boolean } = {},
): void {
  const style = el("style", "");
  style.textContent = STYLES;
  const page = el("div", "pq");
  const missing = list.filter((p) => !p.ok).length;

  const titlebar = el("div", "pq-titlebar", "Before you start");
  titlebar.style.paddingLeft = opts.mac ? "82px" : "10px";

  const body = el("div", "pq-body");
  body.append(
    el(
      "div",
      "pq-intro",
      missing > 0
        ? "Openp41ge needs the following installed. Install what is missing, then check again."
        : "Everything Openp41ge needs is installed.",
    ),
    ...list.map((p) => row(p, actions)),
  );

  const bar = el("div", "pq-bottombar");
  const quit = iconButton("Quit", QUIT_ICON, () => actions.quit());
  quit.setAttribute("data-action", "quit");
  const recheck = iconButton("Check again", REFRESH_ICON, () => actions.recheck(), true);
  recheck.setAttribute("data-action", "recheck");
  bar.append(
    el("span", "pq-status", missing > 0 ? `${missing} missing` : "All found"),
    quit,
    recheck,
  );

  page.append(titlebar, body, bar);
  root.replaceChildren(style, page);
}
