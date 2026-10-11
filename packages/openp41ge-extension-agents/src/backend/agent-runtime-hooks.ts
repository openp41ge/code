/**
 * AgentRuntimeHooks — the fan-out seam the AgentRuntime needs.
 *
 * The runtime only calls these two callbacks; the backend
 * (agents-backend.ts) turns them into the extension's topics.
 */

export interface AgentRuntimeHooks {
  /** Send an event to a specific window (the chat's owner). */
  sendToWindow(winId: string, event: string, payload: unknown): void;
  /** Broadcast an event to every open window. */
  broadcast(event: string, payload: unknown): void;
}
