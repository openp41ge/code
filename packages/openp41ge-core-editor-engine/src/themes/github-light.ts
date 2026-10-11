/**
 * GitHub Light theme — GitHub's light syntax color scheme.
 */

import type { SyntaxTheme } from "./types";
import type { IRawTheme } from "vscode-textmate";

const RAW_THEME: IRawTheme = {
  name: "GitHub Light",
  settings: [
    { settings: { foreground: "#24292F", background: "#FFFFFF" } },
    { name: "Comment", scope: "comment", settings: { foreground: "#6E7781", fontStyle: "italic" } },
    { name: "String", scope: "string", settings: { foreground: "#0A3069" } },
    { name: "Number", scope: "constant.numeric", settings: { foreground: "#0550AE" } },
    { name: "Built-in constant", scope: "constant.language", settings: { foreground: "#0550AE" } },
    { name: "Keyword", scope: "keyword", settings: { foreground: "#CF222E" } },
    { name: "Type", scope: "storage.type", settings: { foreground: "#CF222E" } },
    {
      name: "Function declaration",
      scope: "entity.name.function",
      settings: { foreground: "#8250DF" },
    },
    { name: "Class name", scope: "entity.name.type.class", settings: { foreground: "#953800" } },
    { name: "Variable", scope: "variable", settings: { foreground: "#953800" } },
    { name: "Operator", scope: "keyword.operator", settings: { foreground: "#CF222E" } },
    { name: "Tag", scope: "entity.name.tag", settings: { foreground: "#116329" } },
    {
      name: "Attribute name",
      scope: "entity.other.attribute-name",
      settings: { foreground: "#953800" },
    },
    {
      name: "Markdown heading",
      scope: "markup.heading",
      settings: { foreground: "#953800", fontStyle: "bold" },
    },
    { name: "Markdown bold", scope: "markup.bold", settings: { fontStyle: "bold" } },
    { name: "Markdown italic", scope: "markup.italic", settings: { fontStyle: "italic" } },
    {
      name: "CSS property",
      scope: "support.type.property-name.css",
      settings: { foreground: "#0550AE" },
    },
    {
      name: "CSS value",
      scope: "support.constant.property-value.css",
      settings: { foreground: "#0A3069" },
    },
    { name: "CSS selector", scope: "entity.name.tag.css", settings: { foreground: "#116329" } },
  ],
};

export const githubLightTheme: SyntaxTheme = {
  id: "github-light",
  label: "GitHub Light",
  type: "light",
  colors: {
    kw: "#CF222E",
    str: "#0A3069",
    cmt: "#6E7781",
    num: "#0550AE",
    type: "#953800",
    var: "#953800",
    fun: "#8250DF",
    op: "#CF222E",
    ent: "#953800",
    tag: "#116329",
    atr: "#953800",
    sup: "#0550AE",
    mup: "#24292F",
    mh: "#953800",
    mb: "#24292F",
    mi: "#24292F",
    ml: "#0550AE",
    pun: "#24292F",
    rgx: "#0A3069",
    scl: "#953800",
    te: "#0A3069",
    lbl: "#9A6700",
    inv: "#F44747",
    default: "#24292F",
    selectionBg: "rgba(0, 102, 184, 0.2)",
    cursor: "#24292F",
    currentLine: "rgba(0,0,0,0.035)",
    editorBg: "#FFFFFF",
    gutterBg: "#f6f8fa",
    bracketColors: ["#953800", "#8250DF", "#0550AE", "#116329", "#CF222E", "#0A3069"],
  },
  rawTheme: RAW_THEME,
};
