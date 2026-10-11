/**
 * openp41ge-themes — syntax theme definitions and CSS generation utilities.
 *
 * Pure theme data with no runtime dependencies on tokenization engines.
 * Can be safely imported by any package without pulling in TextMate/WASM.
 */
import type { SyntaxTheme, SyntaxScopeColors } from "./types";
export type { SyntaxTheme, SyntaxScopeColors };
import { darkPlusTheme } from "./dark-plus";
export { darkPlusTheme };
import { lightPlusTheme } from "./light-plus";
export { lightPlusTheme };
/**
 * Registry of all built-in syntax themes, keyed by theme ID.
 */
export declare const BUILTIN_THEMES: Record<string, SyntaxTheme>;
/** List of all available themes (for UI pickers). */
export declare const ALL_THEMES: SyntaxTheme[];
/** Get a theme by ID, falling back to dark-plus. */
export declare function getThemeById(id: string): SyntaxTheme;
/** Generate CSS scope styles for a given theme. */
export declare function generateThemeCSS(theme: SyntaxTheme): string;
/** Generate CSS for bracket pair colorization. */
export declare function generateBracketPairCSS(theme: SyntaxTheme): string;
/** Generate global editor CSS that's theme-independent. */
export declare function generateGlobalEditorCSS(): string;
//# sourceMappingURL=index.d.ts.map