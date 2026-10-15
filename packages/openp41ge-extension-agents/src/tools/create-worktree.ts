/**
 * tools/create-worktree.ts — the `create_worktree` agent tool.
 *
 * Checks out a branch of a connected repository as a worktree, through the
 * platform (the context's `addWorktree`), so the agent can work in a
 * repository that has no worktree yet, or on another branch. The worktree is
 * added to the workspace (it shows in the explorer) and is then in the file
 * tools' scope. Errors are reported in-band.
 */

import type { AgentTool, AgentToolRegistry, ToolExecutionContext } from "./types.js";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

const tool: AgentTool = {
  name: "create_worktree",
  description:
    "Check out a branch of a connected repository as a new worktree, so the file tools can " +
    "use it. Use it for a repository with no worktree checked out, or to work on another " +
    "branch. The branch may be an existing local or remote branch; any other name is " +
    "created from the repository's HEAD. Returns the worktree path.",
  parameters: {
    type: "object",
    properties: {
      repo: {
        type: "string",
        description:
          "The repository, as in the connected-repositories list (e.g. github.com/org/repo).",
      },
      branch: { type: "string", description: "The branch to check out." },
    },
    required: ["repo", "branch"],
    additionalProperties: false,
  },
  async execute(args: Record<string, unknown>, ctx: ToolExecutionContext) {
    const repo = text(args.repo);
    const branch = text(args.branch);
    if (!repo || !branch) {
      return { content: "", error: "create_worktree: a repo and branch are required" };
    }
    if (!ctx.addWorktree) {
      return { content: "", error: "create_worktree: no workspace to check out in" };
    }
    const added = await ctx.addWorktree(repo, branch);
    if (!added.ok) {
      return { content: "", error: `create_worktree: ${added.error ?? "the checkout failed"}` };
    }
    return { content: `Checked out ${branch} of ${repo} at ${added.path}.` };
  },
};

export function register(registry: AgentToolRegistry): void {
  registry.register(tool);
}

export default tool;
