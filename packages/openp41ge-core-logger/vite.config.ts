import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: path.resolve(__dirname, "src/index.ts"),
        viewer: path.resolve(__dirname, "src/viewer.ts"),
      },
      formats: ["es"],
      fileName: (format, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
