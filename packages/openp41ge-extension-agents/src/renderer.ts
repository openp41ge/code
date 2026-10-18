/**
 * openp41ge-extension-agents — renderer entry (view).
 *
 * Surfaces:
 *   - `sidebar:chats` (Agents): the workspace's chats; new chat; settings.
 *   - `sidebar:search` (Search chats): search the chats' messages.
 *   - `grid:chat` (`{ chatId, cwd? }`): one chat in `<agents-chat>`.
 * Chat rows (both sidebars) drag as `chat-thread` payloads, which open as
 * the chat tab.
 */

import { registerDragDecls, registerOpenKinds, registerRenderers } from "openp41ge-sdk";
import type { ChatPaneHost } from "./views/chat-pane.js";
import { renderChat } from "./views/chat-pane-element.js";
import { renderChatSearch } from "./views/chat-search-sidebar.js";
import type { ChatSearchHost } from "./views/chat-search-model.js";
import { CHAT_DRAG_SOURCE_ID, renderChats, type ChatsSidebarHost } from "./views/chats-sidebar.js";
import { COMMAND_RUN_DRAG_SOURCE_ID } from "./chat/ui/agents-chat.js";

registerRenderers([
  {
    kind: "sidebar",
    id: "chats",
    title: "Agents",
    description: "AI agent conversations",
    defaultSide: "right",
    // The platform's SurfaceHost satisfies the views' hosts structurally.
    render: (host) => renderChats(host as unknown as ChatsSidebarHost),
  },
  {
    kind: "sidebar",
    id: "search",
    title: "Search chats",
    description: "Search the agent conversations",
    defaultSide: "right",
    render: (host) => renderChatSearch(host as unknown as ChatSearchHost),
  },
  {
    kind: "grid",
    id: "chat",
    title: "Agent",
    // A chat found in the palette opens here.
    opens: ["openp41ge-extension-agents/chat"],
    render: (host) => renderChat(host as unknown as ChatPaneHost),
  },
]);

// What a chat is to the palette: the backend's search provider finds them.
registerOpenKinds({
  kinds: [
    {
      id: "chat",
      label: "Chat",
      params: {
        type: "object",
        properties: { chatId: { type: "string" }, cwd: { type: "string" } },
        required: ["chatId"],
      },
    },
  ],
});

/** This extension's chat payload kind (`openp41ge-extension-agents/chat-thread`). */
const CHAT_KIND = "openp41ge-extension-agents/chat-thread";

registerDragDecls({
  kinds: [
    {
      id: "chat-thread",
      label: "Chat",
      schema: {
        type: "object",
        properties: { chatId: { type: "string" }, title: { type: "string" } },
        required: ["chatId"],
      },
    },
  ],
  consumers: [
    {
      id: "chat",
      label: "Chat",
      accepts: [CHAT_KIND],
      placement: ["grid"],
      open: { kind: "renderer-surface", surface: "grid:chat" },
    },
  ],
  sources: [
    // A tool call that ran a command: the platform's terminal opens the run.
    {
      id: COMMAND_RUN_DRAG_SOURCE_ID,
      label: "Command",
      kind: "openp41ge/command-run",
      attrs: {
        binary: "data-run-binary",
        repo: "data-run-repo",
        worktree: "data-run-worktree",
        args: "data-run-args",
        runId: "data-run-id",
      },
      contexts: ["workspace"],
      crossWindow: true,
    },
    {
      id: CHAT_DRAG_SOURCE_ID,
      label: "Chat",
      kind: CHAT_KIND,
      attrs: { chatId: "data-chat-id", title: "data-chat-title" },
      contexts: ["workspace"],
      crossWindow: true,
    },
  ],
});
