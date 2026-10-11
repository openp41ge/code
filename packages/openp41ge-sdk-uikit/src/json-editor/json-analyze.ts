/**
 * json-analyze — structure analysis for the editor: code-folding ranges
 * (computed by bracket matching, so they work even on transiently-invalid
 * text) and lookup of the AST entry at a given line (for delete / hover).
 *
 * Pure module — no DOM, no platform dependencies.
 */

import type { JsonNode } from "./json-parse";

export interface FoldRange {
  /** Line of the opening `{` / `[` (0-based). */
  openLine: number;
  /** Line of the matching closing `}` / `]` (0-based). */
  closeLine: number;
  kind: "object" | "array";
}

/** Bracket-match the whole text, respecting strings, and report the span of
 *  every object/array. Unclosed brackets are ignored. */
export function computeFoldRanges(text: string): FoldRange[] {
  const lines = text.split("\n");
  const stack: Array<{ ch: string; line: number }> = [];
  const out: FoldRange[] = [];
  let inStr = false;
  let esc = false;
  for (let line = 0; line < lines.length; line++) {
    const s = lines[line];
    for (let c = 0; c < s.length; c++) {
      const ch = s[c];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === "{" || ch === "[") stack.push({ ch, line });
      else if (ch === "}" || ch === "]") {
        const top = stack.pop();
        if (top && ((top.ch === "{" && ch === "}") || (top.ch === "[" && ch === "]"))) {
          if (line > top.line) {
            out.push({
              openLine: top.line,
              closeLine: line,
              kind: top.ch === "{" ? "object" : "array",
            });
          }
        }
      }
    }
  }
  return out.sort((a, b) => a.openLine - b.openLine || a.closeLine - b.closeLine);
}

export interface EntryMatch {
  parent: JsonNode;
  /** Set for object members. */
  member?: { key: string; index: number };
  /** Set for array elements. */
  index?: number;
  /** The node that gets deleted (the member value). */
  node: JsonNode;
  /** Line the entry starts on (the key line for members). */
  line: number;
}

/** Find the object member / array element whose span begins on `line`. Walks
 *  parent-first so an object whose `{` shares the line with its key matches the
 *  whole member (so deleting it removes the entire subtree). */
export function findEntryAtLine(root: JsonNode, line: number): EntryMatch | null {
  if (root.type === "object" && root.members) {
    for (let i = 0; i < root.members.length; i++) {
      const m = root.members[i];
      if (m.keyLine === line || m.value.line === line) {
        return { parent: root, member: { key: m.key, index: i }, node: m.value, line: m.keyLine };
      }
    }
    for (const m of root.members) {
      const r = findEntryAtLine(m.value, line);
      if (r) return r;
    }
  } else if (root.type === "array" && root.elements) {
    for (let i = 0; i < root.elements.length; i++) {
      const el = root.elements[i];
      if (el.line === line) {
        return { parent: root, index: i, node: el, line };
      }
    }
    for (const el of root.elements) {
      const r = findEntryAtLine(el, line);
      if (r) return r;
    }
  }
  return null;
}
