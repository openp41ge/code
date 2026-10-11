import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "openp41ge-sdk-uikit";
import type { IconName } from "openp41ge-sdk-uikit";
import { iconRegistry } from "openp41ge-sdk-uikit";

/** Block icons — typically 20-24px, used in toolbars, sidebars, and bottom bars without padding. */
const blockIcons: IconName[] = [
  "git",
  "projects",
  "terminal",
  "play",
  "grid",
  "refresh",
  "eye",
  "eye-off",
  "doc",
  "folder-closed",
];

const meta: Meta = {
  title: "Icons/Block",
  component: "openp41ge-icon",
  argTypes: {
    name: {
      control: "select",
      options: blockIcons,
    },
    size: { control: { type: "number", min: 8, max: 48 } },
  },
  args: {
    name: "git",
    size: 20,
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: (args) =>
    html`<openp41ge-icon name=${args.name} size=${args.size} style="color:#ccc;"></openp41ge-icon>`,
};

export const AllBlockIcons: Story = {
  render: () => html`
    <div
      style="display:grid;grid-template-columns:repeat(4,auto);gap:20px;padding:16px;color:#ccc;font-family:monospace;"
    >
      ${blockIcons
        .filter((n) => iconRegistry[n])
        .map(
          (name) => html`
            <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
              <openp41ge-icon name=${name} size="24" style="color:#ccc;"></openp41ge-icon>
              <span style="font-size:10px;color:#888;">${name}</span>
            </div>
          `,
        )}
    </div>
  `,
};

export const ToolbarRow: Story = {
  render: () => html`
    <div
      style="display:flex;align-items:center;gap:6px;padding:8px 12px;background:#252526;border-bottom:1px solid #333;border-radius:4px;"
    >
      ${["projects", "refresh", "git", "terminal", "play"].map(
        (name) => html`
          <div
            style="padding:4px;border-radius:4px;cursor:pointer;display:flex;align-items:center;"
            @mouseenter=${(e: MouseEvent) => {
              (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.08)";
            }}
            @mouseleave=${(e: MouseEvent) => {
              (e.currentTarget as HTMLElement).style.background = "transparent";
            }}
          >
            <openp41ge-icon name=${name} size="18" style="color:#999;"></openp41ge-icon>
          </div>
        `,
      )}
    </div>
  `,
};
