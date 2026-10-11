/**
 * Monokai theme — classic Monokai color scheme.
 */

import type { SyntaxTheme } from "./types";
import type { IRawTheme } from "vscode-textmate";

const RAW_THEME: IRawTheme = {
  name: "Monokai",
  settings: [
    { settings: { foreground: "#F8F8F2", background: "#272822" } },
    { name: "Comment", scope: "comment", settings: { foreground: "#75715E", fontStyle: "italic" } },
    { name: "String", scope: "string", settings: { foreground: "#E6DB74" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#AE81FF" } },
    { name: "Built-in constant", scope: "constant.language", settings: { foreground: "#AE81FF" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#F92672" } },
    { name: "Type", scope: "storage.type", settings: { foreground: "#F92672" } },
    {
      name: "Function declaration",
      scope: "entity.name.function",
      settings: { foreground: "#A6E22E" },
    },
    { name: "Class name", scope: "entity.name.type.class", settings: { foreground: "#A6E22E" } },
    { name: "Variable", scope: "variable", settings: { foreground: "#F8F8F2" } },
    { name: "Operator", scope: "keyword.operator", settings: { foreground: "#F92672" } },
    { name: "Tag", scope: "entity.name.tag", settings: { foreground: "#F92672" } },
    {
      name: "Attribute name",
      scope: "entity.other.attribute-name",
      settings: { foreground: "#A6E22E" },
    },
    {
      name: "Markdown heading",
      scope: "markup.heading",
      settings: { foreground: "#A6E22E", fontStyle: "bold" },
    },
    { name: "Markdown bold", scope: "markup.bold", settings: { fontStyle: "bold" } },
    { name: "Markdown italic", scope: "markup.italic", settings: { fontStyle: "italic" } },
    {
      name: "CSS property",
      scope: "support.type.property-name.css",
      settings: { foreground: "#66D9EF" },
    },
    {
      name: "CSS value",
      scope: "support.constant.property-value.css",
      settings: { foreground: "#E6DB74" },
    },
    { name: "CSS selector", scope: "entity.name.tag.css", settings: { foreground: "#F92672" } },
  ],
};

export const monokaiTheme: SyntaxTheme = {
  id: "monokai",
  label: "Monokai",
  type: "dark",
  colors: {
    kw: "#F92672",
    str: "#E6DB74",
    cmt: "#75715E",
    num: "#AE81FF",
    type: "#A6E22E",
    var: "#F8F8F2",
    fun: "#A6E22E",
    op: "#F92672",
    ent: "#A6E22E",
    tag: "#F92672",
    atr: "#A6E22E",
    sup: "#66D9EF",
    mup: "#F8F8F2",
    mh: "#A6E22E",
    mb: "#F8F8F2",
    mi: "#F8F8F2",
    ml: "#66D9EF",
    pun: "#F8F8F2",
    rgx: "#E6DB74",
    scl: "#A6E22E",
    te: "#E6DB74",
    lbl: "#FD971F",
    inv: "#F44747",
    default: "#F8F8F2",
    selectionBg: "rgba(255, 255, 255, 0.1)",
    cursor: "#F8F8F2",
    currentLine: "rgba(255,255,255,0.05)",
    editorBg: "#272822",
    gutterBg: "#1e1f1c",
    bracketColors: ["#E6DB74", "#AE81FF", "#66D9EF", "#FD971F", "#A6E22E", "#F92672"],
  },
  rawTheme: RAW_THEME,
};
