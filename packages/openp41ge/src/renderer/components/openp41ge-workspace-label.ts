/**
 * <openp41ge-workspace-label> — title-bar workspace name label.
 *
 * Degraded from the former <openp41ge-workspace-search> button: the workspace
 * name is now plain text in the title bar (no icon, not clickable). The
 * Workspaces overlay is reached from the system overlay / Window menu instead.
 */

import { LitElement, html } from "lit";
import { workspaceFileService } from "../services/workspace-file-service";

const WORKSPACE_CHANGED_EVENT = "workspace-file-changed";

class Openp41geWorkspaceLabel extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    document.addEventListener(WORKSPACE_CHANGED_EVENT, this._onUpdate);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    document.removeEventListener(WORKSPACE_CHANGED_EVENT, this._onUpdate);
  }

  private _onUpdate = (): void => {
    this.requestUpdate();
  };

  render() {
    return html`
      <div
        style="display:flex;align-items:center;max-width:min(180px, calc((100vw - 270px) / 2));height:100%;padding:0 8px;box-sizing:border-box;user-select:none;white-space:nowrap;-webkit-app-region:no-drag;"
      >
        <span
          style="min-width:0;overflow:hidden;text-overflow:ellipsis;font-size:12px;color:var(--text-muted,#888);"
          >${workspaceFileService.openWorkspaceName}</span
        >
      </div>
    `;
  }
}

customElements.define("openp41ge-workspace-label", Openp41geWorkspaceLabel);
