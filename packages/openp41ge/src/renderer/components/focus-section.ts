/**
 * <focus-section> — inert wrapper element (Lit).
 *
 * No-op wrapper element. Previously a focus-group boundary with Tab-trapping.
 * Kept as a no-op so existing HTML does not break.
 */

import { LitElement, html, type TemplateResult } from "lit";

// Inject `:focus-visible` styles for interactive elements so
// keyboard-focused buttons, tabs, etc. still get a visible blue outline.
let _styleInjected = false;
function injectStyle() {
  if (_styleInjected) return;
  _styleInjected = true;
  const s = document.createElement("style");
  s.textContent = `
    focus-section {
      display: block;
      position: relative;
      outline: none;
    }
    button:focus-visible,
    select:focus-visible,
    a:focus-visible,
    input:focus-visible,
    textarea:focus-visible,
    [tabindex]:not([tabindex="-1"]):focus-visible {
      outline: 2px solid #4a9eff;
      outline-offset: 0;
    }
  `;
  (document.head || document.documentElement).appendChild(s);
}

class FocusSection extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  render(): TemplateResult {
    return html`<slot></slot>`;
  }
}

if (!customElements.get("focus-section")) {
  injectStyle();
  customElements.define("focus-section", FocusSection);
}

export default FocusSection;
