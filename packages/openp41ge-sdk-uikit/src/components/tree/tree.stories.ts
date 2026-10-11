import { html } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { Meta, StoryObj } from "@storybook/web-components";
import type { TreeNode } from "./types";
import { iconRegistry } from "../../icons";
import { getFileIcon } from "../../icons/material-icons";
import "../openp41ge-icon";
import "./tree";

const meta: Meta = {
  title: "Components/Tree",
  component: "openp41ge-tree",
  argTypes: {
    nodes: { control: "object" },
    selectedId: { control: "text" },
  },
};

export default meta;
type Story = StoryObj;

// ─── Icon renderer — uses iconRegistry for standard icons, branded inline SVGs for hosts ─

const brandedIcons: Record<string, string> = {
  github: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1C4.1 1 1 4.1 1 8c0 3.1 2 5.7 4.8 6.6.35.07.48-.15.48-.34v-1.2c-2 .44-2.42-.97-2.42-.97-.32-.82-.8-1.04-.8-1.04-.66-.45.05-.44.05-.44.73.05 1.12.75 1.12.75.65 1.1 1.7.78 2.12.6.06-.47.25-.78.46-.96-1.62-.18-3.32-.8-3.32-3.58 0-.8.28-1.44.74-1.95-.07-.18-.32-.92.07-1.92 0 0 .6-.2 1.97.74A6.74 6.74 0 018 4.05c.6 0 1.2.08 1.77.24 1.36-.93 1.97-.73 1.97-.73.4 1 .14 1.74.07 1.92.46.5.73 1.15.73 1.94 0 2.78-1.7 3.4-3.32 3.58.26.22.5.67.5 1.35v2c0 .2.13.42.5.34C13 13.7 15 11.1 15 8c0-3.9-3.1-7-7-7z"/></svg>`,
  gitlab: `<svg viewBox="0 0 16 16" fill="currentColor"><path d="M15.1 9.1L13.4 4.6c-.1-.2-.3-.4-.5-.4s-.4.2-.5.4L11.1 8H4.9L3.6 4.6c-.1-.2-.3-.4-.5-.4s-.4.2-.5.4L.9 9.1c-.2.5 0 1.1.4 1.4l6.2 4.5c.1.1.2.1.3.1h.2c.1 0 .2 0 .3-.1l6.2-4.5c.5-.3.7-.9.6-1.4z"/></svg>`,
};

function treeIcon(name: string, size: number) {
  // 1. Branded icons (github, gitlab)
  const branded = brandedIcons[name];
  if (branded) {
    const scaled = branded.replace(
      'viewBox="0 0 16 16"',
      `viewBox="0 0 16 16" width="${size}" height="${size}"`,
    );
    return html`${unsafeHTML(scaled)}`;
  }
  // 2. Icon registry (folder-closed, git-branch, plus, refresh, eye)
  const registered = iconRegistry[name as keyof typeof iconRegistry];
  if (registered) {
    return html`${unsafeHTML(registered(size))}`;
  }
  // 3. Material icon theme for file names (app.ts → typescript icon)
  const material = getFileIcon(name);
  if (material) {
    const sized = material.replace("<svg", `<svg width="${size}" height="${size}"`);
    return html`${unsafeHTML(sized)}`;
  }
  return html``;
}

// ─── Mock Data ──────────────────────────────────────────────────────

/** Simple file tree matching the app's explorer look */
const basicNodes: TreeNode[] = [
  {
    id: "src",
    label: "src",
    icon: "folder-closed",
    expanded: true,
    children: [
      {
        id: "components",
        label: "components",
        icon: "folder-closed",
        expanded: true,
        children: [
          { id: "app.ts", label: "app.ts", icon: "app.ts" },
          { id: "header.tsx", label: "header.tsx", icon: "header.tsx" },
          { id: "styles.css", label: "styles.css", icon: "styles.css" },
        ],
      },
      { id: "utils.ts", label: "utils.ts", icon: "utils.ts" },
      { id: "index.ts", label: "index.ts", icon: "index.ts" },
    ],
  },
  {
    id: "package.json",
    label: "package.json",
    icon: "package.json",
    draggable: true,
  },
  {
    id: "tsconfig.json",
    label: "tsconfig.json",
    icon: "tsconfig.json",
    draggable: true,
  },
  {
    id: "add-repo",
    label: "add repository",
    icon: "plus",
    showChevron: false,
    variant: "worktree",
  },
];

