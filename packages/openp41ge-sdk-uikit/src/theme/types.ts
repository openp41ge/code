/**
 * Syntax theme types — defines the interface for a syntax color scheme.
 *
 * Each theme provides CSS scope colors (for the .view-line .s-* selectors)
 * and an optional vscode-textmate IRawTheme for token coloring.
 */

/**
 * Minimal IRawTheme type — avoids direct dependency on vscode-textmate.
 * Compatible with vscode-textmate's IRawTheme shape.
 */
export interface IRawThemeSetting {
  name?: string;
  scope?: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

export interface IRawTheme {
  name?: string;
  settings: IRawThemeSetting[];
}

/**
 * All scope class colors used by the editor.
 * These map to CSS classes like .s-kw, .s-str, etc.
 */
export interface SyntaxScopeColors {
  /** keyword */
  kw: string;
  /** string */
  str: string;
  /** comment */
  cmt: string;
  /** number */
  num: string;
  /** type */
  type: string;
  /** variable */
  var: string;
  /** function */
  fun: string;
  /** operator */
  op: string;
  /** entity */
  ent: string;
  /** tag */
  tag: string;
  /** attribute */
  atr: string;
  /** support */
  sup: string;
  /** markup */
  mup: string;
  /** heading */
  mh: string;
  /** bold */
  mb: string;
  /** italic */
  mi: string;
  /** link */
  ml: string;
  /** punctuation */
  pun: string;
  /** regex */
  rgx: string;
  /** support.class (Promise, Map, Set) */
  scl: string;
  /** template expression */
  te: string;
  /** label (e.g. HCL block labels) */
  lbl: string;
  /** invalid */
  inv: string;
  /** default text color */
  default: string;
  /** selection background */
  selectionBg: string;
  /** cursor color */
  cursor: string;
  /** current line highlight */
  currentLine: string;
  /** editor background color */
  editorBg: string;
  /** gutter background color */
  gutterBg: string;
  /** Bracket pair colorization palette — one color per depth level (cycles). */
  bracketColors: string[];
}

export interface SyntaxTheme {
  /** Unique identifier (e.g., "dark-plus", "monokai") */
  id: string;
  /** Human-readable label (e.g., "Dark+", "Monokai") */
  label: string;
  /** Whether this is a dark or light theme */
  type: "dark" | "light";
  /** Scope CSS colors (including bracketColors for pair colorization). */
  colors: SyntaxScopeColors;
  /** Optional vscode-textmate IRawTheme for advanced token coloring */
  rawTheme?: IRawTheme;
}
