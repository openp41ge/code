import { html } from "lit";
import type { Meta, StoryObj } from "@storybook/web-components";
import "./file-extension-svg";
import { getAllIconNames } from "../icons/material-icons";

const meta: Meta = {
  title: "Icons/File Extension",
  component: "file-extension-svg",
  argTypes: {
    filename: { control: "text" },
    size: { control: { type: "number", min: 8, max: 64 } },
  },
  args: {
    filename: "app.ts",
    size: 16,
  },
};

export default meta;
type Story = StoryObj;

export const Default: Story = {
  render: (args) => html`
    <div
      style="display:flex;align-items:center;gap:8px;padding:8px;font-family:monospace;font-size:13px;color:#d4d4d4;"
    >
      <file-extension-svg filename=${args.filename} size=${args.size}></file-extension-svg>
      <span>${args.filename}</span>
    </div>
  `,
};

export const CommonFiles: Story = {
  render: () => html`
    <div
      style="display:flex;flex-direction:column;gap:4px;padding:8px;font-family:monospace;font-size:13px;color:#d4d4d4;"
    >
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="app.ts" size="16"></file-extension-svg><span>app.ts</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="styles.css" size="16"></file-extension-svg
        ><span>styles.css</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="index.js" size="16"></file-extension-svg><span>index.js</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="package.json" size="16"></file-extension-svg
        ><span>package.json</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="README.md" size="16"></file-extension-svg
        ><span>README.md</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="Dockerfile" size="16"></file-extension-svg
        ><span>Dockerfile</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename=".gitignore" size="16"></file-extension-svg
        ><span>.gitignore</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="index.tsx" size="16"></file-extension-svg
        ><span>index.tsx</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="logo.svg" size="16"></file-extension-svg><span>logo.svg</span>
      </div>
      <div style="display:flex;align-items:center;gap:8px;">
        <file-extension-svg filename="image.png" size="16"></file-extension-svg
        ><span>image.png</span>
      </div>
    </div>
  `,
};

export const AllIcons: Story = {
  render: () => {
    const names = getAllIconNames();
    const groups: Record<string, string[]> = {};
    for (const name of names) {
      // Group by first letter
      const key = name[0]?.toUpperCase() ?? "#";
      if (!groups[key]) groups[key] = [];
      groups[key].push(name);
    }
    const letters = Object.keys(groups).sort();
    return html`
      <div style="padding:12px;background:#1e1e1e;font-family:monospace;color:#d4d4d4;">
        <div style="font-size:13px;margin-bottom:8px;color:#999;">
          All ${names.length} material icons
        </div>
        ${letters.map(
          (letter) => html`
            <div style="margin-bottom:8px;">
              <div style="font-size:11px;color:#666;margin-bottom:4px;">${letter}</div>
              <div style="display:flex;flex-wrap:wrap;gap:2px;">
                ${groups[letter].map(
                  (name) => html`
                    <div
                      style="display:flex;flex-direction:column;align-items:center;gap:2px;width:48px;padding:4px;border-radius:2px;cursor:default;"
                      title=${name}
                    >
                      <file-extension-svg filename=${name} size="14"></file-extension-svg>
                      <span
                        style="font-size:7px;color:#888;overflow:hidden;text-overflow:ellipsis;max-width:48px;"
                        >${name}</span
                      >
                    </div>
                  `,
                )}
              </div>
            </div>
          `,
        )}
      </div>
    `;
  },
};

export const Sizes: Story = {
  render: () => html`
    <div style="display:flex;align-items:center;gap:12px;padding:8px;">
      <file-extension-svg filename="app.ts" size="12"></file-extension-svg>
      <file-extension-svg filename="app.ts" size="16"></file-extension-svg>
      <file-extension-svg filename="app.ts" size="20"></file-extension-svg>
      <file-extension-svg filename="app.ts" size="24"></file-extension-svg>
      <file-extension-svg filename="app.ts" size="32"></file-extension-svg>
    </div>
  `,
};
