import { defineConfig, type Plugin } from "vite";
import path from "path";
import {
  RUNTIME_DIR,
  RUNTIME_SPECIFIERS,
  buildRuntimeImportMap,
  runtimeModuleName,
  runtimeModulePath,
  runtimeModuleSource,
  specifierForRuntimeModule,
} from "./vite.extension-runtime";

// ─── Shared extension runtime ("one copy" via import map) ────────────────
// Installed extensions are built against bare specifiers (see
// vite.extension-runtime.ts). Each shared specifier gets a virtual runtime
// module (`/extension-runtime/<name>.js`, `export * from "<specifier>"`); the
// injected import map routes the specifier to it, for loaded extensions.
//  - dev: Vite serves the virtual modules; their imports resolve to the same
//    URLs as the app's own imports, so there is one instance.
//  - build: each runtime module is an extra entry of the app build, emitted
//    unhashed at `extension-runtime/<name>.js` beside `index.html`. Being the
//    same build, it re-exports the very chunks the app runs (one instance).
//    The import map points at it relatively (file://); an extension module
//    served over openp41ge-ext:// imports it fine (verified in Electron 43).

/** Serve/emit the runtime modules and inject the import map. */
function extensionRuntimeImportMap(): Plugin {
  let command: "serve" | "build" = "build";
  return {
    name: "openp41ge-extension-runtime",
    enforce: "pre",
    configResolved(config) {
      command = config.command;
    },
    resolveId(id) {
      const specifier = specifierForRuntimeModule(id);
      return specifier ? `/${runtimeModulePath(specifier)}` : null;
    },
    load(id) {
      const specifier = specifierForRuntimeModule(id);
      return specifier ? runtimeModuleSource(specifier) : null;
    },
    transformIndexHtml() {
      const baseUrl = command === "serve" ? "/" : "./";
      const { imports } = buildRuntimeImportMap(baseUrl);
      return [
        {
          tag: "script",
          attrs: { type: "importmap" },
          children: JSON.stringify({ imports }, null, 2),
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig({
  root: "src/renderer",
  base: "./",
  build: {
    outDir: "../../dist",
    emptyOutDir: true,
    // Emit .js.map files for Sentry source-map upload, but without a
    // sourceMappingURL comment ("hidden") so the shipped bundle doesn't
    // reference them / they aren't picked up against packaged files.
    sourcemap: "hidden",
    rollupOptions: {
      input: {
        index: path.resolve(__dirname, "src/renderer/index.html"),
        confirm: path.resolve(__dirname, "src/renderer/confirm.html"),
        fatal: path.resolve(__dirname, "src/renderer/fatal.html"),
        prerequisites: path.resolve(__dirname, "src/renderer/prerequisites.html"),
        migrations: path.resolve(__dirname, "src/renderer/migrations.html"),
        ...Object.fromEntries(
          RUNTIME_SPECIFIERS.map((specifier) => [
            `${RUNTIME_DIR}/${runtimeModuleName(specifier)}`,
            `/${runtimeModulePath(specifier)}`,
          ]),
        ),
      },
      // The runtime modules are reached via the import map at runtime, never
      // statically imported by the app bundle, so Rollup's default
      // `exports-only` signature mode would tree-shake away their re-exports.
      // Preserve them all so each module exposes its package's full API.
      preserveEntrySignatures: "strict",
      output: {
        // Runtime modules keep stable, unhashed paths (the import map names
        // them); everything else keeps Vite's default hashed naming.
        entryFileNames: (chunk) =>
          chunk.name.startsWith(`${RUNTIME_DIR}/`) ? "[name].js" : "assets/[name]-[hash].js",
      },
    },
  },
  resolve: {
    alias: [
      // @openp41ge/layout is internal to the openp41ge package
      { find: "@openp41ge/layout", replacement: path.resolve(__dirname, "src/layout") },

      // Source aliases for dev mode — vite serves directly from lib package source      // so changes are picked up without rebuilds. Build output (dist/) is still
      // used by nx run-many -t build for production builds.
      {
        find: "openp41ge-core-logger",
        replacement: path.resolve(__dirname, "../openp41ge-core-logger/src"),
      },
      {
        find: "openp41ge-core-constants",
        replacement: path.resolve(__dirname, "../openp41ge-core-constants/src"),
      },
      {
        find: "openp41ge-core-filesystem",
        replacement: path.resolve(__dirname, "../openp41ge-core-filesystem/src"),
      },
      {
        // Must precede the `openp41ge-sdk-uikit` prefix alias so the agents package's
        // narrow tooltip import resolves to the self-contained tooltip source
        // instead of a bogus `.../src/tooltip` path (or uikit's prebuilt dist).
        find: "openp41ge-sdk-uikit/tooltip",
        replacement: path.resolve(__dirname, "../openp41ge-sdk-uikit/src/components/tooltip"),
      },
      {
        find: "openp41ge-sdk-uikit/drop-indicator",
        replacement: path.resolve(
          __dirname,
          "../openp41ge-sdk-uikit/src/components/drop-indicator",
        ),
      },
      {
        find: "openp41ge-sdk-uikit",
        replacement: path.resolve(__dirname, "../openp41ge-sdk-uikit/src"),
      },
      {
        find: "openp41ge-sdk-uikit/theme",
        replacement: path.resolve(__dirname, "../openp41ge-sdk-uikit/src/theme"),
      },
      {
        find: "openp41ge-core-syntax-highlighting",
        replacement: path.resolve(__dirname, "../openp41ge-core-syntax-highlighting/src"),
      },
      {
        find: "openp41ge-core-tabs",
        replacement: path.resolve(__dirname, "../openp41ge-core-tabs/src"),
      },
      {
        find: "openp41ge-core-editor-gutter",
        replacement: path.resolve(__dirname, "../openp41ge-core-editor-gutter/src"),
      },
      {
        find: "openp41ge-core-editor-engine",
        replacement: path.resolve(__dirname, "../openp41ge-core-editor-engine/src"),
      },
      {
        find: "openp41ge-sdk-uikit/git-repository",
        replacement: path.resolve(__dirname, "../openp41ge-sdk-uikit/src/git-repository"),
      },
      {
        find: "openp41ge-core-terminal",
        replacement: path.resolve(__dirname, "../openp41ge-core-terminal/src"),
      },
    ],
  },

  server: {
    port: 8642,
    strictPort: true,
    // File-change watching via the native FSEvents backend is unreliable here
    // (processes receive no fs events), so poll for changes to keep HMR and
    // module invalidation working in dev.
    watch: { usePolling: true, interval: 200 },
  },

  // Replace the OPENP41GE_DEBUG env var with a build-time constant so the
  // renderer can check it (agents: OPENP41GE_DEBUG=1 seeds a debug session).
  // APP_VERSION / APP_CHANNEL are injected by the release pipeline so the
  // renderer reports the same release/environment the main process uses.
  define: {
    __OPENP41GE_DEBUG__: JSON.stringify(
      process.env.OPENP41GE_DEBUG === "1" || process.env.OPENP41GE_DEBUG === "true",
    ),
    __OPENP41GE_VERSION__: JSON.stringify(process.env.APP_VERSION ?? "0.0.0-dev"),
    __OPENP41GE_CHANNEL__: JSON.stringify(process.env.APP_CHANNEL ?? "development"),
  },

  plugins: [extensionRuntimeImportMap()],
});
