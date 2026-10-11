/**
 * extension-protocol.ts — the `openp41ge-ext://` custom protocol that serves
 * extension assets to the renderer.
 *
 * Why a custom scheme rather than `file://`:
 *
 *   - Module scripts loaded cross-origin need CORS-friendly responses and a
 *     proper MIME type; a custom standard+secure scheme with `corsEnabled`
 *     gives the renderer a consistent, predictable way to `import()` an
 *     extension's renderer entry (and its shared runtime) in both dev and
 *     production.
 *   - It lets the host serve assets from an extension's **install root** without
 *     exposing arbitrary filesystem paths (the resolver is path-traversal-safe).
 *
 * The handler is split so the **pure resolution logic** (`resolveExtensionAsset`)
 * is testable in Node without Electron; only the thin `install…` wrappers touch
 * the `protocol` module.
 *
 * URL shape: `openp41ge-ext://<extensionId>/<path/.to/file>`. The shared
 * extension runtime (`lit`, the SDK, the UI toolkit) is not served here: the
 * import map points at the app's own `extension-runtime/` modules.
 */

import { promises as fs } from "fs";
import path from "path";

/** An extension's absolute install root, keyed by its id. */
export interface ExtensionAssetRoot {
  readonly id: string;
  /** Absolute path to the extension's install root. */
  readonly root: string;
}

export const EXTENSION_SCHEME = "openp41ge-ext";

/** Result of resolving a request against the extension asset roots. */
export interface AssetRequestResult {
  readonly status: number;
  readonly body?: Buffer;
  readonly contentType?: string;
  readonly error?: string;
}

const MIME: Readonly<Record<string, string>> = {
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".cjs": "text/javascript",
  ".json": "application/json",
  ".css": "text/css",
  ".html": "text/html",
  ".svg": "image/svg+xml",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".png": "image/png",
  ".woff2": "font/woff2",
};

function mimeFor(filePath: string): string {
  return MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

/** The raw path portion of a URL string, before URL normalization. */
function rawPathOf(requestUrl: string): string {
  const schemeEnd = requestUrl.indexOf("://");
  if (schemeEnd === -1) return "";
  const afterScheme = requestUrl.slice(schemeEnd + 3);
  const slash = afterScheme.indexOf("/");
  return slash === -1 ? "" : afterScheme.slice(slash).split("?")[0].split("#")[0];
}

/** True when the raw path contains a `..` traversal segment. */
function hasTraversalSegment(rawPath: string): boolean {
  return rawPath.split("/").some((s) => s === "..");
}

/**
 * Resolve a request URL to a file served from the asset roots. Pure of
 * Electron so it can be unit-tested.
 */
export async function resolveExtensionAsset(
  requestUrl: string,
  roots: readonly ExtensionAssetRoot[],
): Promise<AssetRequestResult> {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return { status: 400, error: "invalid url" };
  }
  const host = url.hostname;
  const pathname = decodeURIComponent(url.pathname);
  const normalized = pathname.replace(/^\/+/, "");

  const rootInfo = roots.find((r) => r.id === host);
  if (!rootInfo) {
    return { status: 404, error: `unknown extension '${host}'` };
  }
  // Defense-in-depth: URLs may normalise away `..` before we see the pathname,
  // so inspect the raw request path too. The filesystem containment check
  // below is the real boundary.
  if (hasTraversalSegment(rawPathOf(requestUrl))) {
    return { status: 403, error: "invalid path" };
  }
  if (normalized === "") {
    return { status: 403, error: "invalid path" };
  }
  const resolved = path.resolve(rootInfo.root, normalized);
  if (!isWithin(rootInfo.root, resolved)) {
    return { status: 403, error: "path escapes the extension root" };
  }
  return serveFile(resolved);
}

async function serveFile(filePath: string): Promise<AssetRequestResult> {
  try {
    const body = await fs.readFile(filePath);
    return { status: 200, body, contentType: mimeFor(filePath) };
  } catch (err) {
    const code = (err as { code?: string }).code;
    return {
      status: code === "ENOENT" ? 404 : 500,
      error: code === "ENOENT" ? `not found: ${path.basename(filePath)}` : "failed to read asset",
    };
  }
}

// ─── Electron wiring (only imported in the main process) ────────────────────

import { protocol } from "electron";

/**
 * Register the custom scheme as privileged. **Must be called before
 * `app.whenReady()` resolves** (i.e. at the top of startup).
 */
export function registerExtensionSchemePrivileges(scheme = EXTENSION_SCHEME): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        corsEnabled: true,
        stream: true,
      },
    },
  ]);
}

import type { Session } from "electron";

/** Install the request handler on the default session (call after ready). */
export function installExtensionProtocolHandler(
  getRoots: () => readonly ExtensionAssetRoot[],
): void {
  protocol.handle(EXTENSION_SCHEME, async (request) => {
    const result = await resolveExtensionAsset(request.url, getRoots());
    const headers: Record<string, string> = {};
    if (result.contentType) headers["content-type"] = result.contentType;
    // Cross-origin module loads (file:// prod / http://localhost dev) need CORS.
    headers["access-control-allow-origin"] = "*";
    return new Response(result.body ? new Uint8Array(result.body) : null, {
      status: result.status,
      headers,
      statusText: result.error ?? undefined,
    });
  });
}

/** Convenience wrapper if a specific session is required later. */
export function installExtensionProtocolHandlerOnSession(
  session: Session,
  getRoots: () => readonly ExtensionAssetRoot[],
): void {
  session.protocol.handle(EXTENSION_SCHEME, async (request) => {
    const result = await resolveExtensionAsset(request.url, getRoots());
    const headers: Record<string, string> = {};
    if (result.contentType) headers["content-type"] = result.contentType;
    headers["access-control-allow-origin"] = "*";
    return new Response(result.body ? new Uint8Array(result.body) : null, {
      status: result.status,
      headers,
      statusText: result.error ?? undefined,
    });
  });
}
