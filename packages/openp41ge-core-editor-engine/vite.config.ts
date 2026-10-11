import { resolve } from "path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: resolve(__dirname, "src/index.ts"),
        events: resolve(__dirname, "src/events.ts"),
        interfaces: resolve(__dirname, "src/interfaces/index.ts"),
        model: resolve(__dirname, "src/model/index.ts"),
        cursor: resolve(__dirname, "src/cursor/index.ts"),
        input: resolve(__dirname, "src/input/index.ts"),
        rendering: resolve(__dirname, "src/rendering/index.ts"),
        view: resolve(__dirname, "src/view/index.ts"),
        "view-lines": resolve(__dirname, "src/view/view-lines.ts"),
        "word-wrap-helper": resolve(__dirname, "src/view/word-wrap-helper.ts"),
        "wrap-column-calculator": resolve(__dirname, "src/view/wrap-column-calculator.ts"),
        "scroll-manager": resolve(__dirname, "src/view/scroll-manager.ts"),
        "cursor-renderer": resolve(__dirname, "src/rendering/cursor-renderer.ts"),
        "selection-renderer": resolve(__dirname, "src/rendering/selection-renderer.ts"),
        "line-numbers-overlay": resolve(__dirname, "src/rendering/line-numbers-overlay.ts"),
        "current-line-highlight": resolve(__dirname, "src/rendering/current-line-highlight.ts"),
        "indentation-guides": resolve(__dirname, "src/rendering/indentation-guides.ts"),
        "bracket-matching": resolve(__dirname, "src/rendering/bracket-matching.ts"),
        "bracket-pair-service": resolve(__dirname, "src/rendering/bracket-pair-service.ts"),
        "clipboard-handler": resolve(__dirname, "src/input/clipboard-handler.ts"),
        "composition-handler": resolve(__dirname, "src/input/composition-handler.ts"),
        "mouse-handler": resolve(__dirname, "src/input/mouse-handler.ts"),
        "auto-closing-pairs": resolve(__dirname, "src/input/auto-closing-pairs.ts"),
        "formatter-registry": resolve(__dirname, "src/interfaces/formatter-registry.ts"),
        themes: resolve(__dirname, "src/themes/index.ts"),
        services: resolve(__dirname, "src/services/index.ts"),
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      external: [/^openp41ge-/],
    },
  },
});
