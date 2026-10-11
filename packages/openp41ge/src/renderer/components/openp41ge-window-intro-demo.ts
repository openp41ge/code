/**
 * <openp41ge-window-intro-demo> — an animated mock of the workspace window
 * "opening": the window fades and slides in on a loop, revealing a sidebar and
 * a grid cell. Used on the first Welcome slide.
 */

import { html, LitElement, type TemplateResult } from "lit";

export class Openp41geWindowIntroDemo extends LitElement {
  override render(): TemplateResult {
    return html`
      <style>
        :host {
          display: block;
        }
        .demo {
          height: 178px;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          border-radius: 9px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
          animation: open 5.6s ease-in-out infinite;
        }
        .chrome {
          height: 26px;
          flex-shrink: 0;
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 0 10px;
          background: var(--bg-secondary, #161616);
          border-bottom: 1px solid var(--divider, #333);
        }
        .dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--text-secondary, #999);
          opacity: 0.45;
        }
        .cbtn {
          width: 11px;
          height: 11px;
          border-radius: 3px;
          background: var(--bg-active, #37373d);
          flex-shrink: 0;
        }
        .cbtn--label {
          width: 22px;
        }
        .spacer {
          flex: 1;
        }
        .body {
          flex: 1;
          min-height: 0;
          display: flex;
          gap: 6px;
          padding: 6px;
        }
        .side {
          width: 44px;
          flex-shrink: 0;
          overflow: hidden;
          border-radius: 5px;
          background: var(--bg-secondary, #161616);
          padding: 6px 5px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .tab {
          width: 18px;
          height: 9px;
          border-radius: 4.5px;
          background: var(--accent, #79c0ff);
          flex-shrink: 0;
        }
        .chip {
          width: 32px;
          height: 14px;
          border-radius: 4px;
          background: rgba(86, 156, 214, 0.4);
          flex-shrink: 0;
        }
        .chip--dim {
          background: var(--bg-active, #37373d);
        }
        .grid {
          flex: 1;
          display: flex;
          gap: 6px;
        }
        .cell {
          flex: 1;
          min-width: 0;
          background: var(--bg-active, #2c2c31);
          border-radius: 5px;
        }
        .cell--accent {
          background: rgba(86, 156, 214, 0.28);
        }
        @keyframes open {
          0%,
          12% {
            opacity: 0;
            transform: translateY(8px) scale(0.98);
          }
          40%,
          100% {
            opacity: 1;
            transform: none;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .demo {
            animation: none;
            opacity: 1;
          }
        }
      </style>
      <div class="demo">
        <div class="chrome">
          <span class="dot"></span><span class="dot"></span><span class="dot"></span>
          <span class="cbtn"></span><span class="cbtn"></span><span class="cbtn"></span>
          <span class="spacer"></span>
          <span class="cbtn cbtn--label"></span><span class="cbtn"></span>
        </div>
        <div class="body">
          <div class="side">
            <div class="tab"></div>
            <div class="chip"></div>
            <div class="chip chip--dim"></div>
            <div class="chip chip--dim"></div>
          </div>
          <div class="grid">
            <div class="cell"></div>
            <div class="cell cell--accent"></div>
          </div>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-window-intro-demo", Openp41geWindowIntroDemo);
