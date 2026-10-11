/**
 * ModelRegistry — shared TextContentModel instances keyed by file path.
 *
 * When the same file is opened in multiple tabs, all tabs share the same
 * model instance. Edits in one tab are immediately visible in all tabs
 * because they share the same piece tree.
 *
 * Usage:
 *   const registry = new ModelRegistry();
 *   const model = await registry.getOrCreate("/path/to/file.ts");
 *   // ... use model ...
 *   registry.release("/path/to/file.ts"); // dispose when last tab closes
 */

import { createIpcTextContentModel } from "./ipc-text-content-model";
import type { PieceTreeTextContentModel } from "openp41ge-sdk-uikit/file-editor";

export class ModelRegistry {
  /** Map of file path → model instance. */
  private readonly _models = new Map<string, PieceTreeTextContentModel>();

  /**
   * Map of file path → reference count.
   * Incremented when getOrCreate is called, decremented on release.
   * The model is disposed only when the count reaches zero.
   */
  private readonly _refCounts = new Map<string, number>();

  /**
   * Map of file path → pending creation promise.
   * Guards against concurrent getOrCreate calls for the same URI.
   */
  private readonly _pendingCreations = new Map<string, Promise<PieceTreeTextContentModel>>();

  /**
   * Get an existing model for the given URI, or create one.
   *
   * Multiple concurrent calls for the same URI will all receive the same
   * model instance.
   *
   * @param uri - The absolute file path.
   * @returns The shared TextContentModel instance.
   */
  async getOrCreate(uri: string): Promise<PieceTreeTextContentModel> {
    // Fast path: already registered
    const existing = this._models.get(uri);
    if (existing) {
      this._incrementRef(uri);
      return existing;
    }

    // Cooperative creation: if another call is already creating this model,
    // wait for it and share the result
    const pending = this._pendingCreations.get(uri);
    if (pending) {
      const model = await pending;
      this._incrementRef(uri);
      return model;
    }

    // Create the model — start the async work and register it so concurrent
    // calls can join via the pending promise
    const promise = createIpcTextContentModel(uri);
    this._pendingCreations.set(uri, promise);

    try {
      const model = await promise;
      this._models.set(uri, model);
      this._refCounts.set(uri, 1);
      return model;
    } finally {
      this._pendingCreations.delete(uri);
    }
  }

  /**
   * Release a reference to a model.
   * When the reference count reaches zero, the model is disposed and
   * removed from the registry.
   *
   * @param uri - The file path to release.
   */
  release(uri: string): void {
    const count = this._refCounts.get(uri) ?? 0;
    if (count <= 1) {
      // Last reference — dispose and remove
      const model = this._models.get(uri);
      if (model) {
        model.dispose();
      }
      this._models.delete(uri);
      this._refCounts.delete(uri);
    } else {
      this._refCounts.set(uri, count - 1);
    }
  }

  /**
   * Check if a model exists in the registry.
   */
  has(uri: string): boolean {
    return this._models.has(uri);
  }

  /**
   * Get the number of active models (for debugging).
   */
  get size(): number {
    return this._models.size;
  }

  /**
   * Get the model for a URI without creating one.
   * Returns undefined if not found.
   */
  get(uri: string): PieceTreeTextContentModel | undefined {
    return this._models.get(uri);
  }

  /**
   * Release all models. Used for cleanup.
   */
  dispose(): void {
    for (const [, model] of this._models) {
      model.dispose();
    }
    this._models.clear();
    this._refCounts.clear();
    this._pendingCreations.clear();
  }

  private _incrementRef(uri: string): void {
    const count = this._refCounts.get(uri) ?? 0;
    this._refCounts.set(uri, count + 1);
  }
}
