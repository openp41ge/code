/**
 * vite.extension-runtime.ts — the shared extension runtime's specifiers,
 * modules and import map (used by vite.config.ts; kept separate so it is
 * unit-testable).
 *
 * Installed extensions are built against bare specifiers. The app emits ONE
 * module per specifier (`extension-runtime/<name>.js`, re-exporting that
 * package) in the same build as the app itself, so each module re-exports the
 * very chunks the app runs; the injected import map routes each specifier to
 * its module. The app and every loaded extension therefore share one instance
 * of each package — one SDK registration store, one lit, one UI toolkit (one
 * `customElements` registrar). One module per specifier, rather than one
 * barrel, because `export *` from several packages silently drops every name
 * two of them export.
 */

/**
 * The public extension-facing specifiers: the SDK, lit, and the UI toolkit
 * (all of uikit is public API for extensions).
 */
export const RUNTIME_SPECIFIERS: readonly string[] = [
  "openp41ge-sdk",
  "lit",
  "lit/decorators.js",
  "lit/async-directive.js",
  "lit/directive.js",
  "lit/directives/class-map.js",
  "lit/directives/ref.js",
  "lit/directives/style-map.js",
  "lit/directives/unsafe-html.js",
  "lit/directives/live.js",
  "openp41ge-sdk-uikit",
  "openp41ge-sdk-uikit/theme",
  "openp41ge-sdk-uikit/file-editor",
  "openp41ge-sdk-uikit/tooltip",
  "openp41ge-sdk-uikit/drop-indicator",
  "openp41ge-sdk-uikit/json-editor",
];

/** Directory of the runtime modules (in the build output, and the URL path in dev). */
export const RUNTIME_DIR = "extension-runtime";

/** File-safe module name for a specifier: `lit/directives/ref.js` → `lit__directives__ref`. */
export function runtimeModuleName(specifier: string): string {
  return specifier.replace(/\.js$/, "").replace(/\//g, "__");
}

/** Path of a specifier's runtime module, relative to the build output / dev root. */
export function runtimeModulePath(specifier: string): string {
  return `${RUNTIME_DIR}/${runtimeModuleName(specifier)}.js`;
}

/** The shared specifier whose runtime module lives at `modulePath`, if any. */
export function specifierForRuntimeModule(modulePath: string): string | undefined {
  const normalized = modulePath.replace(/^\/+/, "");
  return RUNTIME_SPECIFIERS.find((s) => runtimeModulePath(s) === normalized);
}

/** Source of a specifier's runtime module: re-exports that package only. */
export function runtimeModuleSource(specifier: string): string {
  return `export * from ${JSON.stringify(specifier)};\n`;
}

/**
 * The import map routing every shared specifier to its runtime
 * module under `baseUrl` (ending in `/`): the dev server root, or `./` beside
 * the built `index.html`.
 */
export function buildRuntimeImportMap(baseUrl: string): { imports: Record<string, string> } {
  const urlOf = (specifier: string) => `${baseUrl}${runtimeModulePath(specifier)}`;
  const imports: Record<string, string> = {};
  for (const specifier of RUNTIME_SPECIFIERS) imports[specifier] = urlOf(specifier);
  return { imports };
}
