import type { Preview } from "@storybook/web-components";

// ── Event log addon ─────────────────────────────────────────────
const EVENT_NAMES = [
  "grid-split",
  "grid-move",
  "grid-open-tab",
  "grid-activate",
  "grid-remove",
  "tab-bar-reorder",
  "tab-bar-move-cell",
  "grid-pin",
];

function formatEvent(type: string, detail: Record<string, unknown>): string {
  const parts = Object.entries(detail || {})
    .map(([k, v]) => `${k}=${String(v).slice(0, 60)}`)
    .join(", ");
  return `${type}: ${parts}`;
}

let listenersInitialized = false;

const preview: Preview = {
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/,
      },
    },
    backgrounds: {
      default: "dark",
      values: [
        { name: "dark", value: "#1e1e1e" },
        { name: "light", value: "#ffffff" },
      ],
    },
  },
  decorators: [
    (storyFn: () => any) => {
      // Set up document-level event listeners once
      if (!listenersInitialized) {
        listenersInitialized = true;
        const channel = (window as any).__STORYBOOK_ADDONS_CHANNEL__;
        if (channel) {
          for (const name of EVENT_NAMES) {
            document.addEventListener(name, (e: Event) => {
              const detail = (e as CustomEvent).detail || {};
              channel.emit("openp41ge/event", formatEvent(name, detail));
            });
          }
        }
      }
      return storyFn();
    },
  ],
};

export default preview;
