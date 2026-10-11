import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "openp41ge-sdk-uikit";
import "./openp41ge-inline-icon";

const meta: Meta = {
  title: "Icons/Inline",
  component: "openp41ge-inline-icon",
  argTypes: {
    name: { control: "text" },
    size: { control: { type: "number", min: 8, max: 32 } },
    "hover-color": {
      control: "select",
      options: ["accent", "danger", "muted"],
    },
  },
  args: {
    name: "plus",
    size: 12,
    "hover-color": "accent",
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: (args) =>
    html`<openp41ge-inline-icon
      name=${args.name}
      size=${args.size}
      hover-color=${args["hover-color"]}
    ></openp41ge-inline-icon>`,
};

export const AllInlineIcons: Story = {
  render: () => html`
    <div style="padding:16px;color:#ccc;font-family:monospace;">
      <h3 style="margin:0 0 12px;font-size:13px;color:#888;">
        Inline icons — 12px, hover shows coloured background
      </h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,64px);gap:8px;">
        ${[
          "chevron-right",
          "chevron-down",
          "plus",
          "check-circle",
          "spinner",
          "corner",
          "sync",
          "file-added",
          "file-deleted",
          "file-modified",
          "file-renamed",
          "git-commit",
          "git-info",
          "refresh",
          "git-branch",
          "eye",
          "eye-off",
          "folder-closed",
        ].map(
          (name) => html`
            <div
              style="display:flex;flex-direction:column;align-items:center;gap:6px;padding:6px 0;width:64px;"
            >
              <openp41ge-inline-icon
                name=${name}
                size="12"
                hover-color="muted"
              ></openp41ge-inline-icon>
              <span
                style="font-size:9px;color:#666;text-align:center;overflow:hidden;text-overflow:ellipsis;max-width:60px;"
                >${name}</span
              >
            </div>
          `,
        )}
      </div>
    </div>
  `,
};

export const HoverColors: Story = {
  render: () => html`
    <div
      style="display:flex;align-items:center;gap:16px;padding:16px;color:#ccc;font-family:monospace;"
    >
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon name="plus" size="12" hover-color="accent"></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">accent (blue)</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon name="plus" size="12" hover-color="danger"></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">danger (red)</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon name="plus" size="12" hover-color="muted"></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">muted (grey)</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon name="chevron-right" size="12" no-hover></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">no-hover</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon
          name="check-circle"
          size="12"
          icon-color="#007acc"
          no-hover
        ></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">icon-color</span>
      </div>
      <div style="display:flex;flex-direction:column;align-items:center;gap:4px;">
        <openp41ge-inline-icon
          name="file-deleted"
          size="12"
          icon-color="#e53e3e"
          bg="rgba(229,62,62,0.15)"
        ></openp41ge-inline-icon>
        <span style="font-size:9px;color:#888;">bg + icon</span>
      </div>
    </div>
  `,
};

export const InlineIconRow: Story = {
  render: () => html`
    <div
      style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(255,255,255,.04);border:1px solid #333;border-radius:6px;color:#ccc;font-family:monospace;font-size:12px;width:320px;"
    >
      <openp41ge-inline-icon
        name="chevron-right"
        size="12"
        hover-color="muted"
      ></openp41ge-inline-icon>
      <span style="flex:1;color:#ccc;">https://github.com/user/repo</span>
      <openp41ge-inline-icon name="plus" size="12" hover-color="accent"></openp41ge-inline-icon>
      <openp41ge-inline-icon
        name="file-added"
        size="12"
        hover-color="accent"
      ></openp41ge-inline-icon>
      <openp41ge-inline-icon
        name="file-deleted"
        size="12"
        hover-color="danger"
      ></openp41ge-inline-icon>
    </div>
  `,
};

export const WorktreeRow: Story = {
  render: () => html`
    <div
      style="display:flex;align-items:center;gap:6px;padding:6px 10px;background:rgba(255,255,255,.04);border:1px solid #333;border-radius:6px;color:#ccc;font-family:monospace;font-size:12px;width:240px;"
    >
      <openp41ge-inline-icon
        name="corner"
        size="12"
        no-hover
        icon-color="var(--text-secondary,#555)"
      ></openp41ge-inline-icon>
      <span style="flex:1;color:#ccc;">main</span>
    </div>
  `,
};
