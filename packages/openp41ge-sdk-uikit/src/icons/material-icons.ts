/**
 * Material Icon Theme icons — file-type and folder icons for the explorer.
 *
 * SVGs are loaded eagerly at import time via Vite's `import.meta.glob`.
 * Each icon is keyed by its filename (without .svg).
 *
 * The mapping from file extensions/file names to icon names follows the
 * Material Icon Theme conventions (simplified subset).
 */

// ── Load all SVG files as raw strings (eager) ────────────────────────────

const iconModules: Record<string, string> = import.meta.glob("./material-icons/*.svg", {
  query: "?raw",
  import: "default",
  eager: true,
});

const iconMap = new Map<string, string>();
for (const [path, content] of Object.entries(iconModules)) {
  const name = path.split("/").pop()!.replace(".svg", "");
  iconMap.set(name, content as string);
}

function getIcon(name: string): string | undefined {
  return iconMap.get(name);
}

// ── Icon lookup maps (extension → icon name, file name → icon name) ─────

const extensionMap: Record<string, string> = {
  // Web
  html: "html",
  htm: "html",
  xhtml: "html",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescriptreact",
  mts: "typescript",
  cts: "typescript",
  vue: "vue",
  svelte: "svelte",

  // Scripting / config
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  env: "tune",
  md: "markdown",
  mdx: "markdown",

  // Programming languages
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  java: "java",
  kt: "kotlin",
  scala: "scala",
  swift: "swift",
  dart: "dart",
  c: "c",
  h: "h",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hxx: "cpp",
  cs: "csharp",
  fs: "fsharp",
  php: "php",
  pl: "perl",
  pm: "perl",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  lua: "lua",
  r: "r",
  erl: "erlang",
  ex: "elixir",
  exs: "elixir",
  hs: "haskell",
  clj: "clojure",
  cljs: "clojure",
  sql: "database",
  graphql: "graphql",
  gql: "graphql",

  // Build / tooling
  dockerfile: "docker",
  eslintrc: "eslint",
  prettierrc: "prettier",
  babelrc: "babel",
  webpack: "webpack",
  vite: "vite",
  rollup: "rollup",
  gitignore: "git",
  gitattributes: "git",
  gitmodules: "git",
  editorconfig: "editorconfig",

  // Images / media
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  svg: "svg",
  webp: "image",
  ico: "image",
  mp4: "video",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  pdf: "pdf",
  txt: "text",
  csv: "csv",
  log: "log",

  // Archives
  zip: "zip",
  tar: "zip",
  gz: "zip",
  bz2: "zip",
  rar: "zip",
  "7z": "zip",

  // Misc
  wasm: "wasm",
  lock: "lock",
};

const fileNameMap: Record<string, string> = {
  "package.json": "nodejs",
  "package-lock.json": "nodejs",
  "yarn.lock": "yarn",
  "pnpm-lock.yaml": "pnpm",
  "tsconfig.json": "typescriptdef",
  "vite.config.ts": "vite",
  "vite.config.js": "vite",
  "next.config.js": "next",
  "next.config.ts": "next",
  "nuxt.config.js": "nuxt",
  "nuxt.config.ts": "nuxt",
  Dockerfile: "docker",
  "docker-compose.yml": "docker",
  Makefile: "makefile",
  "Makefile.am": "makefile",
  "Makefile.in": "makefile",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".env": "tune",
  ".env.example": "tune",
  "README.md": "markdown",
  "CHANGELOG.md": "markdown",
  LICENSE: "license",
  "LICENSE.md": "license",
  ".editorconfig": "editorconfig",
  "webpack.config.js": "webpack",
  "webpack.config.ts": "webpack",
  "rollup.config.js": "rollup",
  "rollup.config.ts": "rollup",
  "eslint.config.js": "eslint",
  "eslint.config.ts": "eslint",
  ".prettierrc": "prettier",
  ".prettierrc.json": "prettier",
  ".babelrc": "babel",
  ".babelrc.json": "babel",
  ".eslintrc": "eslint",
  ".eslintrc.json": "eslint",
  ".gitkeep": "folder",
};

/** Return all available icon names (SVG filenames without extension). */
export function getAllIconNames(): string[] {
  return Array.from(iconMap.keys()).sort();
}

/**
 * Get the Material icon SVG for a given filename.
 * Looks up by exact file name first, then by extension.
 * Falls back to the default file icon.
 */
export function getFileIcon(filename: string): string {
  // Try exact file name match
  const fileNameMatch = fileNameMap[filename];
  if (fileNameMatch) {
    const icon = getIcon(fileNameMatch);
    if (icon) return icon;
  }

  // Try extension match
  const ext = filename.split(".").pop()?.toLowerCase();
  if (ext && extensionMap[ext]) {
    const icon = getIcon(extensionMap[ext]);
    if (icon) return icon;
  }

  // Fallback: try the filename as icon name (for files like ".gitignore")
  const icon = getIcon(filename.replace(/^\./, ""));
  if (icon) return icon;

  // Final fallback: default file icon
  return getIcon("file") ?? "";
}
