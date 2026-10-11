/**
 * Tool interfaces — the agent tool contract.
 *
 * The canonical type definitions live in `../tools/types.ts`, shared with
 * the tools themselves; this module re-exports them for the runtime.
 */

export type {
  ToolParameters,
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
  AgentTool,
  AgentToolRegistry,
} from "../tools/types.js";
