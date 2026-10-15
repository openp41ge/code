/**
 * agents-backend.ts — the agents extension's backend commands.
 *
 * Each command runs for the window that dispatched it (`ctx`):
 *   - Threads belong to that window's workspace and live in the extension's
 *     data folder there (`<data>/chat-threads/`); a window without a workspace
 *     has none.
 *   - "Opened once": a chat is open in at most one window (`ctx.windowId`);
 *     opening it in another is refused and the open state re-announced.
 *   - `send` runs the agent with the provider the extension's config names,
 *     its file tools scoped to the workspace's worktrees; it sees every
 *     repository there and can check out more worktrees.
 *
 * Pushes go out as the extension's topics (`changed`, `delta`, `tool`,
 * `status`, `usage`, `live-rate`, `reasoning`, `open-state`, `highlight`).
 * Those for one chat carry its `chatId` (and the window it is open in,
 * `windowId`); `open-state` says only that something changed — a view asks
 * `open-chats`, which answers relative to its window (`here`/`elsewhere`).
 */

import type {
  HandlerContext,
  HandlerPayload,
  HandlerWorkspace,
  ProcessRegistrations,
} from "openp41ge-sdk";
import type { ChatSearchOptions } from "../chat/types.js";
import { AgentRuntime, type ConnectedRepository } from "./agent-runtime.js";
import type { ChatProviderConfig } from "./chat-provider.js";
import type { ChatProviderRegistry } from "./chat-provider-registry.js";
import { ChatThreads } from "./chat-threads.js";
import { DEFAULT_PROVIDER_ID } from "./config-schema.js";
import { describeFetchError } from "./fetch-error.js";
import { useLog } from "./log.js";
import { ToolRegistry } from "./tool-registry.js";
import { registerBuiltinTools } from "../tools/index.js";

export interface AgentsBackendOptions {
  /** The chat providers (the entry registers vLLM). */
  readonly providers: ChatProviderRegistry;
}

/** The agent config the backend reads (`ctx.config.get()`). */
interface AgentsConfig {
  /** The provider a chat uses when it has not picked one. */
  readonly defaultProviderId?: string;
  readonly providers?: Readonly<Record<string, ChatProviderConfig>>;
  /** The tools agents may use (absent: all). */
  readonly tools?: { readonly enabled?: readonly string[] };
}

