/**
 * extension-drag-service.ts — the platform side of the extension drag API.
 *
 * Extensions declare drag sources / consumers / drop targets with
 * `registerDragDecls` and tag elements in their templates with
 * `data-drag-source-id` / `data-drop-target-id`. This service:
 *
 *   - attaches ONE delegated `mousedown` listener per mounted surface and
 *     resolves the tagged element per gesture, so elements added by later
 *     re-renders are draggable without re-scanning;
 *   - builds and validates the `DragPayload` from the element's attributes;
 *   - refuses to start a drag that can land nowhere (window context not in the
 *     source's `contexts` and not cross-window);
 *   - hands the drag to the platform pipeline (`PayloadDragPipeline`), which
 *     owns the gesture threshold, ghost, cross-window session and target
 *     resolution; holding the button down (`LONG_PRESS_MS`) without moving
 *     starts the drag too;
 *   - keeps in-place drop receivers keyed per MOUNT, and delivers a drop to the
 *     innermost `[data-drop-target-id]` whose mount accepts the kind. When none
 *     does, `deliverDrop` returns false and the caller falls through to the
 *     enclosing grid.
 */

import type { ILogger } from "openp41ge-core-logger";
import {
  validateDragPayload,
  type DragContext,
  type DragDecls,
  type DragKindDef,
  type DragPayload,
  type DragSourceDecl,
  type DropMeta,
  type DropTargetDecl,
  type SurfaceDragHost,
} from "openp41ge-sdk";

type DropReceiver = Parameters<SurfaceDragHost["registerDropTarget"]>[1];

/** A request to start a platform drag carrying a typed payload. */
export interface PayloadDragRequest {
  /** The tagged source element (for ghost capture / click suppression). */
  readonly element: HTMLElement;
  /** The originating mousedown. */
  readonly event: MouseEvent;
  readonly source: DragSourceDecl;
  readonly payload: DragPayload;
  readonly extensionId: string;
}

/** Where the pointer is when a long-press engages a drag. */
export interface DragEngagePoint {
  readonly clientX: number;
  readonly clientY: number;
  readonly screenX: number;
  readonly screenY: number;
}

/** The platform drag pipeline (orchestrator, ghost, cross-window session). */
export interface PayloadDragPipeline {
  startPayloadDrag(request: PayloadDragRequest): void;
  /** Start the pending drag in place (a long-press); false when none is pending. */
  engageDrag(at: DragEngagePoint): boolean;
}

/** How long the button is held without moving before a drag starts anyway. */
export const LONG_PRESS_MS = 350;

/** Per-mount drag wiring, created by `SurfaceDragBinder.attach`. */
export interface MountDragBinding {
  registerDropTarget(id: string, opts: DropReceiver): () => void;
  /** Remove the delegated listener and every receiver of this mount. */
  dispose(): void;
}

/** Per-extension entry point handed to the renderer runtime. */
export interface SurfaceDragBinder {
  attach(surface: string, container: HTMLElement): MountDragBinding;
}

export interface RendererDragServiceOptions {
  /** This window's drag context, read per gesture (resolved after load). */
  readonly getWindowContext: () => DragContext;
  readonly pipeline: PayloadDragPipeline;
  readonly log: ILogger;
}

interface Mount {
  readonly extensionId: string;
  readonly surface: string;
  readonly receivers: Map<string, DropReceiver>;
}

/**
 * Build the payload for a source from its tagged element's attributes and
 * validate it against its kind (a platform kind, or one of the declared
 * extension `kinds`). Throws (naming the source) when it does not conform.
 */
