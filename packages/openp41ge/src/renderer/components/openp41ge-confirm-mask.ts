/**
 * <openp41ge-confirm-mask> — dim mask shown over a window while a confirmation
 * dialog is open.
 *
 * The acquire a confirmation is open in a separate native window (see
 * electron/confirm-dialog-manager.ts). This overlay dims the launching window
 * and, in the centre, points the user at the confirmation dialog. It blocks
 * all interaction with the window beneath it.
 *
 * Created and removed by the `confirm:mask-show` / `confirm:mask-hide` IPC
 * listeners (RegisterIpcListenersStep).
 */

import { LitElement, html, type TemplateResult } from "lit";
import { property } from "lit/decorators.js";

class Openp41geConfirmMask extends LitElement {
  protected createRenderRoot(): HTMLElement | DocumentFragment {
    return this;
  }

  /** Message shown in the centre, pointing the user at the dialog. */
  @property() message = "A confirmation is open — respond in the dialog window.";

  render(): TemplateResult {
    return html`
      <div
        class="openp41ge-confirm-mask"
        style="position: fixed; inset: 0; z-index: 100000; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; pointer-events: auto;"
      >
        <div
          class="openp41ge-confirm-mask-msg"
          style="max-width: 320px; padding: 14px 18px; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-modal); text-align: center; font-size: 13px; color: var(--text-primary); line-height: 1.4;"
        >
          ${this.message}
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-confirm-mask", Openp41geConfirmMask);
