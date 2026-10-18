/**
 * openp41ge-sdk — the extension contract (public SDK) for Openp41ge.
 *
 * The platform (`openp41ge`) is an extension host: every system that does
 * user-facing work is an extension distributed as a prebuilt GitHub release
 * asset. This package is the contract those extensions are built against and
 * the host validates:
 *
 *   - `manifest.ts`      — the discovery manifest (+ zod schema).
 *   - `context.ts`       — what a backend handler receives (payload,
 *                          `HandlerContext`) and the active-extension summary.
 *   - `registration.ts`  — `registerProcesses` / `registerRenderers` /
 *                          `registerDragDecls` and the `SurfaceHost`.
 *   - `config.ts`        — the config schema an extension registers, its
 *                          defaults, validation and merge.
 *   - `drag.ts`          — the drag & drop vocabulary, declarations + schemas.
 *   - `open.ts`          — what the open palette opens (open kinds) and the
 *                          search providers that find it.
 *
 * Extensions depend on this package (plus the shared packages they use) and
 * never on each other or on the platform itself.
 */

export {
  EXTENSION_API_VERSION,
  extensionManifestSchema,
  parseExtensionManifest,
  isExtensionManifest,
  type ExtensionManifest,
  type ExtensionManifestMeta,
} from "./manifest";

export {
  type HandlerResult,
  type HandlerPayload,
  type HandlerFn,
  type HandlerContext,
  type HandlerCaller,
  type HandlerCommands,
  type CallerCommands,
  type HandlerWorkspace,
  type CallerWorkspace,
  type WorkspaceRoot,
  type WorkspaceRepository,
  type WorktreeAddition,
  type GitRequest,
  type GitResult,
  EXTENSION_ID_SEPARATOR,
  qualifyName,
  type ActiveExtensionSummary,
} from "./context";

export {
  type SurfaceKind,
  type ElementNode,
  type RendererFn,
  type GridSurfaceSpec,
  type TabLabel,
  type SidebarSurfaceSpec,
  type SurfaceSpec,
  type SurfaceWorkspace,
  type RendererRegistrations,
  type ProcessRegistrations,
  type OpenTabRequest,
  type SurfaceHost,
  type SurfaceDragHost,
  type SurfaceConfigHost,
  type DropMeta,
  type SurfaceWorkspaceHost,
  type WorkspaceFileChange,
  type WorkspaceActionResult,
  type GitTranscript,
  type BranchState,
  type RepositoryState,
  type ContextMenuEntry,
  type RepositoryAddition,
  type CloneProgress,
  registerProcesses,
  registerRenderers,
  registerDragDecls,
  registerConfigSchema,
  registerDispose,
  registerOpenKinds,
  registerSearchProvider,
  registerCommandBinaries,
} from "./registration";

export {
  splitCommandLine,
  matchCommandRule,
  checkCommand,
  commandRulesAt,
  parseCommandBinaries,
  type CommandBinaryDecl,
  type CommandBinaryRegistrations,
  type CommandBinaryDef,
  type CommandBinaryInfo,
  type CommandRules,
  type CommandCheck,
  type CommandRequest,
  type CommandResult,
} from "./commands";

export {
  PLATFORM_OPEN_NAMESPACE,
  PLATFORM_OPEN_KINDS,
  parseOpenKinds,
  findOpenKind,
  validateOpenParams,
  parseSearchItems,
  openItemKey,
  type OpenKind,
  type OpenParamType,
  type OpenParamsSchema,
  type OpenKindDecl,
  type OpenKindDef,
  type OpenRegistrations,
  type SearchOpenItem,
  type SearchCreateItem,
  type SearchItem,
  type SearchProvider,
} from "./open";

export {
  validateConfigSchema,
  configDefaults,
  configErrors,
  mergeConfig,
  type ConfigSchema,
  type ConfigType,
  type ExtensionConfig,
} from "./config";

export {
  DRAG_CONTEXTS,
  PLATFORM_DRAG_NAMESPACE,
  PLATFORM_DRAG_KINDS,
  PLATFORM_DRAG_KIND_LABELS,
  validateDragPayload,
  dragSourceSchema,
  dragConsumerSchema,
  dropTargetSchema,
  parseDragRegistrations,
  findConsumerDropTargetConflicts,
  assertNoConsumerDropTargetConflicts,
  validateDragDeclSurfaces,
  type DragContext,
  type DragKind,
  type DragKindDecl,
  type DragKindDef,
  type DragKindSchema,
  type DragPayload,
  type PlatformDragPayload,
  type PlatformDragKind,
  type ExtensionDragPayload,
  type DragSourceDecl,
  type DragConsumerDecl,
  type DropTargetDecl,
  type DragRegistrations,
  type DragDecls,
  type DragConflict,
} from "./drag";

export { deriveRepoName, validateRepoUrl } from "./repo-name";
