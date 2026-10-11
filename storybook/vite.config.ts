import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  server: {
    port: 5847,
    strictPort: true,
  },
  resolve: {
    alias: {
      "openp41ge-sdk-uikit": path.resolve(__dirname, "../packages/openp41ge-sdk-uikit/src"),
      "openp41ge-core-piece-tree": path.resolve(
        __dirname,
        "../packages/openp41ge-core-piece-tree/src",
      ),
      "openp41ge-core-syntax-highlighting": path.resolve(
        __dirname,
        "../packages/openp41ge-core-syntax-highlighting/src",
      ),
      "openp41ge-core-tabs": path.resolve(__dirname, "../packages/openp41ge-core-tabs/src"),
      "openp41ge-core-editor-engine": path.resolve(
        __dirname,
        "../packages/openp41ge-core-editor-engine/src",
      ),
      "openp41ge-core-git": path.resolve(__dirname, "../packages/openp41ge-core-git/src"),
    },
  },
});
