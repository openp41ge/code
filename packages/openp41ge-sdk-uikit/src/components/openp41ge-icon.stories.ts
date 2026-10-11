import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "openp41ge-sdk-uikit";
import type { IconName } from "openp41ge-sdk-uikit";
import { iconRegistry } from "openp41ge-sdk-uikit";

const meta: Meta = {
  title: "Icons/All",
  component: "openp41ge-icon",
  argTypes: {
    name: {
      control: "select",
      options: Object.keys(iconRegistry) as IconName[],
    },
    size: { control: { type: "number", min: 8, max: 48 } },
  },
  args: {
    name: "file",
    size: 16,
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: (args) =>
    html`<openp41ge-icon name=${args.name} size=${args.size} style="color:#ccc;"></openp41ge-icon>`,
};

export const AllIcons: Story = {
  render: () => html`
    <div
      style="display:grid;grid-template-columns:repeat(4,auto);gap:16px;padding:16px;color:#ccc;font-family:monospace;"
    >
      ${Object.keys(iconRegistry).map(
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

export const Sizes: Story = {
  render: () => html`
    <div style="display:flex;align-items:center;gap:12px;padding:16px;color:#ccc;">
      <openp41ge-icon name="git" size="12"></openp41ge-icon>
      <openp41ge-icon name="git" size="16"></openp41ge-icon>
      <openp41ge-icon name="git" size="20"></openp41ge-icon>
      <openp41ge-icon name="git" size="24"></openp41ge-icon>
      <openp41ge-icon name="git" size="32"></openp41ge-icon>
    </div>
  `,
};

export const CustomColor: Story = {
  render: () => html`
    <div style="display:flex;align-items:center;gap:12px;padding:16px;">
      <openp41ge-icon name="git" size="24" style="color:#4a9eff;"></openp41ge-icon>
      <openp41ge-icon name="file" size="24" style="color:#4caf50;"></openp41ge-icon>
      <openp41ge-icon name="plus" size="24" style="color:#f44;"></openp41ge-icon>
    </div>
  `,
};
