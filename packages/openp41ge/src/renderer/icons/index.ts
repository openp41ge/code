/**
 * Openp41ge SVG icon set — flat line icons rendered as inline SVGs.
 *
 * All icons use currentColor so they inherit the parent text colour.
 * Dimensions are 16x16 viewBox by default; use the `size` parameter to scale.
 */

function icon(viewBox: string, paths: string[], size = 16): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${paths.join("")}</svg>`;
}

/** File icon — document with folded corner */
export function fileIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<path d="M4 1H10L13 4V14C13 14.5523 12.5523 15 12 15H4C3.44772 15 3 14.5523 3 14V2C3 1.44772 3.44772 1 4 1Z"/>`,
      `<path d="M10 1V4H13"/>`,
    ],
    size,
  );
}

/** Folder-closed icon — closed folder */
export function folderClosedIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<path d="M2 3.5C2 2.94772 2.44772 2.5 3 2.5H6L7.5 4H13C13.5523 4 14 4.44772 14 5V12.5C14 13.0523 13.5523 13.5 13 13.5H3C2.44772 13.5 2 13.0523 2 12.5V3.5Z"/>`,
    ],
    size,
  );
}

/** Document with lines — for markdown / text files */
export function docIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<path d="M3.5 1.5H10L13.5 5V14C13.5 14.2761 13.2761 14.5 13 14.5H3.5C3.22386 14.5 3 14.2761 3 14V2C3 1.72386 3.22386 1.5 3.5 1.5Z"/>`,
      `<path d="M10 1.5V5H13.5"/>`,
      `<line x1="5" y1="8" x2="11" y2="8"/>`,
      `<line x1="5" y1="10.5" x2="11" y2="10.5"/>`,
      `<line x1="5" y1="13" x2="9" y2="13"/>`,
    ],
    size,
  );
}

/** Chevron right — for collapsed folders / context menu */
export function chevronRight(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z"/></svg>`;
}

/** Chevron down — for expanded folders */
export function chevronDown(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M504-480 320-664l56-56 240 240-240 240-56-56 184-184Z" transform="rotate(90 480 -480)"/></svg>`;
}

/** Grid / table icon */
export function gridIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<rect x="2" y="2" width="5" height="5" rx="0.5"/>`,
      `<rect x="9" y="2" width="5" height="5" rx="0.5"/>`,
      `<rect x="2" y="9" width="5" height="5" rx="0.5"/>`,
      `<rect x="9" y="9" width="5" height="5" rx="0.5"/>`,
    ],
    size,
  );
}

/** Terminal icon */
export function terminalIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/>`,
      `<path d="M5 6L7 8L5 10"/>`,
      `<line x1="9" y1="10" x2="11" y2="10"/>`,
    ],
    size,
  );
}

/** Plus icon — for add actions */
export function plusIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [`<line x1="8" y1="3" x2="8" y2="13"/>`, `<line x1="3" y1="8" x2="13" y2="8"/>`],
    size,
  );
}

/** Thick plus icon — heavier stroke for the add-repository button */
export function plusIconThick(size?: number): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="${size ?? 16}" height="${size ?? 16}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="3" x2="8" y2="13"/><line x1="3" y1="8" x2="13" y2="8"/></svg>`;
}

/** Check / confirm icon */
export function checkIcon(size?: number): string {
  return icon("0 0 16 16", [`<path d="M3 8.5L6.5 12L13 4.5"/>`], size);
}

/** Close / cancel (cross) icon */
export function closeIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<line x1="3.5" y1="3.5" x2="12.5" y2="12.5"/>`,
      `<line x1="12.5" y1="3.5" x2="3.5" y2="12.5"/>`,
    ],
    size,
  );
}

/** Git branch icon — for worktree rows */
export function gitBranchIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<circle cx="5" cy="3.5" r="2"/>`,
      `<circle cx="12" cy="3.5" r="2"/>`,
      `<circle cx="5" cy="12.5" r="2"/>`,
      `<path d="M5 5.5V10.5"/>`,
      `<path d="M12 5.5L5.5 9.5"/>`,
    ],
    size,
  );
}

