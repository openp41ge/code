/**
 * config-schema.ts — the agents extension's config (`registerConfigSchema`):
 * which chat provider new chats use and the table of providers (endpoints,
 * models, generation options). The settings form shows each property's
 * `title` and `description` (Markdown, kept short: the form shows the
 * structure); the JSON editor shows the description as the key's tooltip.
 *
 * This is the real persisted shape, including the per-model fields (`input`,
 * `thinking`, `maxTokens`, `contextWindow`) the chat composer reads even
 * though the provider only uses `baseUrl`, `defaultModel`, `apiKey`,
 * `temperature` and `maxTokens`. Objects stay open (`additionalProperties`)
 * so hand-added keys are never refused.
 */

import type { ConfigSchema } from "openp41ge-sdk";

/** The provider used until the user configures one. */
export const DEFAULT_PROVIDER_ID = "vllm";

export const AGENTS_CONFIG_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: true,
  description: "Chat providers, endpoints and models.",
  properties: {
    defaultProviderId: {
      type: "string",
      title: "Default provider",
      "x-keysOf": "providers",
      default: DEFAULT_PROVIDER_ID,
      description: "The provider chats use when they don't pick one.",
    },
    tools: {
      type: "object",
      title: "Tools",
      additionalProperties: true,
      description: "Which of the agent's tools chats may use.",
      properties: {
        enabled: {
          type: "array",
          title: "Enabled tools",
          items: { type: "string" },
          description:
            "The tool names chats may use (e.g. `read_file`, `search_files`, `edit_file`, `create_or_replace_file`, `create_worktree`, and `run_command`, which runs the binaries extensions define in the terminal, git among them). When unset, every tool is available.",
        },
      },
    },
    providers: {
      type: "object",
      title: "Providers",
      description:
        "Provider connections, by id. Each is an **OpenAI-compatible** endpoint: the runtime appends `/chat/completions` and `/models`.",
      default: {
        [DEFAULT_PROVIDER_ID]: { baseUrl: "http://localhost:8000/v1", defaultModel: "" },
      },
      additionalProperties: {
        type: "object",
        additionalProperties: true,
        properties: {
          name: {
            type: "string",
            title: "Name",
            description: "A display name for the settings. The chat runtime ignores it.",
          },
          baseUrl: {
            type: "string",
            title: "Base URL",
            description: "The endpoint, e.g. `https://api.example.com/v1`.",
          },
          apiKey: {
            type: "string",
            title: "API key",
            secret: true,
            description: "For hosted services. Local servers usually don't need one.",
          },
          defaultModel: {
            type: "string",
            title: "Default model",
            description: "The model id chats use when they don't pick one.",
          },
          temperature: {
            type: "number",
            title: "Temperature",
            description: "Sampling randomness (0–2). The server's default when unset.",
          },
          maxTokens: {
            type: "number",
            title: "Max tokens",
            description: "Output tokens per completion. The server's default when unset.",
          },
          models: {
            type: "array",
            title: "Models",
            description: "The models this provider offers.",
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: {
                  type: "string",
                  title: "Model id",
                  description: "The exact id sent when requesting chat completions.",
                },
                input: {
                  type: "array",
                  title: "Input",
                  items: { type: "string" },
                  description: "What the model accepts (e.g. modalities). Settings only for now.",
                },
                thinking: {
                  type: "object",
                  title: "Thinking levels",
                  // A string is sent verbatim as the provider's reasoning_effort
                  // (`null` means off: field omitted); an object's fields are
                  // added to the request.
                  additionalProperties: { type: ["string", "null", "object"] },
                  description:
                    "Each key is a level in the composer. A text value is sent as the request's `reasoning_effort`, as is; an empty value (or `null`, `off`, `none`, `0`) sends nothing. An object's fields are added to the request as written, such as `chat_template_kwargs`.",
                },
                maxTokens: {
                  type: "number",
                  title: "Max tokens",
                  description: "Output tokens for this model.",
                },
                contextWindow: {
                  type: "number",
                  title: "Context window",
                  description: "In tokens. Shown in the composer.",
                },
              },
            },
          },
        },
      },
    },
  },
};
