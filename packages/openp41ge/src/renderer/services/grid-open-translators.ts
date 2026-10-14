/**
 * grid-open-translators.ts — how a `grid-open-tab` drop opens each app type.
 *
 * A drop on a workspace grid fires `grid-open-tab { tabType, tabConfig }`. The
 * workspace tabs handler turns it into a layout operation (`actionOpenFile` /
 * `splitFileOpen`), which takes `(appType, title, filePath-slot, …, config)`.
 * Each built-in app reads its open-data differently (a file path, a log
 * system, an extension id), so each has a translator here.
 *
 * Any other REGISTERED app type — notably extension surfaces
 * (`ext:<extensionId>:<surfaceId>`) — opens generically: titled by its app
 * registration, with the drop's `tabConfig` as the tab's config (an extension
 * surface receives it as `host.context`, e.g. the dropped `payload`). An
 * unregistered app type is not opened.
 */

import { configEditorTitle } from "../apps/config-editor/title";

/** How to open one drop. */
export interface GridOpenSpec {
  readonly title: string;
  /** The layout operation's file-path slot (identity for de-duplication). */
  readonly filePath?: string;
  /** Extra tab config. */
  readonly config?: Record<string, unknown>;
  /** Forces the pinned state (otherwise the drop's `pinned`, default true). */
  readonly pinned?: boolean;
}

type Translator = (tabConfig: Record<string, unknown>) => GridOpenSpec | null;

const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);

/** Built-in app types with app-specific open data. */
const TRANSLATORS: Readonly<Record<string, Translator>> = {
  "file-viewer": (c) => {
    const filePath = str(c.filePath);
    if (!filePath) return null;
    return { title: filePath.split("/").pop() || filePath, filePath };
  },

  "log-viewer": (c) => {
    const system = str(c.system);
    if (!system) return null;
    return { title: system, config: { system } };
  },

  // One editor per extension (the file-path slot is its identity).
  "config-editor": (c) => {
    const extensionId = str(c.extensionId);
    if (!extensionId) return null;
    return {
      title: configEditorTitle(extensionId),
      filePath: `config:${extensionId}`,
      config: { extensionId },
    };
  },

  // One tab per release (the file-path slot is its identity).
  release: (c) => {
    const tag = str(c.tag);
    if (!tag) return null;
    return { title: tag, filePath: `release:${tag}`, config: { tag, path: `release:${tag}` } };
  },
};

/**
 * Translate a drop of `appType` with `tabConfig` into how to open it, or null
 * when it cannot be opened (missing required data, or an unregistered app
 * type). `appLabel` returns a registered app type's label (undefined when not
 * registered).
 */
export function translateGridOpen(
  appType: string,
  tabConfig: Record<string, unknown>,
  /** A registered app type's title for this tab (its label, or its
   *  `tabLabel` title for the config); undefined when unregistered. */
  appLabel: (appType: string, tabConfig: Record<string, unknown>) => string | undefined,
  /** The opener's key for the tab (`OpenTabRequest.key`): its identity, so
   *  the tab already open for it in the column is reused. */
  key?: string,
): GridOpenSpec | null {
  const translator = TRANSLATORS[appType];
  if (translator) return translator(tabConfig);
  const label = appLabel(appType, tabConfig);
  if (label === undefined) return null;
  return { title: label, ...(key ? { filePath: key } : {}), config: { ...tabConfig } };
}
