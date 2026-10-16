/**
 * actions.ts — what choosing a palette result does: open it in the chosen
 * tab type (a grid tab in the focused column, or a new column; a sidebar tab
 * on its default side), run a create action and open what it made, and
 * remember the pick.
 */

import { parseSearchItems, type SearchOpenItem } from "openp41ge-sdk";
import { createLogger } from "openp41ge-core-logger";
import { getSystemTabRegistration } from "../../apps/app-registry";
import { emitOpenSystemTab } from "../../components/openp41ge-worktree-controller";
import { toastService } from "../../components/openp41ge-toast";
import { extensionOpenKinds } from "../open-kinds";
import { Openp41geTabsEventHandler } from "../openp41ge-tabs-event-handler";
import { orderTabTypes } from "../../../shared/open-palette-ranking";
import { pickFor, type PaletteCatalog, type PaletteEntry, type TabTypeChoice } from "./model";

const log = createLogger("openp41ge", "open-palette");

export interface OpenOptions {
  readonly winId: string;
  /** Open a grid tab in a new column right of the focused one. */
  readonly newColumn: boolean;
  /** What was typed (a create action gets it). */
  readonly query: string;
  readonly catalog: PaletteCatalog;
}

function openGridTab(
  winId: string,
  appType: string,
  params: Readonly<Record<string, unknown>>,
  key: string | undefined,
  newColumn: boolean,
): void {
  const col = Openp41geTabsEventHandler.getLastFocusedCol(winId);
  document.dispatchEvent(
    new CustomEvent("grid-open-tab", {
      detail: {
        winId,
        tabType: appType,
        tabConfig: { ...params },
        targetCol: col,
        pinned: true,
        ...(key ? { tabKey: key } : {}),
        ...(newColumn ? { isBoundary: true, splitCol: col, splitLeft: false } : {}),
      },
    }),
  );
}

function remember(entry: PaletteEntry, tabType: string): void {
  const pick = pickFor(entry, tabType);
  if (!pick) return;
  window.openp41ge?.palette?.record(pick).catch((err: unknown) => {
    log.warn("could not remember the pick:", err);
  });
}

/** Open the log entry of an error (its stream, without one). */
function openLogOf(errorId: string | undefined): void {
  window.openp41ge?.windowManager?.openLogs?.(errorId ? { errorId } : undefined);
}

/** Open `entry` in `tabType`, and remember it. */
export function openEntry(entry: PaletteEntry, tabType: TabTypeChoice, opts: OpenOptions): void {
  if (entry.type === "create") return;
  if (tabType.placement === "sidebar") {
    const reg = getSystemTabRegistration(tabType.id);
    emitOpenSystemTab(opts.winId, tabType.id, tabType.label, reg?.defaultSide);
  } else if (entry.type === "open") {
    openGridTab(opts.winId, tabType.id, entry.item.params, entry.item.key, opts.newColumn);
  } else {
    openGridTab(opts.winId, tabType.id, {}, undefined, opts.newColumn);
  }
  remember(entry, tabType.id);
}

/** Open an item a create action made, in its kind's default tab type. */
function openMade(item: SearchOpenItem, opts: OpenOptions): void {
  const choices = opts.catalog.tabTypesFor(item.kind);
  if (choices.length === 0) {
    log.warn(`nothing opens '${item.kind}', which a create action made`);
    return;
  }
  void window.openp41ge?.palette?.history().then(
    (history) => {
      const [first] = orderTabTypes(
        choices.map((c) => c.id),
        history.tabTypes[item.kind],
        Date.now(),
      );
      openEntry(
        { type: "open", item },
        choices.find((c) => c.id === first)!,
        opts,
      );
    },
    () => openEntry({ type: "open", item }, choices[0], opts),
  );
}

/** Run the create action `entry`, then open what it made. */
export async function runCreate(entry: PaletteEntry, opts: OpenOptions): Promise<void> {
  if (entry.type !== "create") return;
  const palette = window.openp41ge?.palette;
  if (!palette) return;
  if (entry.path) {
    const result = await palette.createPath(entry.path.target, entry.path.what);
    if (!result.ok) {
      const errorId = log.error(`could not create ${entry.path.target}:`, result.error, {
        skipToast: true,
      });
      toastService.show(`Could not create ${entry.path.what}: ${result.error}`, "error", 6000, () =>
        openLogOf(errorId),
      );
      return;
    }
    if (entry.path.what === "folder") {
      toastService.show(`Created folder ${result.path}`, "success");
      return;
    }
    const name = result.path.split("/").pop() ?? result.path;
    openMade(
      { kind: "openp41ge/file", params: { filePath: result.path }, title: name, key: result.path },
      opts,
    );
    return;
  }
  if (!entry.provider) return;
  const { extensionId, providerId, create } = entry.provider;
  const result = await palette.create(extensionId, providerId, create, opts.query);
  if (!result.ok) {
    const errorId = log.error(`'${extensionId}/${providerId}' could not ${create}:`, result.error, {
      skipToast: true,
    });
    toastService.show(`${entry.title} failed`, "error", 6000, () => openLogOf(errorId));
    return;
  }
  if (result.item === null) return;
  const { items, problems } = parseSearchItems([result.item], extensionOpenKinds());
  const made = items[0];
  if (!made || "create" in made) {
    log.warn(`'${extensionId}/${providerId}' made something the palette cannot open:`, problems);
    return;
  }
  openMade(made, opts);
}
