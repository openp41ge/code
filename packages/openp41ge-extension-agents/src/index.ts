/**
 * openp41ge-extension-agents — backend entry (main process).
 *
 * The agents system as an official extension: chats with an AI agent that
 * reads and edits the workspace's worktrees. This entry registers the
 * extension's config (the chat providers), its commands (threads, the agent
 * run, open state; see ./backend/agents-backend.ts), its palette search
 * provider (the workspace's chats, and "New chat"), and a cleanup that
 * writes pending thread changes when the extension unloads or the app quits.
 */

import {
  registerConfigSchema,
  registerDispose,
  registerProcesses,
  registerSearchProvider,
} from "openp41ge-sdk";
import { AgentsBackend } from "./backend/agents-backend.js";
import { ChatProviderRegistry } from "./backend/chat-provider-registry.js";
import { AGENTS_CONFIG_SCHEMA } from "./backend/config-schema.js";
import { VllmChatProvider } from "./backend/vllm-chat-provider.js";

const providers = new ChatProviderRegistry();
providers.register({
  id: "vllm",
  label: "vLLM",
  create: (config) => new VllmChatProvider(config),
});

const backend = new AgentsBackend({ providers });

registerConfigSchema(AGENTS_CONFIG_SCHEMA);
registerProcesses(backend.commands());
registerSearchProvider(backend.searchProvider());
registerDispose(() => backend.dispose());
