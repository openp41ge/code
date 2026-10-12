/**
 * openp41ge-core-extension-installer — GitHub-releases distribution support.
 *
 * Implements the pluggable `ExtensionSource` for official extensions, given a
 * catalog manifest that maps extension ids to prebuilt release assets. All
 * sources install into the same `~/.openp41ge-code/extensions/` root; this package
 * owns that root's `state.json` (the installed map).
 */

export type { InstalledExtension, ExtensionAcquireResult, ExtensionSource } from "./source";
export {
  GithubReleaseSource,
  type GithubReleaseSourceOptions,
  type FetchJson,
  type FetchBinary,
  type ExtractTgz,
} from "./github-release-source";
export { fetchCatalog, type CatalogEntry, type ExtensionCatalog } from "./catalog";
export { extractTgz, isUnsafeEntryPath, type ExtractOptions } from "./extract";
export { readState, writeState, type ExtensionState, type InstalledEntry } from "./state";
