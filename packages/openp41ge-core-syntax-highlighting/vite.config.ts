import { defineConfig } from "vite";

export default defineConfig({
  build: {
    lib: {
      entry: {
        index: new URL("./src/index.ts", import.meta.url).pathname,
        "textmate-init": new URL("./src/textmate-init.ts", import.meta.url).pathname,
        "token-registry": new URL("./src/token-registry.ts", import.meta.url).pathname,
        "line-tokens": new URL("./src/line-tokens.ts", import.meta.url).pathname,
        "lazy-tokenization-manager": new URL("./src/lazy-tokenization-manager.ts", import.meta.url)
          .pathname,
        tokenizer: new URL("./src/tokenizer.ts", import.meta.url).pathname,
        "contiguous-tokens-store": new URL("./src/contiguous-tokens-store.ts", import.meta.url)
          .pathname,
        "encoded-token-attributes": new URL("./src/encoded-token-attributes.ts", import.meta.url)
          .pathname,
      },
      formats: ["es"],
      fileName: (_format, entryName) => `${entryName}.js`,
    },
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: true,
  },
  // JSON grammar files and WASM should be treated as assets
  assetsInclude: ["**/*.tmLanguage.json", "**/*.wasm"],
});
