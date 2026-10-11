/**
 * confirm.ts — the confirm dialog window's renderer.
 *
 * A tiny standalone page: it receives the confirm options over IPC, renders the
 * dialog (title, message, detail, optional opt-in checkbox, Cancel/Confirm
 * buttons), handles Enter / Escape / Tab, and reports its answer back to the
 * main process. The window has no app chrome — its content IS the dialog.
 *
 * The element's look matches the app's dark theme CSS variables (themes.css) and
 * the button ordering of the retired in-window modal (Cancel left, Confirm
 * right). It deliberately does NOT use <openp41ge-confirm-modal> — that element
 * is removed from the app entirely.
 */

import "../styles/themes.css";

// ─── Confirm types (mirrors the main-process contract) ────────────────────

interface ConfirmOptions {
  message: string;
  title?: string;
  detail?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmStyle?: "danger" | string;
  checkboxLabel?: string;
  checkboxDetail?: string;
}

interface ConfirmAnswer {
  confirmId: string;
  confirmed: boolean;
  checked: boolean;
}

interface ConfirmBridge {
  onOptions(cb: (json: string) => void): void;
  respond(payload: ConfirmAnswer): void;
  fitSize(payload: { confirmId: string; height: number }): void;
}

const bridge = (window as unknown as { openp41ge?: { confirm?: ConfirmBridge } }).openp41ge
  ?.confirm;

const root = document.getElementById("root");
if (!root) throw new Error("confirm: #root not found");
if (!bridge) throw new Error("confirm: preload bridge missing");

let confirmId = "";
let checked = false;

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Report the confirmed result to the main process. */
function respond(confirmed: boolean): void {
  bridge!.respond({ confirmId, confirmed, checked });
}

/**
 * Ask the main process to size the window to fit the rendered content
 * (content-driven height). The main process clamps + re-centres over the
 * launching window.
 */
function reportSize(): void {
  requestAnimationFrame(() => {
    const el = root!.firstElementChild as HTMLElement | null;
    if (el) bridge!.fitSize({ confirmId, height: Math.ceil(el.getBoundingClientRect().height) });
  });
}

