/**
 * open-kinds.ts — the open kinds the palette knows (SDK `open.ts`): the
 * platform's closed set plus every loaded extension's `registerOpenKinds`,
 * replaced per extension each time its renderer entry loads.
 */

import { PLATFORM_OPEN_KINDS, type OpenKindDef } from "openp41ge-sdk";

const _byExtension = new Map<string, readonly OpenKindDef[]>();

/** Record `extensionId`'s kinds (replacing what it registered before). */
export function setExtensionOpenKinds(extensionId: string, kinds: readonly OpenKindDef[]): void {
  _byExtension.set(extensionId, kinds);
}

/** The extensions' kinds (the platform's are found by the SDK). */
export function extensionOpenKinds(): OpenKindDef[] {
  return [..._byExtension.values()].flat();
}

/** What one of `kind` is called, or the kind itself when unknown. */
export function openKindLabel(kind: string): string {
  return (
    PLATFORM_OPEN_KINDS.find((k) => k.name === kind)?.label ??
    extensionOpenKinds().find((k) => k.name === kind)?.label ??
    kind
  );
}
