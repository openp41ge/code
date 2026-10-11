/**
 * <openp41ge-toast> — lightweight notification toast for non-blocking messages.
 *
 * Auto-dismisses after a configurable duration.
 * Multiple toasts stack vertically at the top-right corner.
 *
 * Usage:
 *   Openp41geToastService.show("Cloned successfully", "success");
 *   Openp41geToastService.show("Error cloning repo", "error", 5000);
 */

// ─── Inline style once ──────────────────────────────────────────────────

let _styleInjected = false;

function injectStyle(): void {
  if (_styleInjected) return;
  _styleInjected = true;
  const style = document.createElement("style");
  style.textContent = `
    openp41ge-toast {
      position: fixed;
      bottom: 12px;
      right: 12px;
      z-index: 99999;
      display: flex;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
    }
    .openp41ge-toast-item {
      pointer-events: auto;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 13px;
      color: #fff;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      animation: openp41ge-toast-in 0.2s ease-out;
      transition: opacity 0.2s ease, transform 0.2s ease;
      max-width: 360px;
      word-break: break-word;
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .openp41ge-toast-msg {
      flex: 1;
      min-width: 0;
      word-break: break-word;
    }
    .openp41ge-toast-close {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      padding: 0;
      border: none;
      border-radius: 4px;
      background: rgba(255, 255, 255, 0.15);
      color: rgba(255, 255, 255, 0.8);
      font-size: 11px;
      line-height: 1;
      cursor: pointer;
    }
    .openp41ge-toast-close:hover {
      background: rgba(255, 255, 255, 0.3);
      color: #fff;
    }
    .openp41ge-toast-item.openp41ge-toast-dismissing {
      opacity: 0;
      transform: translateX(40px);
    }
    .openp41ge-toast-item.openp41ge-toast-success {
      background: #1a6b3c;
      border: 1px solid #2a8c4e;
    }
    .openp41ge-toast-item.openp41ge-toast-error {
      background: #6b1a1a;
      border: 1px solid #8c2a2a;
    }
    .openp41ge-toast-item.openp41ge-toast-info {
      background: #1a3c6b;
      border: 1px solid #2a5c8e;
    }
    @keyframes openp41ge-toast-in {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
  `;
  document.head.appendChild(style);
}

// ─── Toast service ──────────────────────────────────────────────────────

export interface IToastService {
  show(
    message: string,
    type: "success" | "error" | "info",
    durationMs?: number,
    onClick?: () => void,
  ): void;
}

class Openp41geToastService implements IToastService {
  private _container: HTMLElement | null = null;

  private _getContainer(): HTMLElement {
    if (!this._container) {
      injectStyle();
      let existing = document.querySelector("openp41ge-toast") as HTMLElement | null;
      if (!existing) {
        existing = document.createElement("openp41ge-toast");
        existing.style.cssText =
          "position:fixed;bottom:12px;right:12px;z-index:99999;display:flex;flex-direction:column;gap:6px;pointer-events:none;";
        document.body.appendChild(existing);
      }
      this._container = existing;
    }
    return this._container;
  }

  show(
    message: string,
    type: "success" | "error" | "info" = "info",
    durationMs = 3000,
    onClick?: () => void,
  ): void {
    const container = this._getContainer();
    const item = document.createElement("div");
    item.className = `openp41ge-toast-item openp41ge-toast-${type}`;

    const msg = document.createElement("span");
    msg.className = "openp41ge-toast-msg";
    msg.textContent = message;
    item.appendChild(msg);

    // Every toast is manually dismissible. `durationMs === 0` additionally
    // disables auto-dismiss (used for error toasts so they don't vanish
    // before the user can inspect them).
    const close = document.createElement("button");
    close.className = "openp41ge-toast-close";
    close.type = "button";
    close.setAttribute("aria-label", "Dismiss");
    close.textContent = "✕";
    close.addEventListener("click", (e) => {
      e.stopPropagation();
      item.remove();
    });
    item.appendChild(close);

    if (onClick) {
      item.style.cursor = "pointer";
      item.addEventListener("click", onClick);
    }
    container.appendChild(item);

    if (durationMs > 0) {
      setTimeout(() => {
        item.classList.add("openp41ge-toast-dismissing");
        setTimeout(() => {
          item.remove();
        }, 200);
      }, durationMs);
    }
  }
}

/** Singleton instance for use across the app. */
export const toastService = new Openp41geToastService();