function render(options: ConfirmOptions): void {
  const title = options.title ?? "";
  const detail = options.detail ?? "";

  const card = document.createElement("div");
  card.className = "cf-card";

  // Inject the dialog styles once (self-contained; no Tailwind in this page).
  if (!document.getElementById("cf-styles")) {
    const s = document.createElement("style");
    s.id = "cf-styles";
    s.textContent = `
      .cf-card {
        display: flex; flex-direction: column; gap: 0;
        padding: 18px 20px 16px;
        font-size: 13px; color: var(--text-primary);
      }
      .cf-title {
        font-size: 13px; font-weight: 600; color: var(--text-primary);
        margin-bottom: 8px;
      }
      .cf-message {
        color: var(--text-secondary); white-space: pre-line;
        line-height: 1.4; margin-bottom: 16px;
      }
      .cf-detail {
        color: var(--text-muted); font-size: 12px; line-height: 1.4;
        white-space: pre-line;
        margin: -8px 0 16px;
      }
      .cf-checkbox-card {
        display: flex; align-items: flex-start; gap: 10px;
        padding: 10px 12px; margin-bottom: 16px;
        border: 1px solid var(--border-color); border-radius: 8px;
        background: rgba(255,255,255,0.04);
        cursor: pointer; user-select: none;
      }
      .cf-checkbox-card input[type="checkbox"] {
        appearance: none; -webkit-appearance: none;
        width: 14px; height: 14px; flex-shrink: 0; margin-top: 2px;
        border: 1px solid rgba(255,255,255,0.28); border-radius: 4px;
        background: rgba(255,255,255,0.06); cursor: pointer; position: relative;
        outline: none;
      }
      .cf-checkbox-card input[type="checkbox"]:checked { background: var(--accent); border-color: var(--accent); }
      .cf-checkbox-card input[type="checkbox"]:checked::after {
        content: ""; position: absolute; left: 4px; top: 1px;
        width: 4px; height: 8px; border: solid #fff; border-width: 0 1.5px 1.5px 0;
        transform: rotate(45deg); box-sizing: border-box;
      }
      .cf-checkbox-card:has(input:checked) { border-color: var(--accent); background: rgba(86,156,214,0.08); }
      .cf-checkbox-body { display: block; min-width: 0; }
      .cf-checkbox-label { display: block; font-weight: 500; color: var(--text-primary); line-height: 1.3; }
      .cf-checkbox-detail { display: block; font-size: 11px; color: var(--text-secondary); line-height: 1.3; margin-top: 2px; }
      .cf-actions { display: flex; gap: 8px; justify-content: flex-start; }
      .cf-btn {
        border: none; border-radius: 6px; padding: 6px 16px;
        font-size: 13px; cursor: pointer; font-family: inherit;
        background: var(--bg-tertiary); color: var(--text-secondary);
      }
      .cf-btn:hover { background: #3a3a3a; }
      .cf-btn:focus { outline: 2px solid var(--border-focus); outline-offset: 2px; }
      .cf-ok { background: var(--accent); color: #fff; }
      .cf-ok:hover { background: var(--accent-hover); }
      .cf-ok.cf-danger { background: rgba(244,71,71,0.15); color: var(--accent-error); }
      .cf-ok.cf-danger:hover { background: rgba(244,71,71,0.25); }
      .cf-ok.cf-danger:focus { outline: 2px solid var(--accent-error); }
    `;
    document.head.appendChild(s);
  }

  const body: string[] = [];
  if (title) body.push(`<div class="cf-title">${escapeHtml(title)}</div>`);
  body.push(`<div class="cf-message">${escapeHtml(options.message)}</div>`);
  if (detail) body.push(`<div class="cf-detail">${escapeHtml(detail)}</div>`);

  const checkbox =
    options.checkboxLabel != null && options.checkboxLabel !== ""
      ? `<label class="cf-checkbox-card">
           <input type="checkbox" id="cf-checkbox" />
           <span class="cf-checkbox-body">
             <span class="cf-checkbox-label">${escapeHtml(options.checkboxLabel)}</span>
             ${
               options.checkboxDetail
                 ? `<span class="cf-checkbox-detail">${escapeHtml(options.checkboxDetail)}</span>`
                 : ""
             }
           </span>
         </label>`
      : "";

  const confirmStyle =
    options.confirmStyle === "danger" ? "cf-btn cf-ok cf-danger" : "cf-btn cf-ok";

  card.innerHTML =
    body.join("") +
    checkbox +
    `<div class="cf-actions">
       <button type="button" class="cf-btn cf-cancel">${escapeHtml(
         options.cancelLabel ?? "Cancel",
       )}</button>
       <button type="button" class="${confirmStyle}">${escapeHtml(
         options.confirmLabel ?? "Confirm",
       )}</button>
     </div>`;

  root!.appendChild(card);

  const okBtn = card.querySelector<HTMLButtonElement>(".cf-ok")!;
  const cancelBtn = card.querySelector<HTMLButtonElement>(".cf-cancel")!;
  const checkboxInput = card.querySelector<HTMLInputElement>("#cf-checkbox");

  card.querySelector(".cf-checkbox-card")?.addEventListener("click", () => {
    if (checkboxInput) checked = checkboxInput.checked;
  });

  cancelBtn.addEventListener("click", () => respond(false));
  okBtn.addEventListener("click", () => respond(true));

  // Keyboard: Escape cancels, Enter activates the focused control, Tab cycles.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      respond(false);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const active = document.activeElement;
      if (active === cancelBtn) {
        respond(false);
      } else if (active === checkboxInput) {
        checkboxInput!.checked = !checkboxInput!.checked;
        checked = checkboxInput!.checked;
      } else {
        respond(true);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const focusable: HTMLElement[] = [];
      if (checkboxInput) focusable.push(checkboxInput);
      focusable.push(cancelBtn, okBtn);
      const idx = focusable.indexOf(document.activeElement as HTMLElement);
      if (idx === -1) focusable[0]?.focus();
      else {
        const next = e.shiftKey
          ? (idx - 1 + focusable.length) % focusable.length
          : (idx + 1) % focusable.length;
        focusable[next]?.focus();
      }
    }
  });

  okBtn.focus();
}

bridge.onOptions((json: string) => {
  const data = JSON.parse(json) as { confirmId: string; options: ConfirmOptions };
  confirmId = data.confirmId;
  render(data.options);
  reportSize();
});
