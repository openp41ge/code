/**
 * Built-in terminal color themes.
 *
 * Each theme is an xterm.js ITheme partial that can be passed to
 * Openp41geTerminal.setTheme() or set via Openp41geTerminalOptions.terminal.theme.
 */

import type { ITheme } from "@xterm/xterm";

export const THEME_DARK: Partial<ITheme> = {
  background: "#1e1e1e",
  foreground: "#d4d4d4",
  cursor: "#d4d4d4",
  selectionBackground: "#264f78",
  black: "#1e1e1e",
  red: "#f44747",
  green: "#4ec9b0",
  yellow: "#dcdcaa",
  blue: "#569cd6",
  magenta: "#c586c0",
  cyan: "#9cdcfe",
  white: "#d4d4d4",
  brightBlack: "#808080",
  brightRed: "#f44747",
  brightGreen: "#4ec9b0",
  brightYellow: "#dcdcaa",
  brightBlue: "#569cd6",
  brightMagenta: "#c586c0",
  brightCyan: "#9cdcfe",
  brightWhite: "#ffffff",
};

export const THEME_LIGHT: Partial<ITheme> = {
  background: "#ffffff",
  foreground: "#333333",
  cursor: "#333333",
  selectionBackground: "#add6ff",
  black: "#000000",
  red: "#cd3131",
  green: "#00bc00",
  yellow: "#949800",
  blue: "#0451a5",
  magenta: "#bc05bc",
  cyan: "#0598bc",
  white: "#555555",
  brightBlack: "#666666",
  brightRed: "#cd3131",
  brightGreen: "#14ce14",
  brightYellow: "#b5ba00",
  brightBlue: "#0451a5",
  brightMagenta: "#bc05bc",
  brightCyan: "#0598bc",
  brightWhite: "#a5a5a5",
};

export const THEME_DRACULA: Partial<ITheme> = {
  background: "#282a36",
  foreground: "#f8f8f2",
  cursor: "#f8f8f2",
  selectionBackground: "#44475a",
  black: "#21222c",
  red: "#ff5555",
  green: "#50fa7b",
  yellow: "#f1fa8c",
  blue: "#bd93f9",
  magenta: "#ff79c6",
  cyan: "#8be9fd",
  white: "#f8f8f2",
  brightBlack: "#6272a4",
  brightRed: "#ff6e6e",
  brightGreen: "#69ff94",
  brightYellow: "#ffffa5",
  brightBlue: "#d6acff",
  brightMagenta: "#ff92df",
  brightCyan: "#a4ffff",
  brightWhite: "#ffffff",
};

export const THEME_GITHUB_DARK: Partial<ITheme> = {
  background: "#0d1117",
  foreground: "#c9d1d9",
  cursor: "#c9d1d9",
  selectionBackground: "#264f78",
  black: "#484f58",
  red: "#ff7b72",
  green: "#3fb950",
  yellow: "#d29922",
  blue: "#58a6ff",
  magenta: "#bc8cff",
  cyan: "#39c5cf",
  white: "#b1bac4",
  brightBlack: "#6e7681",
  brightRed: "#ffa198",
  brightGreen: "#56d364",
  brightYellow: "#e3b341",
  brightBlue: "#79c0ff",
  brightMagenta: "#d2a8ff",
  brightCyan: "#56d4dd",
  brightWhite: "#f0f6fc",
};

/** Map of built-in theme names for easy lookup. */
export const BUILT_IN_THEMES: Record<string, Partial<ITheme>> = {
  dark: THEME_DARK,
  light: THEME_LIGHT,
  dracula: THEME_DRACULA,
  "github-dark": THEME_GITHUB_DARK,
};
