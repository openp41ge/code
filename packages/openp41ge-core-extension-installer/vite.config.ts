import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: () => "index.js",
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      // Node builtins + workspace peers + `tar` stay external: the installer's
      // own Rollup build can't bundle tar, but the platform's esbuild build
      // (which is what actually consumes this package into main.js) bundles
      // tar without issue. Keeping it external here avoids Rollup chokepoints.
      external: [/^node:/, "openp41ge-core-logger", "tar"],
    },
  },
});
