/**
 * Minimal markdown → HTML renderer for the Welcome tab's intro content.
 *
 * Supports the subset the intro uses: headings, paragraphs, bold, inline code,
 * bullet + numbered lists, blockquotes (`>` info notes), and inline action
 * buttons. The content is trusted (bundled with the app), so the generated HTML
 * is injected via lit's `unsafeHTML`.
 *
 * Inline action buttons use a fence so they can carry a target:
 *
 *   :::button tab=workspaces
 *   Open Workspaces
 *   :::
 *
 * which becomes `<button class="wm-md-button" data-tab="workspaces">…</button>`.
 * The host component delegates clicks to activate the matching manager tab.
 *
 * The workspace-window explainer uses a container fence that nests more
 * directives, so an animated demo can sit alongside its explanation and
 * the following paragraph flows into the same flex row:
 *
 *   :::workspace-window
 *   :::sidebar-demo
 *   :::
 *   **The sidebar** …
 *   :::
 *
 * `sidebar-demo` emits `<openp41ge-sidebar-demo>`; `sidebar-move-demo` emits
 * `<openp41ge-sidebar-move-demo>`; `grid-demo` emits
 * `<openp41ge-grid-demo>`; `window-intro-demo` emits
 * `<openp41ge-window-intro-demo>`; `stack-demo` emits `<openp41ge-stack-demo>`.
 * `shortcuts` emits a keyboard-shortcut hint block.
 * Unknown directives are ignored.
 */

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inline(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

/** Parse `key=value key="value"` attribute pairs from a directive header. */
function parseAttrs(s: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /(\w+)(?:=("([^"]*)"|([^\s]+)))?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    attrs[m[1]] = m[3] ?? m[4] ?? "";
  }
  return attrs;
}

/** Collect the body lines of a `:::name …` fence up to its matching `:::`.
 *  Nested fences are tracked by depth, so a container directive can embed
 *  other directives (e.g. `workspace-window` wrapping `skeleton` + `card`).
 *  Returns the body and the index (into `lines`) of the closing delimiter. */
function collectFenceBody(lines: string[], start: number): { body: string[]; closeIndex: number } {
  const body: string[] = [];
  let depth = 1;
  let i = start;
  while (i < lines.length) {
    const t = lines[i].trim();
    if (t === ":::") {
      depth--;
      if (depth === 0) return { body, closeIndex: i };
      body.push(lines[i]);
    } else if (/^:::\s*\S/.test(t)) {
      depth++;
      body.push(lines[i]);
    } else {
      body.push(lines[i]);
    }
    i++;
  }
  return { body, closeIndex: i };
}

export function renderMarkdown(md: string): string {
  const lines = md.split(/\r?\n/);
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;
  /** Text lines of the current paragraph (consecutive non-blank lines merge). */
  let para: string[] = [];

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };
  const flushPara = (): void => {
    if (para.length) {
      out.push(`<p>${inline(escapeHtml(para.join(" ")))}</p>`);
      para = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ── Block directive (`:::name …` … `:::`) ────────────────────────────
    if (trimmed.startsWith(":::")) {
      const open = line.match(/^:::\s*([a-z-]+)([\s\S]*)$/);
      if (open) {
        closeList();
        flushPara();
        const name = open[1];
        const attrs = parseAttrs(open[2]);
        const { body, closeIndex } = collectFenceBody(lines, i + 1);
        if (name === "button") {
          const tab = attrs.tab ?? "";
          const content = body.join(" ").trim();
          out.push(
            `<button class="wm-md-button" data-tab="${escapeHtml(tab)}">${inline(escapeHtml(content))}</button>`,
          );
        } else if (name === "workspace-window") {
          const inner = renderMarkdown(body.join("\n"));
          // The demo sits at half width; any other content (the explanation
          // text and any shortcut hints) stacks in a column beside it.
          const m = inner.match(
            /^(<openp41ge-[a-z-]+-demo><\/openp41ge-[a-z-]+-demo>)\n?([\s\S]*)$/,
          );
          if (m) {
            out.push(
              `<div class="wm-window-stage">${m[1]}\n<div class="wm-window-copy">${m[2]}</div></div>`,
            );
          } else {
            out.push(`<div class="wm-window-stage">${inner}</div>`);
          }
        } else if (name === "window-intro-demo") {
          out.push(`<openp41ge-window-intro-demo></openp41ge-window-intro-demo>`);
        } else if (name === "stack-demo") {
          out.push(`<openp41ge-stack-demo></openp41ge-stack-demo>`);
        } else if (name === "workspace-tab-demo") {
          out.push(`<openp41ge-workspace-tab-demo></openp41ge-workspace-tab-demo>`);
        } else if (name === "sidebar-demo") {
          out.push(`<openp41ge-sidebar-demo></openp41ge-sidebar-demo>`);
        } else if (name === "sidebar-move-demo") {
          out.push(`<openp41ge-sidebar-move-demo></openp41ge-sidebar-move-demo>`);
        } else if (name === "grid-demo") {
          out.push(`<openp41ge-grid-demo></openp41ge-grid-demo>`);
        } else if (name === "shortcuts") {
          out.push(
            `<div class="wm-shortcuts">` +
              `<div class="wm-shortcut"><span class="kbd">&#8984;B</span><span>Toggle the right sidebar</span></div>` +
              `<div class="wm-shortcut"><span class="kbd">&#8984;&#8997;B</span><span>Toggle the left sidebar</span></div>` +
              `</div>`,
          );
        }
        // Unknown directive names are ignored.
        i = closeIndex;
      }
      i++;
      continue;
    }

    // ── Blockquote (info note) ───────────────────────────────────────────
    if (trimmed.startsWith(">")) {
      closeList();
      flushPara();
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        `<blockquote class="wm-md-quote">${inline(escapeHtml(quote.join(" ")))}</blockquote>`,
      );
      continue;
    }

    if (!trimmed) {
      closeList();
      flushPara();
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      flushPara();
      const level = heading[1].length;
      out.push(`<h${level}>${inline(escapeHtml(heading[2]))}</h${level}>`);
      i++;
      continue;
    }

    const list = line.match(/^(?:(\d+)\.\s+|[-*]\s+)(.*)$/);
    if (list) {
      flushPara();
      const type: "ul" | "ol" = list[1] ? "ol" : "ul";
      if (listType !== type) {
        closeList();
        out.push(`<${type}>`);
        listType = type;
      }
      out.push(`<li>${inline(escapeHtml(list[2]))}</li>`);
      i++;
      continue;
    }

    // Ordinary text continues the current paragraph (wrapped source lines).
    para.push(trimmed);
    i++;
  }
  flushPara();
  closeList();
  return out.join("\n");
}
