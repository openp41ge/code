/**
 * settings-icons.ts — the icons of the settings editors' bars (Save, Reset,
 * Show default values, Sort keys, the JSON view switch).
 */

import { html, type TemplateResult } from "lit";

/** Resets/discard (Reset) icon — reused by the drawer head + standalone footer. */
export function resetIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
    <path
      d="M520-330v-60h160v60H520Zm60 210v-50h-60v-60h60v-50h60v160h-60Zm100-50v-60h160v60H680Zm40-110v-160h60v50h60v60h-60v50h-60Zm111-280h-83q-26-88-99-144t-169-56q-117 0-198.5 81.5T200-480q0 72 32.5 132t87.5 98v-110h80v240H160v-80h94q-62-50-98-122.5T120-480q0-75 28.5-140.5t77-114q48.5-48.5 114-77T480-840q129 0 226.5 79.5T831-560Z"
    />
  </svg>`;
}

/** Save icon — reused by the drawer head + standalone footer. */
export function saveIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
    <path
      d="M840-680v480q0 33-23.5 56.5T760-120H200q-33 0-56.5-23.5T120-200v-560q0-33 23.5-56.5T200-840h480l160 160Zm-80 34L646-760H200v560h560v-446ZM565-275q35-35 35-85t-35-85q-35-35-85-35t-85 35q-35 35-35 85t35 85q35 35 85 35t85-35ZM240-560h360v-160H240v160Zm-40-86v446-560 114Z"
    />
  </svg>`;
}

/** Show default values (eye) icon. */
export function showDefaultsIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
    <path
      d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-60q-50 0-85-35t-35-85q0-50 35-85t85-35q50 0 85 35t35 85q0 50-35 85t-85 35Zm0 180q-146 0-246-70T60-500q74-160 174-230t246-70q146 0 246 70t174 230q-74 160-174 230t-246 70Zm0-60q105 0 188-55t132-145q-49-90-132-145t-188-55q-105 0-188 55T120-500q49 90 132 145t188 55Z"
    />
  </svg>`;
}

/** Sort keys icon. */
export function sortKeysIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" fill="currentColor">
    <path d="M120-240v-80h240v80H120Zm0-200v-80h480v80H120Zm0-200v-80h720v80H120Z" />
  </svg>`;
}

/** JSON view ({ }) icon — the Form/JSON switch, as the workspace editor's. */
export function jsonIcon(): TemplateResult {
  return html`<svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    stroke-width="1.2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path
      d="M6 3.5C5 3.5 4.5 4 4.5 5v1c0 .8-.4 1.2-1.5 1.5 1.1.3 1.5.7 1.5 1.5v1c0 1 .5 1.5 1.5 1.5"
    />
    <path
      d="M10 3.5c1 0 1.5.5 1.5 1.5v1c0 .8.4 1.2 1.5 1.5-1.1.3-1.5.7-1.5 1.5v1c0 1-.5 1.5-1.5 1.5"
    />
  </svg>`;
}
