/**
 * sidebar-surface-root.ts — the element an extension sidebar tab renders in.
 *
 * The sidebar owns each tab's host (`.sidebar-tab-host`, shown only while it
 * has `visible`), so a sidebar controller must not restyle the host: it
 * appends its own root and renders into that. Styles are inline because the
 * host may sit in a shadow root where utility classes don't cascade.
 */

/** Append an extension surface's root to `host`; returns it and its content element. */
export function appendSidebarSurfaceRoot(host: HTMLElement): {
  root: HTMLElement;
  content: HTMLElement;
} {
  const root = document.createElement("div");
  root.className = "w-full h-full flex flex-col bg-gutter overflow-hidden";
  root.style.cssText =
    "position:relative;width:100%;height:100%;overflow:hidden;box-sizing:border-box;" +
    "background-color:var(--bg-gutter, #161616);";
  const content = document.createElement("div");
  content.className = "flex-1 min-h-0 overflow-hidden";
  content.style.cssText = "position:absolute;inset:0;overflow:hidden;";
  root.append(content);
  host.append(root);
  return { root, content };
}
