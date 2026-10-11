import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        // Browser-safe scope API for the renderer (no Node imports).
        scope: path.resolve(__dirname, "src/scope.ts"),
      },
      formats: ["es"],
      fileName: (_format: string, entryName: string) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Node builtins + workspace peers stay external so the consumer (the
      // platform's main-process build) resolves them once. The extension scope
      // store lives on a global symbol shared with `openp41ge-sdk` (see
      // src/scope.ts), so the SDK and the host meet even as separate copies.
      external(id) {
        if (/^node:/.test(id)) return true;
        if (id === "openp41ge-core-logger") return true;
        if (id === "openp41ge-sdk") return true;
        if (id.startsWith("openp41ge-sdk/")) return true;
        return false;
      },
    },
  },
});
