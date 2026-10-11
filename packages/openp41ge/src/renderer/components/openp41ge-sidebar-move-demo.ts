/**
 * <openp41ge-sidebar-move-demo> - an animated mock of a workspace window
 * showing a system tab being dragged from one sidebar to the other.
 *
 * Each sidebar has a system tab at its top, with content cells below. The
 * tab is dragged from the left sidebar's top across the window and dropped
 * onto the right sidebar's top. Only once it lands does the content move:
 * the left sidebar empties and the right sidebar fills, so just one
 * sidebar holds content at a time. Under `prefers-reduced-motion` the
 * mock freezes with the left sidebar holding the tab and content.
 */

import { html, LitElement, type TemplateResult } from "lit";

export class Openp41geSidebarMoveDemo extends LitElement {
  override render(): TemplateResult {
    return html`
      <style>
        .demo {
          position: relative;
          width: 100%;
          height: 178px;
          background: var(--bg, #1e1e1e);
          border: 1px solid var(--divider, #444);
          border-radius: 9px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
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
          position: relative;
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
        .fly {
          position: absolute;
          width: 18px;
          height: 9px;
          border-radius: 4.5px;
          background: var(--accent, #79c0ff);
          opacity: 0;
          animation: fly 5.6s ease-in-out infinite;
        }
        .side--right {
          width: 44px;
          flex-shrink: 0;
          margin-left: auto;
          overflow: hidden;
          border-radius: 5px;
          background: var(--bg-secondary, #161616);
          padding: 6px 5px;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        /* Content only moves once the tab is dropped. */
        .side--right .chip {
          animation: contentIn 5.6s ease-in-out infinite;
        }

        .tab {
          width: 18px;
          height: 9px;
          border-radius: 4.5px;
          background: var(--accent, #79c0ff);
          flex-shrink: 0;
        }
        .side--left .tab {
          animation: tabOut 5.6s ease-in-out infinite;
        }
        .side--right .tab {
          opacity: 0;
          animation: tabIn 5.6s ease-in-out infinite;
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
        .chip--out {
          animation: contentOut 5.6s ease-in-out infinite;
        }

        @keyframes fly {
          8% {
            left: 11px;
            top: 12px;
            opacity: 0.9;
          }
          78% {
            left: calc(100% - 45px);
            top: 12px;
            opacity: 0.9;
          }
          100% {
            left: calc(100% - 45px);
            top: 12px;
            opacity: 0;
          }
        }

        @keyframes contentOut {
          8% {
            opacity: 0.9;
          }
          78% {
            opacity: 0.9;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes contentIn {
          8% {
            opacity: 0;
          }
          78% {
            opacity: 0;
          }
          100% {
            opacity: 0.9;
          }
        }

        @keyframes tabOut {
          8% {
            opacity: 0.9;
          }
          78% {
            opacity: 0;
          }
          100% {
            opacity: 0;
          }
        }

        @keyframes tabIn {
          8% {
            opacity: 0;
          }
          78% {
            opacity: 0;
          }
          100% {
            opacity: 0.9;
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .fly,
          .side--right .chip,
          .chip--out,
          .side--left .tab,
          .side--right .tab {
            animation: none;
          }
          .fly {
            display: none;
          }
          .side--right .chip,
          .side--right .tab {
            opacity: 0;
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
          <div class="side side--left">
            <div class="tab"></div>
            <div class="chip chip--out"></div>
            <div class="chip chip--dim chip--out"></div>
            <div class="chip chip--dim chip--out"></div>
          </div>
          <div class="side side--right">
            <div class="tab"></div>
            <div class="chip"></div>
            <div class="chip chip--dim"></div>
            <div class="chip chip--dim"></div>
          </div>
          <div class="fly"></div>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-sidebar-move-demo", Openp41geSidebarMoveDemo);
