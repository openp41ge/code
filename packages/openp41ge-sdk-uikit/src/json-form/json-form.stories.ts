import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "./json-form";

/** Defaults as a host computes them (`configDefaults`): each property's `default`. */
function defaultsOf(schema: { properties?: Record<string, { default?: unknown }> }) {
  const out: Record<string, unknown> = {};
  for (const [key, sub] of Object.entries(schema.properties ?? {})) {
    if (sub.default !== undefined) out[key] = sub.default;
  }
  return out;
}

const settings = {
  type: "object",
  required: ["apiKey"],
  properties: {
    apiKey: {
      type: "string",
      title: "API key",
      description: "Your provider's key. Stored as is; shown **masked**.",
      secret: true,
    },
    enabled: { type: "boolean", title: "Enabled", default: true },
    defaultProfile: {
      type: "string",
      title: "Default profile",
      description: "Used when a request doesn't pick one.",
      "x-keysOf": "profiles",
      default: "local",
    },
    profiles: {
      type: "object",
      title: "Profiles",
      description: "Connections, by id. `local` comes with the defaults.",
      default: { local: { url: "http://localhost:8000" } },
      additionalProperties: {
        type: "object",
        properties: {
          url: { type: "string", title: "URL" },
          token: { type: "string", title: "Token", secret: true },
          levels: {
            type: "object",
            title: "Levels",
            additionalProperties: { type: ["string", "null"] },
          },
        },
      },
    },
    model: {
      enum: ["small", "medium", "large"],
      title: "Model",
      description: "Which model answers.",
      default: "medium",
    },
    maxTokens: {
      type: "integer",
      title: "Max tokens",
      minimum: 1,
      maximum: 8192,
      default: 1024,
    },
    temperature: { type: "number", title: "Temperature", minimum: 0, maximum: 2 },
    stop: {
      type: "array",
      title: "Stop words",
      description: "Generation stops at any of these.",
      items: { type: "string" },
    },
    endpoints: {
      type: "array",
      title: "Endpoints",
      description: "Tried in order.",
      items: {
        type: "object",
        properties: {
          name: { type: "string", title: "Name" },
          url: { type: "string", title: "URL" },
          timeout: { type: "integer", title: "Timeout (s)", minimum: 1 },
        },
      },
    },
    display: {
      type: "object",
      title: "Display",
      properties: {
        compact: { type: "boolean", title: "Compact", default: false },
        accent: { enum: ["blue", "green", "orange"], title: "Accent", default: "blue" },
      },
    },
    headers: {
      type: "object",
      title: "Extra headers",
      additionalProperties: { type: "string" },
    },
  },
};

const meta: Meta = {
  title: "Components/JSON Form",
  component: "json-form",
  argTypes: {
    readonly: { control: "boolean" },
  },
  args: { readonly: false },
  render: (args) => html`
    <div style="max-width:640px;padding:16px;background:var(--bg-primary, #161616)">
      <json-form
        .schema=${args.schema ?? settings}
        .value=${args.value ?? {}}
        .defaults=${args.defaults ?? defaultsOf(settings)}
        .errors=${args.errors ?? []}
        ?readonly=${args.readonly}
      ></json-form>
    </div>
  `,
};

export default meta;
type Story = StoryObj;

/** Nothing set yet: defaults show faded; the required key comes first. */
export const Empty: Story = {};

/** Some values set (with Reset), a list, two endpoint cards and a second
 *  profile, the default. */
export const WithValues: Story = {
  args: {
    value: {
      apiKey: "sk-123",
      maxTokens: 2048,
      stop: ["END", "###"],
      endpoints: [
        { name: "Primary", url: "https://a.example/v1" },
        { name: "Fallback", url: "https://b.example/v1", timeout: 30 },
      ],
      headers: { "X-Team": "core" },
      defaultProfile: "cloud",
      profiles: { cloud: { url: "https://api.example", levels: { Off: null, High: "high" } } },
    },
  },
};

/** Errors from the host, under their fields. */
export const WithErrors: Story = {
  args: {
    value: { maxTokens: 0, temperature: 3 },
    errors: [
      { path: "maxTokens", message: "maxTokens: must be at least 1" },
      { path: "temperature", message: "temperature: must be at most 2" },
      { path: "apiKey", message: "apiKey: required" },
    ],
  },
};

/** Read only: shown, not editable. */
export const ReadOnly: Story = {
  args: { readonly: true, value: { apiKey: "sk-123", stop: ["END"] } },
};
