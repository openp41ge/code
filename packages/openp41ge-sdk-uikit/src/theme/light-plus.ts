/**
 * Openp41ge Light — default light syntax theme for Openp41ge.
 */

import type { SyntaxTheme, IRawTheme } from "./types";

const RAW_THEME: IRawTheme = {
  name: "Openp41ge Light",
  settings: [
    { settings: { foreground: "#1E1E1E", background: "#FFFFFF" } },
    { name: "Comment", scope: "comment", settings: { foreground: "#008000", fontStyle: "italic" } },
    { name: "String", scope: "string", settings: { foreground: "#A31515" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#098658" } },
    { name: "Built-in constant", scope: "constant.language", settings: { foreground: "#0000FF" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#0000FF" } },
    { name: "Type", scope: "storage.type", settings: { foreground: "#0000FF" } },
    {
      name: "Function declaration",
      scope: "entity.name.function",
      settings: { foreground: "#795E26" },
    },
    { name: "Class name", scope: "entity.name.type.class", settings: { foreground: "#267F99" } },
    { name: "Variable", scope: "variable", settings: { foreground: "#001080" } },
    { name: "Operator", scope: "keyword.operator", settings: { foreground: "#1E1E1E" } },
    { name: "Tag", scope: "entity.name.tag", settings: { foreground: "#800000" } },
    {
      name: "Attribute name",
      scope: "entity.other.attribute-name",
      settings: { foreground: "#E50000" },
    },
    {
      name: "Markdown heading",
      scope: "markup.heading",
      settings: { foreground: "#0000FF", fontStyle: "bold" },
    },
    { name: "Markdown bold", scope: "markup.bold", settings: { fontStyle: "bold" } },
    { name: "Markdown italic", scope: "markup.italic", settings: { fontStyle: "italic" } },
    {
      name: "Markdown link",
      scope: "markup.underline.link",
      settings: { foreground: "#0000FF", fontStyle: "underline" },
    },
    {
      name: "CSS property",
      scope: "support.type.property-name.css",
      settings: { foreground: "#E50000" },
    },
    {
      name: "CSS value",
      scope: "support.constant.property-value.css",
      settings: { foreground: "#0451A5" },
    },
    { name: "CSS selector", scope: "entity.name.tag.css", settings: { foreground: "#800000" } },
  ],
};

export const lightPlusTheme: SyntaxTheme = {
  id: "openp41ge-light",
  label: "Openp41ge Light",
  type: "light",
  colors: {
    kw: "#0000FF",
    str: "#A31515",
    cmt: "#008000",
    num: "#098658",
    type: "#267F99",
    var: "#001080",
    fun: "#795E26",
    op: "#1E1E1E",
    ent: "#267F99",
    tag: "#800000",
    atr: "#E50000",
    sup: "#E50000",
    mup: "#1E1E1E",
    mh: "#0000FF",
    mb: "#1E1E1E",
    mi: "#1E1E1E",
    ml: "#0000FF",
    pun: "#1E1E1E",
    rgx: "#A31515",
    scl: "#267F99",
    te: "#A31515",
    lbl: "#811F3F",
    inv: "#F44747",
    default: "#1E1E1E",
    selectionBg: "rgba(0, 102, 184, 0.25)",
    cursor: "#1E1E1E",
    currentLine: "rgba(0,0,0,0.04)",
    editorBg: "#FFFFFF",
    gutterBg: "#f3f3f3",
    bracketColors: ["#B8860B", "#9932CC", "#1E90FF", "#C71585", "#228B22", "#D2691E"],
  },
  rawTheme: RAW_THEME,
};
