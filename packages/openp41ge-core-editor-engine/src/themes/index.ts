/**
 * Syntax theme registry — barrel export for all built-in themes.
 *
 * Provides lookup by theme ID and a list of all available themes.
 */

import type { SyntaxTheme, SyntaxScopeColors } from "./types";
export type { SyntaxTheme, SyntaxScopeColors };

import { darkPlusTheme } from "./dark-plus";
export { darkPlusTheme };
import { lightPlusTheme } from "./light-plus";
export { lightPlusTheme };
import { monokaiTheme } from "./monokai";
export { monokaiTheme };
import { githubDarkTheme } from "./github-dark";
export { githubDarkTheme };
import { githubLightTheme } from "./github-light";
export { githubLightTheme };

/**
 * Registry of all built-in syntax themes, keyed by theme ID.
 */
export const BUILTIN_THEMES: Record<string, SyntaxTheme> = {
  "openp41ge-dark": darkPlusTheme,
  "openp41ge-light": lightPlusTheme,
  monokai: monokaiTheme,
  "github-dark": githubDarkTheme,
  "github-light": githubLightTheme,
};

/** List of all available themes (for UI pickers). */
export const ALL_THEMES: SyntaxTheme[] = Object.values(BUILTIN_THEMES);

/** Get a theme by ID, falling back to dark-plus. */
export function getThemeById(id: string): SyntaxTheme {
  return BUILTIN_THEMES[id] ?? darkPlusTheme; // default: Openp41ge Dark
}

/** Generate CSS scope styles for a given theme. */
export function generateThemeCSS(theme: SyntaxTheme): string {
  const c = theme.colors;
  const bracketCSS = generateBracketPairCSS(theme);
  return `
    .view-line .s-kw { color: ${c.kw}; }
    .view-line .s-str { color: ${c.str}; }
    .view-line .s-cmt { color: ${c.cmt}; font-style: italic; }
    .view-line .s-num { color: ${c.num}; }
    .view-line .s-type { color: ${c.type}; }
    .view-line .s-var { color: ${c.var}; }
    .view-line .s-fun { color: ${c.fun}; }
    .view-line .s-op { color: ${c.op}; }
    .view-line .s-ent { color: ${c.ent}; }
    .view-line .s-tag { color: ${c.tag}; }
    .view-line .s-atr { color: ${c.atr}; }
    .view-line .s-sup { color: ${c.sup}; }
    .view-line .s-mup { color: ${c.mup}; }
    .view-line .s-mh { color: ${c.mh}; font-weight: bold; }
    .view-line .s-mb { font-weight: bold; }
    .view-line .s-mi { font-style: italic; }
    .view-line .s-ml { color: ${c.ml}; text-decoration: underline; }
    .view-line .s-pun { color: ${c.pun}; }
    .view-line .s-rgx { color: ${c.rgx}; }
    .view-line .s-scl { color: ${c.scl}; }
    .view-line .s-te { color: ${c.te}; }
    .view-line .s-lbl { color: ${c.lbl}; }
    .view-line .s-inv { color: ${c.inv}; text-decoration: wavy underline; }
    ${bracketCSS}
  `;
}

/** Generate CSS for bracket pair colorization. */
export function generateBracketPairCSS(theme: SyntaxTheme): string {
  const colors = theme.colors.bracketColors;
  if (!colors || colors.length === 0) return "";
  let css = "";
  for (let i = 0; i < colors.length; i++) {
    css += `    .view-line .s-bracket-d${i} { color: ${colors[i]}; }\n`;
  }
  // Visually distinct color for deeply nested brackets (beyond palette length):
  // cycle through palette but add a subtle brightness shift.
  // This keeps the visual distinctness for very deep nesting.
  return css;
}

/** Generate global editor CSS that's theme-independent. */
export function generateGlobalEditorCSS(): string {
  return `
    /* Font styles */
    .view-line .token-italic { font-style: italic; }
    .view-line .token-bold { font-weight: bold; }
    .view-line .token-underline { text-decoration: underline; }

    .cursor-blink {
      position: absolute;
      width: 2px;
      background: var(--fe-cursor-color, #d4d4d4);
      pointer-events: none;
    }
    .selection-highlight {
      position: absolute;
      background: var(--fe-selection-bg, rgba(87, 145, 217, 0.3));
      pointer-events: none;
    }
    .selection-highlight-secondary {
      opacity: 0.7;
    }

    .top-left-radius { border-top-left-radius: 3px; }
    .top-right-radius { border-top-right-radius: 3px; }
    .bottom-left-radius { border-bottom-left-radius: 3px; }
    .bottom-right-radius { border-bottom-right-radius: 3px; }
    .selection-intern-mask { position: absolute; pointer-events: none; }
    .selection-corner-piece {
      position: absolute;
      background: var(--fe-selection-bg, rgba(87, 145, 217, 0.3));
      pointer-events: none;
    }
    .view-line .current-line-highlight { background: var(--fe-current-line, rgba(255,255,255,0.06)); }
  `;
}
