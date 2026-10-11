/**
 * Icon registry — maps icon names to SVG render functions.
 *
 * Each entry is a function `(size?: number) => string` so the caller
 * controls the rendered size. The `<openp41ge-icon>` component uses
 * this registry to resolve `name` → SVG.
 */

/** Base SVG builder for the standard 16×16 viewBox icon set. */
function icon(viewBox: string, paths: string[], size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</svg>`;
}

export type IconName =
  | "file"
  | "folder-closed"
  | "doc"
  | "chevron-right"
  | "chevron-down"
  | "chevron-up"
  | "grid"
  | "play"
  | "terminal"
  | "plus"
  | "plus-thick"
  | "git-branch"
  | "file-added"
  | "file-deleted"
  | "file-modified"
  | "file-renamed"
  | "git-commit"
  | "eye"
  | "eye-off"
  | "git-info"
  | "projects"
  | "refresh"
  | "settings"
  | "collapse"
  | "git"
  | "check-circle"
  | "spinner"
  | "close"
  | "corner"
  | "sync"
  | "warning";

export type IconRegistry = Record<IconName, (size?: number) => string>;

export const iconRegistry: IconRegistry = {
  file: (size) =>
    icon(
      "0 0 16 16",
      [
        `<path d="M4 1H10L13 4V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V2C3 1.44772 3.44772 1 4 1Z"/>`,
        `<path d="M10 1V4H13"/>`,
      ],
      size,
    ),

  "folder-closed": (size) =>
    icon(
      "0 0 16 16",
      [
        `<path d="M2 3.5C2 2.94772 2.44772 2.5 3 2.5H6L7.5 4H13C13.5523 4 14 4.44772 14 5V12.5C14 13.0523 13.5523 13.5 13 13.5H3C2.44772 13.5 2 13.0523 2 12.5V3.5Z"/>`,
      ],
      size,
    ),

  doc: (size) =>
    icon(
      "0 0 16 16",
      [
        `<path d="M3.5 1.5H10L13.5 5V14C13.5 14.2761 13.2761 14.5 13 14.5H3.5C3.22386 14.5 3 14.2761 3 14V2C3 1.72386 3.22386 1.5 3.5 1.5Z"/>`,
        `<path d="M10 1.5V5H13.5"/>`,
        `<line x1="5" y1="8" x2="11" y2="8"/>`,
        `<line x1="5" y1="10.5" x2="11" y2="10.5"/>`,
        `<line x1="5" y1="13" x2="9" y2="13"/>`,
      ],
      size,
    ),

  "chevron-right": (size) => icon("0 0 16 16", [`<polyline points="6,4 10,8 6,12"/>`], size),

  "chevron-down": (size) => icon("0 0 16 16", [`<polyline points="4,6 8,10 12,6"/>`], size),

  "chevron-up": (size) => icon("0 0 16 16", [`<polyline points="4,10 8,6 12,10"/>`], size),

  grid: (size) =>
    icon(
      "0 0 16 16",
      [
        `<rect x="2" y="2" width="5" height="5" rx="0.5"/>`,
        `<rect x="9" y="2" width="5" height="5" rx="0.5"/>`,
        `<rect x="2" y="9" width="5" height="5" rx="0.5"/>`,
        `<rect x="9" y="9" width="5" height="5" rx="0.5"/>`,
      ],
      size,
    ),

  play: (size) =>
    icon(
      "0 0 16 16",
      [
        `<rect x="2" y="2.5" width="12" height="11" rx="2"/>`,
        `<polygon points="6,5 11,8 6,11" fill="currentColor" stroke="none"/>`,
      ],
      size,
    ),

  terminal: (size) =>
    icon(
      "0 0 16 16",
      [
        `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>`,
        `<path d="M5 6L7 8L5 10"/>`,
        `<line x1="9" y1="10" x2="11" y2="10"/>`,
      ],
      size,
    ),

  plus: (size) =>
    icon(
      "0 0 16 16",
      [`<line x1="8" y1="3" x2="8" y2="13"/>`, `<line x1="3" y1="8" x2="13" y2="8"/>`],
      size,
    ),

  "plus-thick": (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`;
  },

  "git-branch": (size) =>
    icon(
      "0 0 16 16",
      [
        `<circle cx="5" cy="3.5" r="2"/>`,
        `<circle cx="12" cy="3.5" r="2"/>`,
        `<circle cx="5" cy="12.5" r="2"/>`,
        `<path d="M5 5.5V10.5"/>`,
        `<path d="M12 5.5L5.5 9.5"/>`,
      ],
      size,
    ),

  "file-added": (size) =>
    icon(
      "0 0 16 16",
      [
        `<circle cx="8" cy="8" r="6"/>`,
        `<line x1="8" y1="5" x2="8" y2="11"/>`,
        `<line x1="5" y1="8" x2="11" y2="8"/>`,
      ],
      size,
    ),

  "file-deleted": (size) =>
    icon(
      "0 0 16 16",
      [`<circle cx="8" cy="8" r="6"/>`, `<line x1="5" y1="8" x2="11" y2="8"/>`],
      size,
    ),

  "file-modified": (size) =>
    icon(
      "0 0 16 16",
      [`<circle cx="8" cy="8" r="6"/>`, `<path d="M5.5 9.5C6.5 7.5 9.5 7.5 10.5 9.5"/>`],
      size,
    ),

  "file-renamed": (size) =>
    icon("0 0 16 16", [`<circle cx="8" cy="8" r="6"/>`, `<path d="M7 5.5L10.5 8L7 10.5"/>`], size),

  "git-commit": (size) =>
    icon(
      "0 0 16 16",
      [
        `<line x1="2" y1="8" x2="5" y2="8"/>`,
        `<circle cx="8" cy="8" r="3"/>`,
        `<line x1="11" y1="8" x2="14" y2="8"/>`,
      ],
      size,
    ),

  eye: (size) =>
    icon(
      "0 0 16 16",
      [
        `<path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"/>`,
        `<circle cx="8" cy="8" r="2.5"/>`,
      ],
      size,
    ),

  "eye-off": (size) =>
    icon(
      "0 0 16 16",
      [
        `<path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"/>`,
        `<circle cx="8" cy="8" r="2.5"/>`,
        `<line x1="2" y1="2" x2="14" y2="14"/>`,
      ],
      size,
    ),

  "git-info": (size) =>
    icon(
      "0 0 16 16",
      [
        `<circle cx="8" cy="8" r="6"/>`,
        `<line x1="8" y1="7" x2="8" y2="11"/>`,
        `<circle cx="8" cy="5.2" r="0.8" fill="currentColor" stroke="none"/>`,
      ],
      size,
    ),

  projects: (size) => {
    const s = size ?? 20;
    return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z" fill="currentColor"/>
      <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
    </svg>`;
  },

  refresh: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>`;
  },

  "check-circle": (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m424-296 282-282-56-56-226 226-114-114-56 56 170 170Zm56 216q-83 0-156-31.5T197-197q-54-54-85.5-127T80-480q0-83 31.5-156T197-763q54-54 127-85.5T480-880q83 0 156 31.5T763-763q54 54 85.5 127T880-480q0 83-31.5 156T763-197q-54 54-127 85.5T480-80Zm0-80q134 0 227-93t93-227q0-134-93-227t-227-93q-134 0-227 93t-93 227q0 134 93 227t227 93Zm0-320Z"/></svg>`;
  },

  spinner: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><style>@keyframes _s{to{transform:rotate(360deg)}}svg{animation:_s 1s linear infinite;transform-origin:center}</style><path d="M480-80q-82 0-155-31.5t-127.5-86Q143-252 111.5-325T80-480q0-83 31.5-155.5t86-127Q252-817 325-848.5T480-880q17 0 28.5 11.5T520-840q0 17-11.5 28.5T480-800q-134 0-227 93t-93 227q0 134 93 227t227 93q134 0 227-93t93-227q0-17 11.5-28.5T840-520q17 0 28.5 11.5T880-480q0 82-31.5 155t-86 127.5q-54.5 54.5-127 86T480-80Z"/></svg>`;
  },

  close: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m256-200-56-56 224-224-224-224 56-56 224 224 224-224 56 56-224 224 224 224-56 56-224-224-224 224Z"/></svg>`;
  },

  corner: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 1.5v7.5h5"/></svg>`;
  },

  sync: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M280-120 80-320l200-200 57 56-104 104h607v80H233l104 104-57 56Zm400-320-57-56 104-104H120v-80h607L623-784l57-56 200 200-200 200Z"/></svg>`;
  },

  warning: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M8 2 14.2 14H1.8L8 2Z"/><path d="M8 6.5v3.5"/><path d="M8 12.25h.01"/></svg>`;
  },

  settings: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>`;
  },

  collapse: (size) => {
    const s = size ?? 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m296-80-56-56 240-240 240 240-56 56-184-184L296-80Zm184-504L240-824l56-56 184 184 184-184 56 56-240 240Z"/></svg>`;
  },

  git: (size) => {
    const s = size ?? 24;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M352.5-325.5Q298-371 284-440H80v-80h204q14-69 68.5-114.5T480-680q73 0 127.5 45.5T676-520h204v80H676q-14 69-68.5 114.5T480-280q-73 0-127.5-45.5ZM480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z"/></svg>`;
  },
};
