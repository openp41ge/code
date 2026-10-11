/**
 * bundle-extensions.ts — the release build's official extensions.
 *
 * A packaged app has no node_modules, so the official extensions ship as
 * self-contained extension dirs (`<out>/<id>/`), built from each
 * `packages/openp41ge-extension-*` package's sources with esbuild:
 *
 *   - the backend entry (`openp41ge.entry`): Node ESM, everything inlined but
 *     Node builtins. The SDK copy it inlines meets the host through the
 *     global extension scope.
 *   - the renderer entry (`openp41ge.renderer`): browser ESM, the shared
 *     extension runtime (`RUNTIME_SPECIFIERS`: lit, the SDK, the UI toolkit)
 *     left to the app's import map, everything else inlined. Importing lit or
 *     an SDK module the runtime does not share fails the build: inlining a
 *     second copy would break the one-instance guarantee.
 *   - `package.json`: the manifest.
 *
 * Entries map to sources by the packages' layout: `dist/<name>.js` is built
 * from `src/<name>.ts`. Node strips the types (no build step):
 *
 *   node scripts/bundle-extensions.ts [--out dist-extensions]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build, type Plugin } from "esbuild";
import { RUNTIME_SPECIFIERS } from "../vite.extension-runtime.ts";

const EXTENSION_PREFIX = "openp41ge-extension-";

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly description?: string;
  readonly openp41ge: { readonly id: string; readonly entry: string; readonly renderer?: string };
}

/** The repo's extension packages (`openp41ge-extension-*` with a manifest). */
export function officialExtensionDirs(packagesDir: string): string[] {
  return fs
    .readdirSync(packagesDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith(EXTENSION_PREFIX))
    .map((d) => path.join(packagesDir, d.name))
    .filter((dir) => readManifest(dir) !== null)
    .sort();
}

function readManifest(pkgDir: string): Manifest | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf-8"));
    return pkg?.openp41ge?.extension ? (pkg as Manifest) : null;
  } catch {
    return null;
  }
}

/** The source an entry is built from: `dist/<name>.js` → `src/<name>.ts`. */
function sourceOf(pkgDir: string, entry: string): string {
  const source = path.join(pkgDir, entry.replace(/^dist\//, "src/").replace(/\.js$/, ".ts"));
  if (!fs.existsSync(source)) throw new Error(`no source for entry ${entry}: ${source}`);
  return source;
}

/** Leave the shared runtime to the import map; refuse lit / SDK modules it does not share. */
const sharedRuntime: Plugin = {
  name: "shared-extension-runtime",
  setup(b) {
    b.onResolve({ filter: /^(lit|openp41ge-sdk)(-[^/]+)?(\/|$)/ }, (args) => {
      if (RUNTIME_SPECIFIERS.includes(args.path)) return { path: args.path, external: true };
      return {
        errors: [{ text: `"${args.path}" is not part of the shared extension runtime` }],
      };
    });
  },
};

/** Build one extension package into `<outDir>/<id>/`; returns that dir. */
export async function bundleExtension(pkgDir: string, outDir: string): Promise<string> {
  const manifest = readManifest(pkgDir);
  if (!manifest) throw new Error(`not an extension package: ${pkgDir}`);
  const { id, entry, renderer } = manifest.openp41ge;
  const root = path.join(outDir, id);
  fs.rmSync(root, { recursive: true, force: true });

  await build({
    entryPoints: [sourceOf(pkgDir, entry)],
    outfile: path.join(root, entry),
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node22",
    // CommonJS dependencies inlined into ESM still call `require`.
    banner: {
      js: 'import { createRequire } from "module"; const require = createRequire(import.meta.url);',
    },
    logLevel: "warning",
  });
  if (renderer) {
    await build({
      entryPoints: [sourceOf(pkgDir, renderer)],
      outfile: path.join(root, renderer),
      bundle: true,
      platform: "browser",
      format: "esm",
      target: "es2022",
      plugins: [sharedRuntime],
      logLevel: "warning",
    });
  }

  const { name, version, description } = manifest;
  fs.writeFileSync(
    path.join(root, "package.json"),
    `${JSON.stringify({ name, version, description, type: "module", main: entry, openp41ge: manifest.openp41ge }, null, 2)}\n`,
  );
  return root;
}

async function main(): Promise<void> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const outFlag = process.argv.indexOf("--out");
  const outDir = path.resolve(outFlag >= 0 ? process.argv[outFlag + 1] : "dist-extensions");
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const dir of officialExtensionDirs(path.resolve(here, "../.."))) {
    const root = await bundleExtension(dir, outDir);
    process.stdout.write(`bundled ${path.relative(process.cwd(), root)}\n`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err: unknown) => {
    process.stderr.write(
      `bundle-extensions: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
}
