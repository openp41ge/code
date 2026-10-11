/**
 * <openp41ge-grid-demo> — an animated mock of a workspace window's grid: a
 * small sidebar element is dragged into the grid and creates a new cell, on a
 * loop. Used in the Welcome intro to illustrate that the grid is column-based
 * and that dragging a sidebar element in makes a cell. The sidebar here is
 * deliberately narrow/faint so the grid is the focus, and the explanation text
 * sits beside it.
 */

import { html, LitElement, type TemplateResult } from "lit";

export class Openp41geGridDemo extends LitElement {
  override render(): TemplateResult {
    return html`
      <style>
        :host {
          display: block;
        }
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
          min-width: 120px;
          display: flex;
          gap: 6px;
        }
        .cell {
          flex: 1 1 0;
          min-width: 0;
          background: var(--bg-active, #2c2c31);
          border-radius: 5px;
        }
        /* The cell created by the drop: starts empty and slides out under the
           hovering chip, then turns grey once the chip is dropped. */
        .cell--new {
          flex: 0 1 0;
          background: rgba(86, 156, 214, 0.28);
          animation:
            grow 5.6s ease-in-out infinite,
            settle 5.6s ease-in-out infinite;
        }
        /* The dragged chip: flies from the sidebar into the grid, then lands. */
        .fly {
          position: absolute;
          width: 26px;
          height: 15px;
          border-radius: 4px;
          background: var(--accent, #79c0ff);
          opacity: 0;
          animation: fly 5.6s ease-in-out infinite;
        }
        @keyframes fly {
          0%,
          8% {
            left: 18px;
            top: 68px;
            opacity: 0.9;
          }
          48% {
            left: 208px;
            top: 88px;
            opacity: 0.9;
          }
          76% {
            left: 208px;
            top: 88px;
            opacity: 0.9;
          }
          80%,
          100% {
            left: 208px;
            top: 88px;
            opacity: 0;
          }
        }
        @keyframes grow {
          0%,
          52% {
            flex-grow: 0;
          }
          76%,
          100% {
            flex-grow: 1;
          }
        }

        /* The dropped chip's cell settles into a plain grey column. */
        @keyframes settle {
          0%,
          80% {
            background: rgba(86, 156, 214, 0.28);
          }
          90%,
          100% {
            background: var(--bg-active, #2c2c31);
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .fly,
          .cell--new {
            animation: none;
          }
          .fly {
            display: none;
          }
          .cell--new {
            flex: 1 1 0;
            background: var(--bg-active, #2c2c31);
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
            <div class="cell cell--new"></div>
          </div>
          <div class="fly"></div>
        </div>
      </div>
    `;
  }
}

customElements.define("openp41ge-grid-demo", Openp41geGridDemo);
