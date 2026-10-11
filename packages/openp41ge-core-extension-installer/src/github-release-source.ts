/**
 * github-release-source.ts — the v1 official extension source.
 *
 * Implements the pluggable `ExtensionSource`: installs extensions distributed
 * as prebuilt GitHub release assets, fetched from a catalog manifest published
 * by the platform org. All sources install to the same `~/.openp41ge/extensions/`
 * root.
 *
 * Flow (`install`): fetch catalog → find entry → download asset → verify
 * sha256 → extract into a staging dir → swap into `<installDir>/<id>/` → record
 * in `state.json`. Staging + rename keep installs
 * atomic-ish: a failed download/extract never leaves a half-installed
 * extension.
 */

import { createHash, randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAcquireResult, ExtensionSource, InstalledExtension } from "./source";
import { createLogger, type ILogger } from "openp41ge-core-logger";
import { fetchCatalog, type CatalogEntry, type ExtensionCatalog } from "./catalog";
import { extractTgz, type ExtractOptions } from "./extract";
import { readState, writeState } from "./state";

export type FetchJson = (url: string) => Promise<unknown>;
export type FetchBinary = (url: string) => Promise<Uint8Array>;
export type ExtractTgz = (
  tgzPath: string,
  destDir: string,
  options?: ExtractOptions,
) => Promise<void>;

export interface GithubReleaseSourceOptions {
  /** Publisher/owner of official extensions, e.g. "openp41ge". */
  readonly org: string;
  /** URL of the catalog manifest listing installable extensions. */
  readonly catalogUrl: string;
  /** Install root — all sources land here (`~/.openp41ge/extensions`). */
  readonly installDir: string;
  /** State file path (defaults to `<installDir>/state.json`). */
  readonly stateFile?: string;
  /** Override JSON fetch (tests). Defaults to global `fetch`. */
  readonly fetchJson?: FetchJson;
  /** Override binary fetch (tests). Defaults to global `fetch`. */
  readonly fetchBinary?: FetchBinary;
  /** Override extraction (tests). Defaults to `extractTgz`. */
  readonly extract?: ExtractTgz;
  /** Override logger (tests). */
  readonly createLogger?: (id: string) => ILogger;
}

const defaultFetchJson: FetchJson = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
};

const defaultFetchBinary: FetchBinary = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
};

export class GithubReleaseSource implements ExtensionSource {
  readonly id = "github";

  private readonly _org: string;
  private readonly _catalogUrl: string;
  private readonly _installDir: string;
  private readonly _stateFile: string;
  private readonly _fetchJson: FetchJson;
  private readonly _fetchBinary: FetchBinary;
  private readonly _extract: ExtractTgz;
  private readonly _log: ILogger;

  constructor(options: GithubReleaseSourceOptions) {
    this._org = options.org;
    this._catalogUrl = options.catalogUrl;
    this._installDir = options.installDir;
    this._stateFile = options.stateFile ?? join(options.installDir, "state.json");
    this._fetchJson = options.fetchJson ?? defaultFetchJson;
    this._fetchBinary = options.fetchBinary ?? defaultFetchBinary;
    this._extract = options.extract ?? extractTgz;
    this._log =
      options.createLogger?.("openp41ge-extension-installer") ??
      createLogger("openp41ge-extension-installer", "github-release-source");
  }

  /** Fetch the official catalog (for the management window). */
  list(): Promise<ExtensionCatalog> {
    return fetchCatalog(this._catalogUrl, this._fetchJson);
  }

  private async findEntry(id: string): Promise<CatalogEntry> {
    const catalog = await this.list();
    const entry = catalog.extensions.find((e) => e.id === id);
    if (!entry) throw new Error(`Extension "${id}" not found in the official catalog`);
    return entry;
  }

  async install(id: string): Promise<ExtensionAcquireResult> {
    const entry = await this.findEntry(id);
    const state = await readState(this._stateFile);
    const updated = Boolean(state.installed[id]);
    const dir = join(this._installDir, id);
    const stage = join(this._installDir, `.staging-${id}-${randomUUID()}`);

    try {
      const bytes = await this._fetchBinary(entry.asset);
      if (entry.sha256) {
        const actual = createHash("sha256").update(bytes).digest("hex");
        if (actual !== entry.sha256) {
          throw new Error(`sha256 mismatch for "${id}": expected ${entry.sha256}, got ${actual}`);
        }
      }
      const tgzPath = join(tmpdir(), `${id}-${entry.version}.tgz`);
      await writeFile(tgzPath, bytes);
      await this._extract(tgzPath, stage, { strip: 1 });
      await rm(dir, { recursive: true, force: true });
      await rename(stage, dir);
    } catch (err) {
      await rm(stage, { recursive: true, force: true });
      this._log.error(`Install failed for "${id}":`, err);
      throw err;
    }

    const installed: InstalledEntryState = {
      version: entry.version,
      source: this.id,
      installedAt: new Date().toISOString(),
      sha256: entry.sha256 || undefined,
    };
    state.installed[id] = installed;
    await writeState(this._stateFile, state);
    this._log.info(`Installed "${id}" v${entry.version}${updated ? " (updated)" : ""}`);
    return {
      installed: { id, version: entry.version, dir, source: this.id },
      updated,
      sha256: entry.sha256 || undefined,
    };
  }

  async update(id: string): Promise<ExtensionAcquireResult | null> {
    const state = await readState(this._stateFile);
    if (!state.installed[id]) return null; // not installed → nothing to update
    const entry = await this.findEntry(id);
    if (state.installed[id].version === entry.version) return null; // already latest
    return this.install(id);
  }

  async uninstall(id: string): Promise<void> {
    const dir = join(this._installDir, id);
    await rm(dir, { recursive: true, force: true });
    const state = await readState(this._stateFile);
    delete state.installed[id];
    await writeState(this._stateFile, state);
    this._log.info(`Uninstalled "${id}"`);
  }

  /** Installed extensions (from state), ready to hand to the host's discovery. */
  async listInstalled(): Promise<InstalledExtension[]> {
    const state = await readState(this._stateFile);
    return Object.entries(state.installed).map(([id, e]) => ({
      id,
      version: e.version,
      dir: join(this._installDir, id),
      source: e.source,
    }));
  }
}

type InstalledEntryState = {
  version: string;
  source: string;
  installedAt: string;
  sha256?: string;
};
