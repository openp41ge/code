/**
 * config-schema.ts — the agents extension's config (`registerConfigSchema`):
 * which chat provider is active and the table of providers (endpoints,
 * models, generation options). The platform's JSON editor shows each
 * property's `description` (Markdown) as the key's tooltip.
 *
 * This is the real persisted shape, including the per-model fields (`input`,
 * `thinking`, `maxTokens`, `contextWindow`) the chat composer reads even
 * though the provider only uses `baseUrl`, `defaultModel`, `apiKey`,
 * `temperature` and `maxTokens`. Objects stay open (`additionalProperties`)
 * so hand-added keys are never refused.
 */

import type { ConfigSchema } from "openp41ge-sdk";

const PROVIDERS_MD = `# Providers

The table of provider connections, keyed by provider id. The **active** one is
\`providerId\` — chats that don't pin a provider use that connection.

\`\`\`json
{
  "vllm": {
    "baseUrl": "http://localhost:8000/v1",
    "defaultModel": "Qwen2.5-Coder-7B-Instruct",
    "models": [{ "id": "Qwen2.5-Coder-7B-Instruct" }]
  }
}
\`\`\``;

const PROVIDER_MD = `# Provider connection

A single provider connection. The key is the provider id (e.g. \`vllm\`,
\`openai\`). Each provider exposes an **OpenAI-compatible** endpoint; the runtime
appends \`/chat/completions\` and \`/models\`.

\`\`\`json
{
  "baseUrl": "https://api.example.com/v1",
  "defaultModel": "gpt-4o",
  "apiKey": "sk-…",
  "temperature": 0.7,
  "models": [{ "id": "gpt-4o" }]
}
\`\`\``;

const MODELS_MD = `# Models

The models available from this provider. The provider-level \`defaultModel\` is
used when a chat doesn't pick one explicitly.

\`\`\`json
[
  {
    "id": "Qwen2.5-7B",
    "input": ["text"],
    "maxTokens": 8192,
    "contextWindow": 32768,
    "thinking": { "Low": "Low" }
  }
]
\`\`\``;

const THINKING_MD = `# Thinking configuration

Key/value pairs describing this model's thinking configuration. Each **key**
becomes a thinking level in the composer's dropdown; each **value** is sent to
the provider **verbatim** as the request's \`reasoning_effort\`. You define the
levels the provider understands — there is no hardcoded mapping here.

Set a value to **\`null\`** (or an empty string, \`off\`, \`none\`, \`0\`) to disable
thinking for that level: \`reasoning_effort\` is omitted and the model applies
its default behaviour. Any other value — \`low\`, \`medium\`, \`high\`, or a
provider-specific level — is passed through unchanged.

\`\`\`json
{
  "Off": null,
  "Minimal": "minimal",
  "Low": "low",
  "High": "high",
  "Max": "max"
}
\`\`\`

> \`null\` is the JSON-native way to represent "off" — JSON has no \`undefined\`.
> The value must be accepted by your provider; if the server rejects a level
> you configured, pick one the provider supports (e.g. \`low\`/\`medium\`/\`high\`).`;

/** The provider used until the user configures one. */
export const DEFAULT_PROVIDER_ID = "vllm";

export const AGENTS_CONFIG_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: true,
  description: "Chat providers, endpoints and models.",
  properties: {
    providerId: {
      type: "string",
      default: DEFAULT_PROVIDER_ID,
      description:
        "The **active** provider id. Must match a key in `providers`. Chat requests that don't pin a provider use this one.",
    },
    tools: {
      type: "object",
      additionalProperties: true,
      description: "Which of the agent's tools chats may use.",
      properties: {
        enabled: {
          type: "array",
          items: { type: "string" },
          description:
            "The tool names chats may use (e.g. `read_file`, `search_files`, `edit_file`, `create_or_replace_file`). When absent, every tool is available.",
        },
      },
    },
    providers: {
      type: "object",
      description: PROVIDERS_MD,
      default: {
        [DEFAULT_PROVIDER_ID]: { baseUrl: "http://localhost:8000/v1", defaultModel: "" },
      },
      additionalProperties: {
        type: "object",
        description: PROVIDER_MD,
        additionalProperties: true,
        properties: {
          baseUrl: {
            type: "string",
            description:
              "The OpenAI-compatible endpoint URL, e.g. `https://api.example.com/v1`. The runtime appends `/chat/completions` and `/models`.",
          },
          defaultModel: {
            type: "string",
            description:
              "The **default** model id used when a chat doesn't pick one explicitly. Distinct from `models`, the list of available models.",
          },
          apiKey: {
            type: "string",
            description:
              "Bearer **API key** for hosted services. Local servers usually don't need one.",
          },
          temperature: {
            type: "number",
            description:
              "Sampling randomness (0–2). Optional; the server default is used when unset.",
          },
          maxTokens: {
            type: "number",
            description:
              "Max output tokens per completion. Optional; the server default is used when unset.",
          },
          name: {
            type: "string",
            description:
              "Friendly **display name** for the settings UI only. The chat runtime ignores it.",
          },
          models: {
            type: "array",
            description: MODELS_MD,
            items: {
              type: "object",
              additionalProperties: true,
              properties: {
                id: {
                  type: "string",
                  description: "The **exact model id** used when requesting chat completions.",
                },
                input: {
                  type: "array",
                  items: { type: "string" },
                  description:
                    "A list of strings describing the model's accepted input (e.g. modalities). Settings-only for now.",
                },
                thinking: {
                  type: "object",
                  // Values are sent verbatim as the provider's reasoning_effort;
                  // `null` means off (field omitted).
                  additionalProperties: { type: ["string", "null"] },
                  description: THINKING_MD,
                },
                maxTokens: {
                  type: "number",
                  description: "Max output tokens for this model. Optional.",
                },
                contextWindow: {
                  type: "number",
                  description: "Context window size in tokens. Shown in the composer; optional.",
                },
              },
            },
          },
        },
      },
    },
  },
};
