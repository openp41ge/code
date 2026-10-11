/**
 * GitHub Dark theme — GitHub's dark syntax color scheme.
 */

import type { SyntaxTheme } from "./types";
import type { IRawTheme } from "vscode-textmate";

const RAW_THEME: IRawTheme = {
  name: "GitHub Dark",
  settings: [
    { settings: { foreground: "#E1E4E8", background: "#0D1117" } },
    { name: "Comment", scope: "comment", settings: { foreground: "#8B949E", fontStyle: "italic" } },
    { name: "String", scope: "string", settings: { foreground: "#A5D6FF" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#79C0FF" } },
    { name: "Built-in constant", scope: "constant.language", settings: { foreground: "#79C0FF" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#FF7B72" } },
    { name: "Type", scope: "storage.type", settings: { foreground: "#FF7B72" } },
    {
      name: "Function declaration",
      scope: "entity.name.function",
      settings: { foreground: "#D2A8FF" },
    },
    { name: "Class name", scope: "entity.name.type.class", settings: { foreground: "#FFA657" } },
    { name: "Variable", scope: "variable", settings: { foreground: "#FFA657" } },
    { name: "Operator", scope: "keyword.operator", settings: { foreground: "#FF7B72" } },
    { name: "Tag", scope: "entity.name.tag", settings: { foreground: "#7EE787" } },
    {
      name: "Attribute name",
      scope: "entity.other.attribute-name",
      settings: { foreground: "#FFA657" },
    },
    {
      name: "Markdown heading",
      scope: "markup.heading",
      settings: { foreground: "#FFA657", fontStyle: "bold" },
    },
    { name: "Markdown bold", scope: "markup.bold", settings: { fontStyle: "bold" } },
    { name: "Markdown italic", scope: "markup.italic", settings: { fontStyle: "italic" } },
    {
      name: "CSS property",
      scope: "support.type.property-name.css",
      settings: { foreground: "#79C0FF" },
    },
    {
      name: "CSS value",
      scope: "support.constant.property-value.css",
      settings: { foreground: "#A5D6FF" },
    },
    { name: "CSS selector", scope: "entity.name.tag.css", settings: { foreground: "#7EE787" } },
  ],
};

export const githubDarkTheme: SyntaxTheme = {
  id: "github-dark",
  label: "GitHub Dark",
  type: "dark",
  colors: {
    kw: "#FF7B72",
    str: "#A5D6FF",
    cmt: "#8B949E",
    num: "#79C0FF",
    type: "#FFA657",
    var: "#FFA657",
    fun: "#D2A8FF",
    op: "#FF7B72",
    ent: "#FFA657",
    tag: "#7EE787",
    atr: "#FFA657",
    sup: "#79C0FF",
    mup: "#E1E4E8",
    mh: "#FFA657",
    mb: "#E1E4E8",
    mi: "#E1E4E8",
    ml: "#79C0FF",
    pun: "#E1E4E8",
    rgx: "#A5D6FF",
    scl: "#FFA657",
    te: "#A5D6FF",
    lbl: "#E3B341",
    inv: "#F44747",
    default: "#E1E4E8",
    selectionBg: "rgba(87, 145, 217, 0.3)",
    cursor: "#E1E4E8",
    currentLine: "rgba(255,255,255,0.04)",
    editorBg: "#0d1117",
    gutterBg: "#161b22",
    bracketColors: ["#FFA657", "#D2A8FF", "#79C0FF", "#7EE787", "#FF7B72", "#A5D6FF"],
  },
  rawTheme: RAW_THEME,
};
