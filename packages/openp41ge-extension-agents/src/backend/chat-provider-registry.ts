/**
 * ChatProviderRegistry — keyed registry of chat provider factories.
 *
 * New providers register themselves without editing existing code
 * (Open/Closed): call `register(new MyProviderFactory())`. The AgentRuntime
 * resolves a provider factory by id and calls `create(config)` with the
 * current persisted config.
 */

import type { ChatProviderFactory } from "./chat-provider.js";

export class ChatProviderRegistry {
  private readonly _providers = new Map<string, ChatProviderFactory>();

  register(provider: ChatProviderFactory): void {
    this._providers.set(provider.id, provider);
  }

  get(id: string): ChatProviderFactory | undefined {
    return this._providers.get(id);
  }

  has(id: string): boolean {
    return this._providers.has(id);
  }

  list(): ChatProviderFactory[] {
    return Array.from(this._providers.values());
  }

  /** The default provider id (the first registered, or explicitly set). */
  get defaultId(): string | undefined {
    return this._providers.values().next().value?.id;
  }
}
