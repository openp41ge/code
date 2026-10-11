/**
 * <file-extension-svg> — renders a material icon SVG for a given filename.
 *
 * Uses the material icon theme to resolve file-type-specific icons.
 *
 * Usage:
 *   <file-extension-svg filename="app.ts" size="16"></file-extension-svg>
 *   <file-extension-svg filename="package.json" size="20"></file-extension-svg>
 */

import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { getFileIcon } from "../icons/material-icons";

export class FileExtensionSvg extends LitElement {
  createRenderRoot() {
    return this.attachShadow({ mode: "open" });
  }

  @property({ type: String })
  filename: string = "";

  @property({ type: Number })
  size: number = 16;

  render() {
    if (!this.filename) return html``;
    const svg = getFileIcon(this.filename);
    if (!svg) return html``;
    // Inject width/height so the SVG scales to requested size
    const sized = svg.replace("<svg", `<svg width="${this.size}" height="${this.size}"`);
    return html`${unsafeHTML(sized)}`;
  }
}

if (!customElements.get("file-extension-svg")) {
  customElements.define("file-extension-svg", FileExtensionSvg);
}

declare global {
  interface HTMLElementTagNameMap {
    "file-extension-svg": FileExtensionSvg;
  }
}
