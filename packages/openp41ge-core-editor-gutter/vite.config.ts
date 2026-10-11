import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  build: {
    lib: {
      entry: path.resolve(__dirname, "src/index.ts"),
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
});