function str(payload: HandlerPayload, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function chatId(payload: HandlerPayload): string {
  const id = str(payload, "id");
  if (!id) throw new Error("a chat id (`id`) is required");
  return id;
}

/** The runtime's window events (`chat:<topic>`) as extension topics. */
function topicOf(event: string): string {
  return event.replace(/^chat:/, "");
}

export class AgentsBackend {
  private readonly _providers: ChatProviderRegistry;
  private readonly _threads = new ChatThreads();
  private readonly _tools = new ToolRegistry();
  private _runtime: AgentRuntime | null = null;
  /** The latest context: its publish and config are the extension's own. */
  private _ctx: HandlerContext | null = null;
  /** Each workspace seen, for its chats' worktrees. */
  private readonly _workspaces = new Map<string, HandlerWorkspace>();
  /** Each workspace's data folder, once made. */
  private readonly _dataDirs = new Map<string, string>();

  constructor(options: AgentsBackendOptions) {
    this._providers = options.providers;
    registerBuiltinTools(this._tools);
  }

  /** The commands, for `registerProcesses`. */
  commands(): ProcessRegistrations {
    const command =
      (fn: (payload: HandlerPayload, ctx: HandlerContext, workspaceId?: string) => unknown) =>
      async (payload: HandlerPayload, ctx?: HandlerContext) => {
        if (!ctx) throw new Error("agents commands need the handler context");
        this._ctx = ctx;
        useLog(ctx.log);
        const workspaceId = await this._useWorkspace(ctx.workspace);
        return fn(payload ?? {}, ctx, workspaceId) as never;
      };

    return {
      // ── Threads ────────────────────────────────────────────────────────
      // `archived: true` includes the archived chats.
      list: command((p, _c, ws) =>
        this._threads.listSummaries(ws, { archived: p.archived === true }),
      ),
      get: command((p) => this._threads.get(chatId(p))),
      header: command((p) => this._threads.getHeader(chatId(p))),
      messages: command((p) =>
        this._threads.getMessages(
          chatId(p),
          typeof p.offset === "number" ? p.offset : undefined,
          typeof p.count === "number" ? p.count : undefined,
        ),
      ),
      create: command((p, ctx, ws) => {
        const chat = this._threads.create(ws, {
          providerId:
            str(p, "providerId") ?? this._config(ctx).defaultProviderId ?? DEFAULT_PROVIDER_ID,
          title: str(p, "title"),
        });
        ctx.publish("changed", {});
        return chat;
      }),
      delete: command((p, ctx) => this._announce(ctx, this._threads.delete(chatId(p)))),
      rename: command((p, ctx) =>
        this._announce(ctx, this._threads.rename(chatId(p), str(p, "title") ?? "")),
      ),
      archive: command((p, ctx) => this._announce(ctx, this._threads.archive(chatId(p)))),
      unarchive: command((p, ctx) => this._announce(ctx, this._threads.unarchive(chatId(p)))),
      // The chat's folder (its header and message files: the conversation).
      path: command((p) => this._threads.threadDir(chatId(p))),
      search: command((p, _c, ws) =>
        this._threads.search(str(p, "query") ?? "", p.options as ChatSearchOptions, ws),
      ),
      "search-transcript": command((p) =>
        this._threads.searchTranscript(
          chatId(p),
          str(p, "query") ?? "",
          p.options as ChatSearchOptions,
        ),
      ),

      // ── Agent run ──────────────────────────────────────────────────────
      send: command(async (p, ctx) => {
        const id = chatId(p);
        const windowId = ctx.windowId ?? this._threads.getOpenWin(id) ?? "";
        if (!windowId) return;
        // The config's enabled tools gate what a chat asks for (absent: all).
        const enabled = this._config(ctx).tools?.enabled;
        const asked = Array.isArray(p.tools) ? (p.tools as string[]) : undefined;
        const tools = enabled ? (asked ?? enabled).filter((t) => enabled.includes(t)) : asked;
        await this._runtimeFor().send(
          id,
          windowId,
          str(p, "text") ?? "",
          str(p, "cwd"),
          tools,
          str(p, "thinkingLevel"),
        );
      }),
      abort: command((p) => this._runtimeFor().abort(chatId(p))),
      "list-tools": command((_p, ctx) => {
        const enabled = this._config(ctx).tools?.enabled;
        const tools = this._runtimeFor().listTools();
        return enabled ? tools.filter((t) => enabled.includes(t.name)) : tools;
      }),
      "ping-provider": command(async (p, ctx) => {
        const config = this._config(ctx);
        const providerId =
          str(p, "providerId") ?? config.defaultProviderId ?? this._providers.defaultId ?? "";
        const factory = this._providers.get(providerId);
        if (!factory) return { ok: false, error: "Unknown provider" };
        const providerConfig = config.providers?.[providerId];
        if (!providerConfig) return { ok: false, error: "Provider not configured" };
        const ok = await factory.create(providerConfig).ping();
        return ok ? { ok } : { ok, error: "Provider unreachable" };
      }),
      "list-models": command((p) => listModels(p)),

      // ── Open state ("opened once") ─────────────────────────────────────
      open: command((p, ctx) => {
        const id = chatId(p);
        if (!ctx.windowId || !this._threads.getHeader(id)) return;
        if (!this._threads.isOpenElsewhere(id, ctx.windowId)) {
          this._threads.markOpen(id, ctx.windowId);
        }
        ctx.publish("open-state", {});
      }),
      close: command((p, ctx) => {
        this._threads.markClosed(chatId(p));
        ctx.publish("open-state", {});
      }),
      // Which chats are open, as seen from the calling window.
      "open-chats": command((_p, ctx) => {
        const open: Record<string, "here" | "elsewhere"> = {};
        for (const [id, windowId] of Object.entries(this._threads.getOpenChats())) {
          open[id] = windowId === ctx.windowId ? "here" : "elsewhere";
        }
        return open;
      }),
      highlight: command((p, ctx) => {
        const id = chatId(p);
        const owner = this._threads.getOpenWin(id);
        if (owner) ctx.publish("highlight", { chatId: id, windowId: owner });
      }),
    };
  }

  /** Write the threads' pending changes (unload, app quit). */
  dispose(): void {
    this._threads.flush();
  }

  private _announce<T>(ctx: HandlerContext, result: T): T {
    if (result) ctx.publish("changed", {});
    return result;
  }

  private _config(ctx: HandlerContext): AgentsConfig {
    return ctx.config.get() as AgentsConfig;
  }

  /** Load the calling window's workspace threads; its id (none: undefined). */
  private async _useWorkspace(workspace: HandlerWorkspace | null): Promise<string | undefined> {
    if (!workspace) return undefined;
    this._workspaces.set(workspace.id, workspace);
    let dataDir = this._dataDirs.get(workspace.id);
    if (!dataDir) {
      dataDir = await workspace.dataDir();
      this._dataDirs.set(workspace.id, dataDir);
    }
    this._threads.useWorkspace({ id: workspace.id, dataDir });
    return workspace.id;
  }

  /** The workspace a chat belongs to, when seen. */
  private _workspaceOf(chatId: string): HandlerWorkspace | undefined {
    const owner = this._threads.workspaceOf(chatId);
    return owner ? this._workspaces.get(owner.id) : undefined;
  }

  private _runtimeFor(): AgentRuntime {
    this._runtime ??= new AgentRuntime(
      this._threads,
      this._providers,
      this._tools,
      {
        sendToWindow: (windowId, event, payload) =>
          this._ctx?.publish(topicOf(event), {
            ...(payload as Record<string, unknown>),
            windowId,
          }),
        broadcast: (event, payload) =>
          this._ctx?.publish(topicOf(event), payload as Record<string, unknown>),
      },
      {
        getProviderConfig: (providerId) =>
          (this._ctx && this._config(this._ctx).providers?.[providerId]) ?? null,
        // The agent's file tools may only touch the worktrees of the chat's
        // workspace (checked out, listed by its workspace file); it sees
        // every repository there, and checks worktrees out through it.
        getConnectedRepositories: async (id): Promise<ConnectedRepository[]> => {
          const workspace = this._workspaceOf(id);
          if (!workspace) return [];
          try {
            const repos = await workspace.repositories();
            return repos.map((r) => ({
              repo: r.repoName,
              cloned: r.cloned,
              worktrees: r.worktrees.map((w) => ({ branch: w.branch, path: w.path })),
            }));
          } catch {
            return [];
          }
        },
        addWorktree: async (id, repo, branch) => {
          const workspace = this._workspaceOf(id);
          if (!workspace) return { ok: false, error: "the chat has no workspace" };
          return workspace.addWorktree(repo, branch);
        },
      },
    );
    return this._runtime;
  }
}

/** The models a provider's `/models` endpoint lists (settings auto-detect). */
async function listModels(
  payload: HandlerPayload,
): Promise<{ ok: true; models: string[] } | { ok: false; error: string }> {
  const baseUrl = str(payload, "baseUrl") ?? "";
  const apiKey = str(payload, "apiKey");
  const url = `${baseUrl.replace(/\/+$/, "")}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) {
    if (payload.compatible === "anthropic") headers["x-api-key"] = apiKey;
    else headers["Authorization"] = `Bearer ${apiKey}`;
  }
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    return { ok: false, error: describeFetchError(err) };
  }
  if (!res.ok) return { ok: false, error: `Model list request failed (${res.status})` };
  const body = (await res.json()) as { data?: Array<{ id: string }> };
  const models = (body.data ?? []).map((m) => m.id).filter((id) => typeof id === "string");
  return { ok: true, models };
}
