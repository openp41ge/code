import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        theme: path.resolve(__dirname, "src/theme/index.ts"),
        "file-editor": path.resolve(__dirname, "src/file-editor/index.ts"),
        tooltip: path.resolve(__dirname, "src/components/tooltip/index.ts"),
        "drop-indicator": path.resolve(__dirname, "src/components/drop-indicator/index.ts"),
        "json-editor": path.resolve(__dirname, "src/json-editor/index.ts"),
        "json-form": path.resolve(__dirname, "src/json-form/index.ts"),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    // Don't extract CSS — components inline it from generated/tailwind.ts
    cssCodeSplit: false,
    rollupOptions: {
      external: [
        /^openp41ge-/,
        // Keep a single lit instance across the app — consumers provide it
        // (the tooltip subsystem is lit-only). The main app and uikit demos all
        // alias this package to source, so this only affects the built dist
        // chunks (incl. the standalone `tooltip` entry used by extensions).
        /^lit$/,
        /^lit\//,
      ],
    },
  },
});
