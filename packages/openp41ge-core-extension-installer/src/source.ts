/**
 * source.ts — a pluggable extension *source* (where installed extensions come
 * from). Only the official GitHub-release source is implemented in v1;
 * user/third-party sources (arbitrary GitHub repos, folders, node_modules)
 * plug in here later without touching the host. Platform-facing, not
 * extension API: it lives here rather than in the SDK.
 *
 * The host consumes installs the same way regardless of source: it only reads
 * the installed-extensions directory on disk. A source is the *acquisition*
 * path (resolve → fetch → verify → extract into the install dir).
 */

/** What an extension is installed as on disk. */
export interface InstalledExtension {
  readonly id: string;
  readonly version: string;
  /** Directory containing the extracted extension. */
  readonly dir: string;
  /** Where it came from (source id), for diagnostics/updates. */
  readonly source: string;
}

/** The result of installing or updating an extension via a source. */
export interface ExtensionAcquireResult {
  readonly installed: InstalledExtension;
  /** True when an existing install was replaced (update). */
  readonly updated: boolean;
  /** Source-reported integrity hash, if any. */
  readonly sha256?: string;
}

/**
 * Pluggable acquisition source. v1 ships a GitHub-release implementation;
 * folder / arbitrary-repo / node_modules sources implement this interface
 * later.
 */
export interface ExtensionSource {
  /** Stable source id, e.g. "github-openp41ge" / "folder" / "npm". */
  readonly id: string;
  /**
   * Install the extension with `id` from this source, returning its on-disk
   * install descriptor. Throws on failure (the caller isolates + logs).
   */
  install(id: string): Promise<ExtensionAcquireResult>;
  /** Update `id`. Returns null when already up-to-date or not installable. */
  update(id: string): Promise<ExtensionAcquireResult | null>;
  /** Remove `id` from the install dir / state. */
  uninstall(id: string): Promise<void>;
}
