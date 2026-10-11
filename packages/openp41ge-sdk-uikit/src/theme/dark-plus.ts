/**
 * Openp41ge Dark — default dark syntax theme for Openp41ge.
 */

import type { SyntaxTheme, IRawTheme } from "./types";

const RAW_THEME: IRawTheme = {
  name: "Openp41ge Dark",
  settings: [
    { settings: { foreground: "#D4D4D4", background: "#1E1E1E" } },
    { name: "Comment", scope: "comment", settings: { foreground: "#6A9955", fontStyle: "italic" } },
    { name: "String", scope: "string", settings: { foreground: "#CE9178" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#B5CEA8" } },
    { name: "Built-in constant", scope: "constant.language", settings: { foreground: "#569CD6" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#569CD6" } },
    { name: "Type", scope: "storage.type", settings: { foreground: "#569CD6" } },
    {
      name: "Function declaration",
      scope: "entity.name.function",
      settings: { foreground: "#DCDCAA" },
    },
    { name: "Class name", scope: "entity.name.type.class", settings: { foreground: "#4EC9B0" } },
    { name: "Variable", scope: "variable", settings: { foreground: "#9CDCFE" } },
    { name: "Operator", scope: "keyword.operator", settings: { foreground: "#D4D4D4" } },
    {
      name: "JSON key",
      scope: "meta.structure.dictionary.key.json",
      settings: { foreground: "#9CDCFE" },
    },
    {
      name: "JSON string",
      scope: "string.quoted.double.json",
      settings: { foreground: "#CE9178" },
    },
    { name: "Tag", scope: "entity.name.tag", settings: { foreground: "#569CD6" } },
    {
      name: "Attribute name",
      scope: "entity.other.attribute-name",
      settings: { foreground: "#9CDCFE" },
    },
    {
      name: "Markdown heading",
      scope: "markup.heading",
      settings: { foreground: "#569CD6", fontStyle: "bold" },
    },
    { name: "Markdown bold", scope: "markup.bold", settings: { fontStyle: "bold" } },
    { name: "Markdown italic", scope: "markup.italic", settings: { fontStyle: "italic" } },
    {
      name: "Markdown link",
      scope: "markup.underline.link",
      settings: { foreground: "#569CD6", fontStyle: "underline" },
    },
    {
      name: "CSS property",
      scope: "support.type.property-name.css",
      settings: { foreground: "#9CDCFE" },
    },
    {
      name: "CSS value",
      scope: "support.constant.property-value.css",
      settings: { foreground: "#CE9178" },
    },
    { name: "CSS selector", scope: "entity.name.tag.css", settings: { foreground: "#D7BA7D" } },
    {
      name: "Shell command",
      scope: "entity.name.function.shell",
      settings: { foreground: "#DCDCAA" },
    },
    {
      name: "Shell parameter",
      scope: "variable.parameter.shell",
      settings: { foreground: "#9CDCFE" },
    },
  ],
};

export const darkPlusTheme: SyntaxTheme = {
  id: "openp41ge-dark",
  label: "Openp41ge Dark",
  type: "dark",
  colors: {
    kw: "#569CD6",
    str: "#CE9178",
    cmt: "#6A9955",
    num: "#B5CEA8",
    type: "#4EC9B0",
    var: "#9CDCFE",
    fun: "#DCDCAA",
    op: "#D4D4D4",
    ent: "#4EC9B0",
    tag: "#569CD6",
    atr: "#9CDCFE",
    sup: "#9CDCFE",
    mup: "#D4D4D4",
    mh: "#569CD6",
    mb: "#D4D4D4",
    mi: "#D4D4D4",
    ml: "#569CD6",
    pun: "#D4D4D4",
    rgx: "#D16969",
    scl: "#4EC9B0",
    te: "#CE9178",
    lbl: "#C586C0",
    inv: "#F44747",
    default: "#D4D4D4",
    selectionBg: "rgba(87, 145, 217, 0.3)",
    cursor: "#d4d4d4",
    currentLine: "rgba(255,255,255,0.06)",
    editorBg: "#161616",
    gutterBg: "#1a1a1a",
    bracketColors: ["#FFD700", "#DA70D6", "#179FFF", "#FF69B4", "#00FF7F", "#FFA500"],
  },
  rawTheme: RAW_THEME,
};
