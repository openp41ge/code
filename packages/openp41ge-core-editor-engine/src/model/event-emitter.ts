/**
 * Simple typed event emitter.
 *
 * Used across the editor for decoupled communication between layers.
 */

export type EventListener<T> = (event: T) => void;

export interface Disposable {
  dispose(): void;
}

export class Emitter<T> {
  private _listeners: Array<EventListener<T>> = [];
  private _disposed: boolean = false;

  get event(): (listener: EventListener<T>) => Disposable {
    return (listener: EventListener<T>) => this._subscribe(listener);
  }

  private _subscribe(listener: EventListener<T>): Disposable {
    this._listeners.push(listener);
    return {
      dispose: () => {
        const idx = this._listeners.indexOf(listener);
        if (idx >= 0) this._listeners.splice(idx, 1);
      },
    };
  }

  fire(event: T): void {
    if (this._disposed) return;
    // Iterate over a copy to prevent issues with listeners removing themselves
    const listeners = this._listeners.slice();
    for (const listener of listeners) {
      listener(event);
    }
  }

  dispose(): void {
    this._disposed = true;
    this._listeners = [];
  }
}
