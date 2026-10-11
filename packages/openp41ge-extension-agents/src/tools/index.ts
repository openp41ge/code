/**
 * tools/index.ts — the built-in agent tool set.
 *
 * Each tool exposes a `register(registry)` entry point (plugin-style); this
 * module registers them all with a single call. Shell-style command
 * execution (`run_command`) is not part of the set.
 */

import { register as registerReadFile } from "./read-file.js";
import { register as registerSearchFiles } from "./search-files.js";
import { register as registerEditFile } from "./edit-file.js";
import { register as registerWriteFile } from "./write-file.js";
import type { AgentToolRegistry } from "./types.js";

/** Register the built-in tool set into a registry. */
export function registerBuiltinTools(registry: AgentToolRegistry): void {
  registerReadFile(registry);
  registerSearchFiles(registry);
  registerEditFile(registry);
  registerWriteFile(registry);
}
