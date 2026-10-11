import type { IFormatter, IFormatterRegistry } from "../interfaces/formatter-registry";

/**
 * Maps file extensions to formatting implementations.
 * Extensions are stored without the leading dot.
 */
export class ExtensionFormatterRegistry implements IFormatterRegistry {
  private _map = new Map<string, IFormatter>();

  register(extensions: string[], formatter: IFormatter): void {
    for (const ext of extensions) {
      this._map.set(ext, formatter);
    }
  }

  get(extension: string): IFormatter | null {
    return this._map.get(extension) ?? null;
  }

  /** Number of registered formatters (unique by extension). */
  get size(): number {
    return this._map.size;
  }
}
