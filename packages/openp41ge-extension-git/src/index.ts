/**
 * index.ts — the Git extension **backend** entry (main process).
 *
 * `api: "0.2"` renderer-driven. Registers the extension's git queries
 * (`./backend.ts`: commit log, branches, diffs, commit search, …); their git
 * runs through the platform's `ctx.git`, in a repository of the calling
 * window's workspace. Platform git — cloning and worktree creation — is
 * reached from the renderer through `host.workspace`. Its palette search
 * provider (`./search-provider.ts`) offers repositories, worktrees and
 * commits. It defines the `git` binary for the platform's scoped terminal,
 * with its rules in this extension's config (`./config-schema.ts`).
 */

import {
  registerCommandBinaries,
  registerConfigSchema,
  registerProcesses,
  registerSearchProvider,
} from "openp41ge-sdk";
import { GIT_COMMANDS } from "./backend.js";
import { GIT_CONFIG_SCHEMA, GIT_RULES_PATH } from "./config-schema.js";
import { gitSearchProvider } from "./search-provider.js";

registerProcesses(GIT_COMMANDS);
registerSearchProvider(gitSearchProvider);
registerConfigSchema(GIT_CONFIG_SCHEMA);
registerCommandBinaries({ git: { label: "Git", config: GIT_RULES_PATH } });
