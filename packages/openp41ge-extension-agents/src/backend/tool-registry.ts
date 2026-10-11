/**
 * ToolRegistry — keyed registry of agent tools.
 *
 * New tools register via `registerTool(...)` (Open/Closed): adding a tool never
 * requires editing existing code. The AgentRuntime resolves the tools to send to
 * a provider and executes them by name through this registry.
 */

import type { AgentTool, ToolDefinition, ToolExecutionContext } from "./tool.js";

export class ToolRegistry {
  private readonly _tools = new Map<string, AgentTool>();

  register(tool: AgentTool): void {
    this._tools.set(tool.name, tool);
  }

  get(name: string): AgentTool | undefined {
    return this._tools.get(name);
  }

  has(name: string): boolean {
    return this._tools.has(name);
  }

  list(): AgentTool[] {
    return Array.from(this._tools.values());
  }

  /** Definitions for the provider (all registered tools). */
  definitions(): ToolDefinition[] {
    return this.list().map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  /** Execute a tool by name, reporting errors in-band (never throws). */
  async execute(name: string, args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const tool = this._tools.get(name);
    if (!tool) {
      return { content: `Unknown tool: ${name}`, error: `Unknown tool: ${name}` };
    }
    if (tool.isAvailable && !tool.isAvailable(ctx)) {
      return { content: `Tool ${name} is unavailable`, error: `Tool ${name} is unavailable` };
    }
    try {
      return await tool.execute(args, ctx);
    } catch (err) {
      return { content: (err as Error).message, error: (err as Error).message };
    }
  }
}
