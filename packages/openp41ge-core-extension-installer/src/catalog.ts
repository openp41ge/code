/**
 * catalog.ts — the official extension catalog (what's installable).
 *
 * A small JSON document published by the platform org (resolves open decision
 * 2): a list of entries, each pointing at a downloadable prebuilt asset and its
 * expected sha256. Kept deliberately loose/forward-compatible: unknown fields
 * on an entry are preserved (ignored), and malformed entries are skipped.
 */

export interface CatalogEntry {
  readonly id: string;
  readonly version: string;
  /** URL of the downloadable self-contained asset (.tgz). */
  readonly asset: string;
  /** Expected sha256 (hex) of the asset bytes. */
  readonly sha256: string;
  /** Publisher/owner; defaults to the org when absent. */
  readonly publisher?: string;
}

export interface ExtensionCatalog {
  readonly extensions: readonly CatalogEntry[];
}

export type FetchJson = (url: string) => Promise<unknown>;

/** Fetch + loosely validate the catalog. Throws on invalid shape. */
export async function fetchCatalog(catalogUrl: string, fetchJson: FetchJson): Promise<ExtensionCatalog> {
  const raw = await fetchJson(catalogUrl);
  const obj = raw as { extensions?: unknown } | null;
  if (!obj || typeof obj !== "object" || !Array.isArray(obj.extensions)) {
    throw new Error("Invalid extension catalog: missing extensions[]");
  }
  const extensions: CatalogEntry[] = [];
  for (const e of obj.extensions as Array<Record<string, unknown>>) {
    if (!e || typeof e.id !== "string" || typeof e.asset !== "string") continue;
    extensions.push({
      id: e.id,
      version: typeof e.version === "string" ? e.version : "",
      asset: e.asset,
      sha256: typeof e.sha256 === "string" ? e.sha256 : "",
      publisher: typeof e.publisher === "string" ? e.publisher : undefined,
    });
  }
  return { extensions };
}
