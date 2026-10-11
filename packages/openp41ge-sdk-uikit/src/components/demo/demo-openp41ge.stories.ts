import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "./demo-openp41ge";

const meta: Meta = {
  title: "Demos/Openp41ge Window",
  component: "demo-openp41ge",
  argTypes: {
    cols: { control: { type: "number", min: 1, max: 4 } },
    sidebar: { control: "boolean" },
    "window-chrome": { control: "boolean" },
    "ghost-col": { control: { type: "number", min: -1, max: 3 } },
    "ghost-tabbar-col": { control: { type: "number", min: -1, max: 3 } },
    "ghost-boundary-index": { control: { type: "number", min: -1, max: 4 } },
  },
  args: {
    cols: 2,
    sidebar: false,
    "window-chrome": false,
    "ghost-col": -1,
    "ghost-tabbar-col": -1,
    "ghost-boundary-index": -1,
  },
};

export default meta;
type Story = StoryObj;

export const TwoColumns: Story = {
  args: {
    cols: 2,
    placements: [
      { col: 0, tabs: [{ id: "f1", title: "file.js" }] },
      {
        col: 1,
        tabs: [
          { id: "t1", title: "terminal" },
          { id: "e1", title: "editor" },
        ],
      },
    ],
    "active-tab": "f1",
  },
};

export const ThreeColumns: Story = {
  args: {
    cols: 3,
    placements: [
      { col: 0, tabs: [{ id: "a", title: "index" }] },
      { col: 1, tabs: [{ id: "b", title: "todo" }] },
      {
        col: 2,
        tabs: [
          { id: "c", title: "log" },
          { id: "d", title: "cli" },
        ],
      },
    ],
    "active-tab": "a",
  },
};

export const WithSidebar: Story = {
  render: () => html`
    <demo-openp41ge
      cols="2"
      .placements=${[
        { col: 0, tabs: [{ id: "i1", title: "index.ts" }] },
        { col: 1, tabs: [{ id: "t2", title: "app.tsx" }] },
      ]}
      active-tab="i1"
      sidebar
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};

export const WithWindowChrome: Story = {
  render: () => html`
    <demo-openp41ge
      cols="2"
      .placements=${[
        { col: 0, tabs: [{ id: "f2", title: "file.js" }] },
        { col: 1, tabs: [{ id: "e2", title: "editor" }] },
      ]}
      active-tab="f2"
      window-chrome
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};

export const GhostOverlayOnColumn: Story = {
  render: () => html`
    <demo-openp41ge
      cols="2"
      .placements=${[
        { col: 0, tabs: [{ id: "a", title: "index" }] },
        { col: 1, tabs: [{ id: "b", title: "todo" }] },
      ]}
      active-tab="a"
      .ghostCol=${1}
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};

export const GhostTabBarIndicator: Story = {
  render: () => html`
    <demo-openp41ge
      cols="2"
      .placements=${[
        { col: 0, tabs: [{ id: "a", title: "index" }] },
        { col: 1, tabs: [{ id: "b", title: "todo" }] },
      ]}
      active-tab="a"
      .ghostTabBarCol=${0}
      .ghostTabBarOffset=${55}
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};

export const GhostBoundarySplit: Story = {
  render: () => html`
    <demo-openp41ge
      cols="1"
      .placements=${[{ col: 0, tabs: [{ id: "a", title: "index" }] }]}
      active-tab="a"
      .ghostBoundaryIndex=${1}
      sidebar
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};

export const FullFeatured: Story = {
  render: () => html`
    <demo-openp41ge
      cols="3"
      .placements=${[
        { col: 0, tabs: [{ id: "a", title: "index.ts" }] },
        {
          col: 1,
          tabs: [
            { id: "b", title: "app.tsx" },
            { id: "c", title: "styles.css" },
          ],
        },
        { col: 2, tabs: [{ id: "d", title: "terminal" }] },
      ]}
      active-tab="b"
      .ghostCol=${2}
      sidebar
      style="width:460px;height:220px;display:inline-block;"
    ></demo-openp41ge>
  `,
};
