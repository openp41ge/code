/**
 * tailwind.preset.js — shared design token preset for all openp41ge UI packages.
 *
 * Each colour references a CSS custom property so the app's themes.css
 * controls actual values at runtime (dark/light mode). The fallback
 * matches the dark-theme value from themes.css.
 *
 * NOTE: This file uses module.exports (CJS) because Tailwind's config
 * loader uses require() internally.
 */

module.exports = {
  theme: {
    extend: {
      colors: {
        // Text
        primary: "var(--text-primary, #d4d4d4)",
        secondary: "var(--text-secondary, #999)",
        muted: "var(--text-muted, #666)",
        accent: "var(--text-accent, #569cd6)",
        link: "var(--text-link, #569cd6)",

        // Backgrounds
        "bg-primary": "var(--bg-primary, #1e1e1e)",
        "bg-secondary": "var(--bg-secondary, #181818)",
        "bg-tertiary": "var(--bg-tertiary, #2a2a2a)",
        "bg-surface": "var(--bg-surface, #161616)",
        gutter: "var(--bg-gutter, #1a1a1a)",
        hover: "var(--bg-hover, #2a2d2e)",
        active: "var(--bg-active, #37373d)",
        selected: "rgba(74,158,255,0.08)",
        pane: "var(--bg-pane, #1e1e1e)",
        tab: "var(--bg-tab-active, #1e1e1e)",
        overlay: "var(--bg-overlay, rgba(0,0,0,0.55))",

        // Borders
        divider: "var(--border-divider, #2d2d2d)",
        "border-color": "var(--border-color, #333)",
        "border-light": "var(--border-light, #444)",
        focus: "var(--border-focus, #4a9eff)",

        // Status
        success: "var(--accent-success, #4ec9b0)",
        warning: "var(--accent-warning, #dcdcaa)",
        error: "var(--accent-error, #f44747)",
        info: "var(--accent-info, #9cdcfe)",
      },
      fontFamily: {
        mono: ['"SF Mono"', "Monaco", "Menlo", "Consolas", "monospace"],
      },
      fontSize: {
        "2xs": ["10px", { lineHeight: "14px" }],
        xs: ["11px", { lineHeight: "16px" }],
        sm: ["12px", { lineHeight: "18px" }],
        13: ["13px", { lineHeight: "18px" }],
      },
      spacing: {
        sidebar: "48px",
        row: "28px",
      },
    },
  },
};
