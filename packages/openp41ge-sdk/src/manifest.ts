/**
 * manifest.ts — the extension manifest schema and types.
 *
 * The manifest is what the host reads to discover an extension. It is shipped
 * inside the published asset (top-level `package.json` or a sibling manifest
 * file) and validated by the host on discovery and by the installer before
 * extraction.
 */

import { z } from "zod";

/** The `openp41ge.api` contract version the host loads: the self-registering
 *  surface (`registerProcesses` + `registerRenderers`). An extension built for
 *  another version (the removed `0.1` `activate(context)` surface) is not
 *  loaded. */
export const EXTENSION_API_VERSION = "0.2" as const;

export const extensionManifestSchema = z.object({
  /** npm-style package name, e.g. "openp41ge-extension-terminal". */
  name: z.string().min(1),
  /** Semantic version of the extension, e.g. "0.1.0". */
  version: z.string().min(1),
  openp41ge: z.object({
    /** Must be exactly `true` to signal an extension. */
    extension: z.literal(true),
    /** Stable extension id (the log-stream system id), e.g. "openp41ge-terminal". */
    id: z.string().min(1),
    /** Publisher org / author, e.g. "openp41ge" (our org = official). */
    publisher: z.string().min(1),
    /** Backend (main-process) entry module path, relative to the extension
     *  root; it calls `registerProcesses(...)`.
     */
    entry: z.string().min(1),
    /** Renderer-entry module path, relative to the extension root; it calls
     *  `registerRenderers(...)`. Absent for a backend-only extension.
     */
    renderer: z.string().min(1).optional(),
    /** The `openp41ge.api` contract version the extension is built for. */
    api: z.string().default(EXTENSION_API_VERSION),
  }),
});

export type ExtensionManifest = z.infer<typeof extensionManifestSchema>;

/**
 * The `openp41ge` block of a manifest, used by the host/installer independent
 * of the package-level fields.
 */
export type ExtensionManifestMeta = ExtensionManifest["openp41ge"];

/**
 * Parse + validate a manifest object. Returns the typed manifest or throws.
 * The shape is open (extra fields are allowed) so the manifest can carry
 * future metadata without breaking older hosts.
 */
export function parseExtensionManifest(
  raw: unknown,
): ExtensionManifest {
  return extensionManifestSchema.parse(raw);
}

/** True when `raw` is a valid extension manifest. */
export function isExtensionManifest(raw: unknown): raw is ExtensionManifest {
  return extensionManifestSchema.safeParse(raw).success;
}