/** File added icon — green plus */
export function fileAddedIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<circle cx="8" cy="8" r="6"/>`,
      `<line x1="8" y1="5" x2="8" y2="11"/>`,
      `<line x1="5" y1="8" x2="11" y2="8"/>`,
    ],
    size,
  );
}

/** File deleted icon — red minus */
export function fileDeletedIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [`<circle cx="8" cy="8" r="6"/>`, `<line x1="5" y1="8" x2="11" y2="8"/>`],
    size,
  );
}

/** File modified icon — amber tilde */
export function fileModifiedIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [`<circle cx="8" cy="8" r="6"/>`, `<path d="M5.5 9.5C6.5 7.5 9.5 7.5 10.5 9.5"/>`],
    size,
  );
}

/** File renamed icon — blue arrow */
export function fileRenamedIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [`<circle cx="8" cy="8" r="6"/>`, `<path d="M7 5.5L10.5 8L7 10.5"/>`],
    size,
  );
}

/** Git commit icon — circle with connecting horizontal lines */
export function gitCommitIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<line x1="2" y1="8" x2="5" y2="8"/>`,
      `<circle cx="8" cy="8" r="3"/>`,
      `<line x1="11" y1="8" x2="14" y2="8"/>`,
    ],
    size,
  );
}

/** Eye icon — visible toggle */
export function eyeIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"/>`,
      `<circle cx="8" cy="8" r="2.5"/>`,
    ],
    size,
  );
}

/** Eye-off icon — hidden toggle */
export function eyeOffIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<path d="M1 8C1 8 3.5 3 8 3C12.5 3 15 8 15 8C15 8 12.5 13 8 13C3.5 13 1 8 1 8Z"/>`,
      `<circle cx="8" cy="8" r="2.5"/>`,
      `<line x1="2" y1="2" x2="14" y2="14"/>`,
    ],
    size,
  );
}

/** Git info icon — small "i" in a circle, for the git info button */
export function gitInfoIcon(size?: number): string {
  return icon(
    "0 0 16 16",
    [
      `<circle cx="8" cy="8" r="6"/>`,
      `<line x1="8" y1="7" x2="8" y2="11"/>`,
      `<circle cx="8" cy="5.2" r="0.8" fill="currentColor" stroke="none"/>`,
    ],
    size,
  );
}

/** Projects icon — stacked folders (activity bar) */
export function projectsIcon(size?: number): string {
  const s = size ?? 20;
  return `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M4 6H2v14c0 1.1.9 2 2 2h14v-2H4V6z" fill="currentColor"/>
    <path d="M20 2H8c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z" fill="currentColor"/>
  </svg>`;
}

/** Refresh icon — circular arrow with fill */
export function refreshIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M480-160q-134 0-227-93t-93-227q0-134 93-227t227-93q69 0 132 28.5T720-690v-110h80v280H520v-80h168q-32-56-87.5-88T480-720q-100 0-170 70t-70 170q0 100 70 170t170 70q77 0 139-44t87-116h84q-28 106-114 173t-196 67Z"/></svg>`;
}

/** Git icon — branching/forking commit history (activity bar) */
export function gitIcon(size?: number): string {
  const s = size ?? 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M352.5-325.5Q298-371 284-440H80v-80h204q14-69 68.5-114.5T480-680q73 0 127.5 45.5T676-520h204v80H676q-14 69-68.5 114.5T480-280q-73 0-127.5-45.5ZM480-360q50 0 85-35t35-85q0-50-35-85t-85-35q-50 0-85 35t-35 85q0 50 35 85t85 35Z"/></svg>`;
}

/** Git worktree icon (Material) — a branch/merge glyph for worktree rows.
 * The descriptor icon for worktree rows and the "+ add worktree" row in the
 * Explorer's uniform [action icon][description icon]<name> layout. */
export function worktreeIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M543.5-63.5Q520-87 520-120q0-23 11-41t29-29v-221q-18-11-29-28.5T520-480q0-33 23.5-56.5T600-560q33 0 56.5 23.5T680-480q0 23-11 40.5T640-411v115l160-53v-62q-18-11-29-28.5T760-480q0-33 23.5-56.5T840-560q33 0 56.5 23.5T920-480q0 23-11 40.5T880-411v119l-240 80v22q18 11 29 29t11 41q0 33-23.5 56.5T600-40q-33 0-56.5-23.5ZM160-160v-560 560Zm0 0q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640H447l-80-80H160v480h280v80H160Z"/></svg>`;
}

