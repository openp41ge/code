/**
 * openp41ge-core-extension-host — the main-process extension host for Openp41ge.
 *
 * Loads installed extensions (see `discovery.ts`), drives the
 * `activate`/`deactivate` lifecycle, and collects their contributions into
 * main-process command handlers and renderer component registrations, with
 * per-extension error isolation and log-stream registration.
 */

export { discoverExtensions, type DiscoveredExtension } from "./discovery";
export {
  ExtensionHost,
  type ExtensionHostOptions,
  type ExtensionConfigStore,
  type LoadedExtension,
  type ActiveExtensionSummary,
  type SearchOutcome,
  type CreateOutcome,
  SEARCH_TIMEOUT_MS,
} from "./host";