export function buildDragPayload(
  source: DragSourceDecl,
  element: Element,
  kinds: readonly DragKindDef[] = [],
): DragPayload {
  const raw: Record<string, string> = { kind: source.kind };
  for (const [field, attr] of Object.entries(source.attrs)) {
    const value = element.getAttribute(attr);
    if (value !== null) raw[field] = value;
  }
  try {
    return validateDragPayload(raw, kinds);
  } catch (err) {
    throw new Error(
      `drag source '${source.id}' built an invalid payload: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Walk up from `node`, crossing shadow roots, yielding each element. */
function* composedAncestors(node: Node | null): Generator<Element> {
  let current: Node | null = node;
  while (current) {
    if (current instanceof Element) yield current;
    current = current.parentNode ?? (current instanceof ShadowRoot ? current.host : null);
  }
}

export class RendererDragService {
  private readonly _decls = new Map<string, DragDecls>();
  private readonly _mounts = new Map<HTMLElement, Mount>();
  /** The pending long-press: its timer and the mount it belongs to. */
  private _longPress: { timer: ReturnType<typeof setTimeout>; mount: Mount } | null = null;

  constructor(private readonly _opts: RendererDragServiceOptions) {}

  /** Record (or replace, on reload) an owner's validated declarations. */
  registerDecls(ownerId: string, decls: DragDecls): void {
    this._decls.set(ownerId, decls);
  }

  /** Every extension-declared payload kind registered in this window. */
  kinds(): DragKindDef[] {
    return [...this._decls.values()].flatMap((d) => d.kinds);
  }

  /** Forget an owner's declarations (extension unload / reload). */
  unregisterDecls(ownerId: string): void {
    this._decls.delete(ownerId);
  }

  /** The binder the renderer runtime uses for one extension's mounts. */
  forExtension(extensionId: string): SurfaceDragBinder {
    return { attach: (surface, container) => this._attach(extensionId, surface, container) };
  }

  /**
   * Resolve the innermost `[data-drop-target-id]` at or above `element` whose
   * mount has a live receiver accepting the payload's kind, or null (the
   * caller falls through to the enclosing grid). Throws when the payload is
   * invalid. `deliver` hands the validated payload to that receiver.
   */
  findDropTarget(
    element: Element,
    payload: DragPayload,
  ): { element: HTMLElement; deliver(meta: DropMeta): void } | null {
    const valid = validateDragPayload(payload, this.kinds());
    const mount = this._mountFor(element);
    if (!mount) return null;
    for (const el of composedAncestors(element)) {
      if (this._mounts.get(el as HTMLElement) === mount) break;
      const id = el.getAttribute("data-drop-target-id");
      if (!id) continue;
      const receiver = mount.receivers.get(id);
      const decl = this._dropTargetDecl(mount.extensionId, id);
      if (!receiver || !decl || !decl.accepts.includes(valid.kind)) continue;
      return { element: el as HTMLElement, deliver: (meta) => receiver.onDrop(valid, meta) };
    }
    return null;
  }

  /** `findDropTarget` + deliver. Returns false when nothing receives it. */
  deliverDrop(element: Element, payload: DragPayload, meta: DropMeta): boolean {
    const hit = this.findDropTarget(element, payload);
    hit?.deliver(meta);
    return !!hit;
  }

  private _attach(extensionId: string, surface: string, container: HTMLElement): MountDragBinding {
    const mount: Mount = { extensionId, surface, receivers: new Map() };
    this._mounts.set(container, mount);

    const onMouseDown = (event: MouseEvent): void => this._onMouseDown(mount, container, event);
    container.addEventListener("mousedown", onMouseDown);

    let disposed = false;
    return {
      registerDropTarget: (id, opts) => {
        const decl = this._dropTargetDecl(extensionId, id);
        if (!decl) {
          throw new Error(`registerDropTarget: '${id}' is not a declared drop target`);
        }
        if (decl.surface !== surface) {
          throw new Error(
            `registerDropTarget: '${id}' is declared for '${decl.surface}', not '${surface}'`,
          );
        }
        mount.receivers.set(id, opts);
        return () => {
          if (mount.receivers.get(id) === opts) mount.receivers.delete(id);
        };
      },
      dispose: () => {
        if (disposed) return;
        disposed = true;
        container.removeEventListener("mousedown", onMouseDown);
        if (this._longPress?.mount === mount) this._cancelLongPress();
        mount.receivers.clear();
        if (this._mounts.get(container) === mount) this._mounts.delete(container);
      },
    };
  }

  private _onMouseDown(mount: Mount, container: HTMLElement, event: MouseEvent): void {
    if (event.button !== 0) return;
    const element = this._sourceElement(container, event);
    if (!element) return;
    const id = element.getAttribute("data-drag-source-id") ?? "";
    const source = this._decls.get(mount.extensionId)?.sources.find((s) => s.id === id);
    if (!source) return;
    if (!source.contexts.includes(this._opts.getWindowContext()) && !source.crossWindow) return;

    let payload: DragPayload;
    try {
      payload = buildDragPayload(source, element, this.kinds());
    } catch (err) {
      this._opts.log.error(`extension '${mount.extensionId}' drag failed:`, err, {
        skipToast: true,
      });
      return;
    }
    event.preventDefault();
    this._opts.pipeline.startPayloadDrag({
      element,
      event,
      source,
      payload,
      extensionId: mount.extensionId,
    });
    this._armLongPress(mount, event);
  }

  /**
   * Engage the drag if the button is still down after `LONG_PRESS_MS`. A
   * release first cancels it; moving past the threshold starts the drag
   * sooner, and the engage then does nothing.
   */
  private _armLongPress(mount: Mount, event: MouseEvent): void {
    this._cancelLongPress();
    const at: DragEngagePoint = {
      clientX: event.clientX,
      clientY: event.clientY,
      screenX: event.screenX,
      screenY: event.screenY,
    };
    const timer = setTimeout(() => {
      this._cancelLongPress();
      this._opts.pipeline.engageDrag(at);
    }, LONG_PRESS_MS);
    this._longPress = { timer, mount };
    document.addEventListener("mouseup", this._onLongPressRelease, true);
  }

  private readonly _onLongPressRelease = (): void => this._cancelLongPress();

  private _cancelLongPress(): void {
    if (!this._longPress) return;
    clearTimeout(this._longPress.timer);
    this._longPress = null;
    document.removeEventListener("mouseup", this._onLongPressRelease, true);
  }

  /** The innermost tagged source element on the event path inside `container`. */
  private _sourceElement(container: HTMLElement, event: MouseEvent): HTMLElement | null {
    for (const el of event.composedPath()) {
      if (el === container) return null;
      if (el instanceof HTMLElement && el.hasAttribute("data-drag-source-id")) return el;
    }
    return null;
  }

  private _mountFor(element: Element): Mount | null {
    for (const el of composedAncestors(element)) {
      const mount = this._mounts.get(el as HTMLElement);
      if (mount) return mount;
    }
    return null;
  }

  private _dropTargetDecl(extensionId: string, id: string): DropTargetDecl | undefined {
    return this._decls.get(extensionId)?.dropTargets.find((t) => t.id === id);
  }
}
