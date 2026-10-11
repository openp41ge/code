/**
 * workspace-schema.ts — the **editable** manifest schema of a
 * `.openp41ge-workspace` file.
 *
 * This is the set of fields a user is allowed to change. Both the editor's UI
 * form and its JSON view surface exactly these fields — never the platform
 * metadata (id, version, createdAt, dataDir) or session state (windows, tabs,
 * …). The platform owns those and the editor preserves them verbatim on
 * round-trip; `pickEditableFields` enforces the boundary when a change comes
 * back from either view.
 */

import type { WorkspaceFileData } from "./workspace-file.js";

/** The user-editable manifest fields. Everything else is platform-owned. */
export const WORKSPACE_EDITABLE_FIELDS = ["name", "repos"] as const;

export type WorkspaceEditableField = (typeof WORKSPACE_EDITABLE_FIELDS)[number];

/** Empty default values for each editable field — used so the JSON view shows
 *  a complete editable manifest (empty properties included). */
export const WORKSPACE_EDITABLE_DEFAULTS: Record<WorkspaceEditableField, unknown> = {
  name: "",
  repos: [],
};

/**
 * Return only the editable fields present in `data`.
 */
export function pickEditableFields(
  data: Record<string, unknown> | WorkspaceFileData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of WORKSPACE_EDITABLE_FIELDS) {
    if (field in data) out[field] = data[field];
  }
  return out;
}

/**
 * The full editable view of `data` for the JSON editor: every editable field
 * is present, using its empty default when absent, so the JSON shows the whole
 * editable schema (e.g. `name` appears as an empty string even if the file
 * never set it).
 */
export function editableView(
  data: Record<string, unknown> | WorkspaceFileData,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of WORKSPACE_EDITABLE_FIELDS) {
    out[field] = field in data ? data[field] : WORKSPACE_EDITABLE_DEFAULTS[field];
  }
  return out;
}

/**
 * Merge the editable fields of an edited value onto `baseline`, preserving
 * platform-owned fields and session state. A field the file never authored is
 * not written back when it is still at its empty default — so saving does not
 * inject brand-new empty fields into the file.
 */
export function mergeEditableFields(
  baseline: Record<string, unknown> | WorkspaceFileData,
  edited: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of WORKSPACE_EDITABLE_FIELDS) {
    if (!(field in edited)) continue;
    const value = edited[field];
    const authored = field in baseline;
    const changed = JSON.stringify(value) !== JSON.stringify(WORKSPACE_EDITABLE_DEFAULTS[field]);
    if (authored || changed) out[field] = value;
  }
  return out;
}

/** JSON Schema for the editable workspace manifest. */
export const WORKSPACE_FILE_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "openp41ge://schema/workspace-file",
  title: "Workspace",
  type: "object",
  description:
    "The user-editable portion of a `.openp41ge-workspace` manifest. Platform-owned metadata and session state are preserved by the platform and are not edited here.",
  properties: {
    name: {
      type: "string",
      description: "Human-readable workspace name shown in the manager sidebar.",
    },
    repos: {
      type: "array",
      description:
        "Repository list for the workspace. Each repo has a git URL and the checked-out worktrees.",
      items: {
        type: "object",
        properties: {
          url: { type: "string", description: "Git remote URL of the repository." },
          worktrees: {
            type: "array",
            description: "Worktree branch names checked out under this repo.",
            items: { type: "string" },
          },
        },
        required: ["url"],
      },
    },
  },
} as const;

export type WorkspaceFileSchema = typeof WORKSPACE_FILE_SCHEMA;
