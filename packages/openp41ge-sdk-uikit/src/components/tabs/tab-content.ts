/**
 * <tab-content> — renders tab content containers that preserve mounted DOM.
 *
 * Each tab renders a container div with a stable data-tab-id attribute.
 * The host can mount controller-managed DOM into the controller slot using
 * mountController/unmountController. Lit re-renders preserve these elements
 * because they have stable identifiers.
 *
 * If a tab has string content (from tabData), it's rendered via unsafeHTML
 * in the string-content div. When a controller is mounted, the string-content
 * div is hidden.
 *
 * Light DOM for compatibility with elementFromPoint and query selectors.
 */

import { LitElement, html } from "lit";
import { property } from "lit/decorators.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";

// ─── Component ──────────────────────────────────────────────────────

export class TabContent extends LitElement {
  @property({ type: Array }) tabIds: string[] = [];
  @property({ type: String }) activeTabId: string = "";
  @property({ type: Object }) tabs: Record<string, { content: string }> = {};

  createRenderRoot() {
    return this;
  }

  // ─── Render ─────────────────────────────────────────────────────

  render() {
    if (this.tabIds.length === 0) {
      return html`
        <div
          class="tab-content-empty"
          style="
            height:100%;
            background:var(--bg-primary, #161616);
            display:flex;
            flex-direction:column;
            align-items:center;
            justify-content:center;
            padding:40px;
            box-sizing:border-box;
            overflow:hidden;
            user-select:none;
          "
        >
          <p
            style="
              font-size:13px;
              color:var(--text-muted, #666);
              font-family:var(--font-ui);
            "
          >
            no tabs
          </p>
        </div>
      `;
    }
    return html`
      ${this.tabIds.map(
        (id) => html`
          <div
            class="tab-content-pane"
            data-tab-id=${id}
            ?hidden=${id !== this.activeTabId}
            style="display:${id === this.activeTabId ? "flex" : "none"};flex-direction:column;height:100%;overflow:hidden;box-sizing:border-box;"
          >
            <!-- String-based content (from tabData.content, used by demo) -->
            <div class="tab-content-string" style="flex:1;overflow-y:auto;padding:16px;">
              ${this.tabs[id] ? unsafeHTML(this.tabs[id].content) : ""}
            </div>
            <!-- Controller container (used by openp41ge for controllers) -->
            <div
              class="tab-content-controller"
              style="flex:1;overflow:hidden;display:none;min-height:0;"
            ></div>
          </div>
        `,
      )}
    `;
  }

  /**
   * Get the controller container for a tab. The host appends controller
   * DOM elements here. Returns null if the tab doesn't exist in this grid.
   */
  getControllerContainer(tabId: string): HTMLElement | null {
    const pane = this.querySelector(`[data-tab-id="${tabId}"]`);
    if (!pane) return null;
    return pane.querySelector(".tab-content-controller") as HTMLElement | null;
  }

  /**
   * Mount a controller element into a tab's content area.
   * This hides the string-content div (if any) and shows the controller div.
   * Returns true if the mount succeeded.
   */
  mountController(tabId: string, element: HTMLElement): boolean {
    const pane = this.querySelector(`[data-tab-id="${tabId}"]`);
    if (!pane) return false;

    const controllerDiv = pane.querySelector(".tab-content-controller") as HTMLElement;
    if (!controllerDiv) return false;

    // Hide string content, show controller
    const stringDiv = pane.querySelector(".tab-content-string") as HTMLElement;
    if (stringDiv) stringDiv.style.display = "none";
    controllerDiv.style.display = "flex";

    // Only append if not already a child
    if (!controllerDiv.contains(element)) {
      controllerDiv.appendChild(element);
    }
    return true;
  }

  /**
   * Unmount a controller element from a tab's content area.
   */
  unmountController(tabId: string, element: HTMLElement): boolean {
    const pane = this.querySelector(`[data-tab-id="${tabId}"]`);
    if (!pane) return false;

    const controllerDiv = pane.querySelector(".tab-content-controller") as HTMLElement;
    if (!controllerDiv) return false;

    if (controllerDiv.contains(element)) {
      controllerDiv.removeChild(element);
    }

    // Show string content again if no more controller children
    if (controllerDiv.children.length === 0) {
      controllerDiv.style.display = "none";
      const stringDiv = pane.querySelector(".tab-content-string") as HTMLElement;
      if (stringDiv) stringDiv.style.display = "";
    }
    return true;
  }
}

if (!customElements.get("tab-content")) {
  customElements.define("tab-content", TabContent);
}