/** Git repository icon (Material) — a repo/fork glyph for repo rows.
 * The descriptor icon for repo rows and the "+ add repository" row in the
 * Explorer's uniform [action icon][description icon]<name> layout. */
export function repoIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M160-240v-480 520-40Zm0 80q-33 0-56.5-23.5T80-240v-480q0-33 23.5-56.5T160-800h240l80 80h320q33 0 56.5 23.5T880-640v200h-80v-200H447l-80-80H160v480h200v80H160ZM584-56 440-200l144-144 56 57-87 87 87 87-56 57Zm192 0-56-57 87-87-87-87 56-57 144 144L776-56Z"/></svg>`;
}

/** Collapse-all icon (Material) — chevrons pointing inward/up-down, for the
 * Explorer bottom-bar "collapse all rows" button. Uses currentColor so the
 * button's colour controls the icon like the other bar buttons. */
export function collapseAllIcon(size?: number): string {
  const s = size ?? 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m296-80-56-56 240-240 240 240-56 56-184-184L296-80Zm184-504L240-824l56-56 184 184 184-184 56 56-240 240Z"/></svg>`;
}

/** Settings gear icon (Material) — for sidebar bottom-bar settings buttons.
 * Uses currentColor so the button's colour controls the icon (grey off,
 * white on hover / when the settings grid tab is open). */
export function settingsIcon(size?: number): string {
  const s = size ?? 24;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="m370-80-16-128q-13-5-24.5-12T307-235l-119 50L78-375l103-78q-1-7-1-13.5v-27q0-6.5 1-13.5L78-585l110-190 119 50q11-8 23-15t24-12l16-128h220l16 128q13 5 24.5 12t22.5 15l119-50 110 190-103 78q1 7 1 13.5v27q0 6.5-2 13.5l103 78-110 190-118-50q-11 8-23 15t-24 12L590-80H370Zm70-80h79l14-106q31-8 57.5-23.5T639-327l99 41 39-68-86-65q5-14 7-29.5t2-31.5q0-16-2-31.5t-7-29.5l86-65-39-68-99 42q-22-23-48.5-38.5T533-694l-13-106h-79l-14 106q-31 8-57.5 23.5T321-633l-99-41-39 68 86 64q-5 15-7 30t-2 32q0 16 2 31t7 30l-86 65 39 68 99-42q22 23 48.5 38.5T427-266l13 106Zm42-180q58 0 99-41t41-99q0-58-41-99t-99-41q-59 0-99.5 41T342-480q0 58 40.5 99t99.5 41Zm-2-140Z"/></svg>`;
}

/** Lock-open (unlocked) icon (Material) — the slider unlock toggle. Uses
 * currentColor so the button's colour controls the icon. */
export function lockOpenIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M240-640h360v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85h-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640Zm0 480h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM240-160v-400 400Z"/></svg>`;
}

/** Lock-closed (locked) icon (Material) — the slider lock toggle. Uses
 * currentColor so the button's colour controls the icon. */
export function lockClosedIcon(size?: number): string {
  const s = size ?? 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -960 960 960" width="${s}" height="${s}" fill="currentColor"><path d="M240-80q-33 0-56.5-23.5T160-160v-400q0-33 23.5-56.5T240-640h40v-80q0-83 58.5-141.5T480-920q83 0 141.5 58.5T680-720v80h40q33 0 56.5 23.5T800-560v400q0 33-23.5 56.5T720-80H240Zm0-80h480v-400H240v400Zm296.5-143.5Q560-327 560-360t-23.5-56.5Q513-440 480-440t-56.5 23.5Q400-393 400-360t23.5 56.5Q447-280 480-280t56.5-23.5ZM360-640h240v-80q0-50-35-85t-85-35q-50 0-85 35t-35 85v80ZM240-160v-400 400Z"/></svg>`;
}