/** Repo structure mimicking the app's worktree explorer sidebar */
const repoNodes: TreeNode[] = [
  {
    id: "repo-app",
    label: "github.com/me/app",
    icon: "github",
    variant: "section",
    expanded: true,
    actions: [
      { id: "add-worktree", icon: "plus", label: "Add worktree" },
      { id: "refresh", icon: "refresh", label: "Refresh" },
    ],
    children: [
      {
        id: "wt-main",
        label: "main",
        icon: "git-branch",
        expanded: true,
        children: [
          {
            id: "dir-readme",
            label: "README.md",
            icon: "README.md",
          },
          {
            id: "dir-src-wt",
            label: "src",
            icon: "folder-closed",
            expanded: false,
            children: [
              { id: "wt-index", label: "index.ts", icon: "index.ts" },
              { id: "wt-app", label: "app.ts", icon: "app.ts" },
            ],
          },
        ],
      },
      {
        id: "wt-feature",
        label: "feature-x",
        icon: "git-branch",
        expanded: false,
        actions: [{ id: "pull", icon: "refresh", label: "Pull" }],
        children: [{ id: "wt-feat-readme", label: "README.md", icon: "README.md" }],
      },
    ],
  },
  {
    id: "repo-toolkit",
    label: "github.com/me/toolkit",
    icon: "github",
    variant: "section",
    actions: [{ id: "add-worktree", icon: "plus", label: "Add worktree" }],
    children: [],
  },
  {
    id: "repo-other",
    label: "gitlab.com/team/other",
    icon: "gitlab",
    variant: "section",
    actions: [{ id: "add-worktree", icon: "plus", label: "Add worktree" }],
    children: [],
  },
  {
    id: "repo-custom",
    label: "git.sr.ht/~user/tool",
    icon: "git",
    variant: "section",
    actions: [{ id: "add-worktree", icon: "plus", label: "Add worktree" }],
    children: [],
  },
  {
    id: "add-repo-top",
    label: "add repository",
    icon: "plus",
    showChevron: false,
    variant: "worktree",
  },
];

// ─── Stories ─────────────────────────────────────────────────────────

export const Basic: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${basicNodes} .renderIcon=${treeIcon}></openp41ge-tree>
    </div>
  `,
};

export const Expanded: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree
        .nodes=${basicNodes}
        selectedId="utils.ts"
        .renderIcon=${treeIcon}
      ></openp41ge-tree>
    </div>
  `,
};

export const WithRepoStructure: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${repoNodes} .renderIcon=${treeIcon}></openp41ge-tree>
    </div>
  `,
};

export const WithActions: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${repoNodes} .renderIcon=${treeIcon}></openp41ge-tree>
    </div>
  `,
};

export const NestedDeep: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${_buildDeepTree(5)} .renderIcon=${treeIcon}></openp41ge-tree>
    </div>
  `,
};

export const Empty: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${[]}></openp41ge-tree>
    </div>
  `,
};

export const DraggableNodes: Story = {
  render: () => html`
    <div
      style="width:280px;background:#1e1e1e;font-family:'SF Mono',Monaco,Menlo,Consolas,monospace;"
    >
      <openp41ge-tree .nodes=${basicNodes} .renderIcon=${treeIcon}></openp41ge-tree>
    </div>
  `,
};

// ─── Helpers ─────────────────────────────────────────────────────────

function _buildDeepTree(levels: number): TreeNode[] {
  if (levels <= 0) return [];
  const root: TreeNode = {
    id: `level-${levels}`,
    label: `folder-${levels}`,
    icon: "folder-closed",
    expanded: levels <= 2,
    children:
      levels > 1
        ? _buildDeepTree(levels - 1)
        : [
            { id: `file-${levels}-a`, label: "index.ts", icon: "index.ts" },
            { id: `file-${levels}-b`, label: "styles.css", icon: "styles.css" },
          ],
  };
  return [root];
}
