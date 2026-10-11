/**
 * fatal.ts — the fatal error window's renderer.
 *
 * A tiny standalone page shown when the main process hits an unrecoverable
 * (fatal) error. It renders the error message + stack, and offers a single
 * "Acknowledge & Quit" action. The app does not exit until the user
 * acknowledges (or closes the window). It is deliberately self-contained —
 * it must render even when the rest of the app is in an unknown/broken state,
 * so it does not depend on the app's component or bootstrap pipeline.
 *
 * This is a system-level concern, outside the logger. The fatal error is never
 * written to the log bus or forwarded to renderer overlays.
 */

import "../styles/themes.css";

// ─── Fatal types (mirrors the main-process contract) ─────────────────────

interface FatalErrorPayload {
  message: string;
  stack?: string;
  timestamp?: number;
}

interface FatalBridge {
  onError(cb: (json: string) => void): void;
  acknowledge(): void;
}

const bridge = (window as unknown as { openp41ge?: { fatal?: FatalBridge } }).openp41ge?.fatal;

const root = document.getElementById("root");
if (!root) throw new Error("fatal: #root not found");
if (!bridge) throw new Error("fatal: preload bridge missing");

const escapeHtml = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Report the user's acknowledgment (app then quits). */
function acknowledge(): void {
  bridge!.acknowledge();
}

function render(payload: FatalErrorPayload): void {
  const message = payload.message || "An unrecoverable error occurred.";
  const stack = payload.stack ?? "";

  const card = document.createElement("div");
  card.className = "ft-card";

  if (!document.getElementById("ft-styles")) {
    const s = document.createElement("style");
    s.id = "ft-styles";
    s.textContent = `
      .ft-card {
        display: flex; flex-direction: column; gap: 12px;
        padding: 20px 22px 18px; width: 100%; height: 100%;
        font-size: 13px; color: var(--text-primary);
      }
      .ft-head {
        display: flex; align-items: center; gap: 10px;
      }
      .ft-badge {
        flex-shrink: 0; padding: 3px 10px; border-radius: 999px;
        background: rgba(244,71,71,0.15); color: var(--accent-error, #f44747);
        font-size: 11px; font-weight: 700; letter-spacing: 0.05em;
        text-transform: uppercase;
      }
      .ft-title {
        font-size: 14px; font-weight: 600; color: var(--text-primary);
      }
      .ft-message {
        color: var(--text-secondary); white-space: pre-wrap;
        line-height: 1.45; word-break: break-word;
      }
      .ft-stack {
        flex: 1 1 auto; overflow: auto; max-height: 40vh;
        background: rgba(0,0,0,0.3); border: 1px solid var(--border-color);
        border-radius: 8px; padding: 10px 12px;
        font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        font-size: 11px; line-height: 1.45; color: var(--text-secondary);
        white-space: pre-wrap; user-select: text;
      }
      .ft-hint {
        color: var(--text-muted); font-size: 11px; line-height: 1.4;
      }
      .ft-actions {
        display: flex; justify-content: flex-start; gap: 8px;
      }
      .ft-btn {
        border: none; border-radius: 6px; padding: 7px 18px;
        font-size: 13px; cursor: pointer; font-family: inherit;
        background: rgba(244,71,71,0.15); color: var(--accent-error, #f44747);
      }
      .ft-btn:hover { background: rgba(244,71,71,0.25); }
      .ft-btn:focus { outline: 2px solid var(--accent-error, #f44747); outline-offset: 2px; }
    `;
    document.head.appendChild(s);
  }

  card.innerHTML = `
    <div class="ft-head">
      <span class="ft-badge">Fatal</span>
      <span class="ft-title">The application encountered an unrecoverable error and must close.</span>
    </div>
    <div class="ft-message">${escapeHtml(message)}</div>
    ${stack ? `<div class="ft-stack">${escapeHtml(stack)}</div>` : ""}
    <div class="ft-hint">No further action is needed. Acknowledge to quit openp41ge.</div>
    <div class="ft-actions">
      <button type="button" class="ft-btn">Acknowledge &amp; Quit</button>
    </div>
  `;

  root!.appendChild(card);

  const btn = card.querySelector<HTMLButtonElement>(".ft-btn")!;
  btn.addEventListener("click", acknowledge);

  // Enter / Escape both acknowledge — the app must not remain running.
  window.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === "Escape") {
      e.preventDefault();
      acknowledge();
    }
  });

  btn.focus();
}

bridge.onError((json: string) => {
  try {
    render(JSON.parse(json) as FatalErrorPayload);
  } catch {
    render({ message: "An unrecoverable error occurred.", stack: json });
  }
});
