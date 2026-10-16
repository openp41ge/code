/**
 * search-provider.ts — what the git extension offers the open palette
 * (Cmd+N): the workspace's repositories and their worktrees (the Repository
 * tab opens them), and, when the query looks like a commit hash, the commit
 * it names in each cloned repository (the Commit tab opens it).
 */

import type { SearchItem, SearchOpenItem, SearchProvider } from "openp41ge-sdk";

/** The open kinds (`registerOpenKinds` in the renderer entry). */
export const REPOSITORY_OPEN_KIND = "openp41ge-extension-git/repository";
export const COMMIT_OPEN_KIND = "openp41ge-extension-git/commit";

const HASH = /^[0-9a-f]{7,40}$/i;

/** `query`'s letters appear in `text` in order (ignoring case). */
function hasInOrder(query: string, text: string): boolean {
  const t = text.toLowerCase();
  let i = 0;
  for (const ch of query.toLowerCase()) {
    i = t.indexOf(ch, i);
    if (i < 0) return false;
    i++;
  }
  return true;
}

const shortName = (repoName: string) => repoName.split("/").pop() ?? repoName;

export const gitSearchProvider: SearchProvider = {
  id: "repositories",
  async search(query, ctx) {
    const repos = (await ctx.workspace?.repositories()) ?? [];
    const q = query.trim();
    const items: SearchItem[] = [];
    for (const repo of repos) {
      const name = shortName(repo.repoName);
      const offer = (branch?: string) => {
        if (q && !hasInOrder(q, branch ? `${repo.repoName} ${branch}` : repo.repoName)) return;
        items.push({
          kind: REPOSITORY_OPEN_KIND,
          params: branch ? { repoName: repo.repoName, branch } : { repoName: repo.repoName },
          title: branch ? `${name} · ${branch}` : name,
          description: repo.repoName,
        });
      };
      offer();
      for (const wt of repo.worktrees) offer(wt.branch);
    }
    if (HASH.test(q)) {
      const commits = await Promise.all(
        repos
          .filter((r) => r.cloned)
          .map(async (repo): Promise<SearchOpenItem | null> => {
            const result = await ctx.git({
              repo: repo.repoName,
              args: ["log", "-1", "--format=%H%x1f%h%x1f%s", `${q}^{commit}`, "--"],
            });
            if (!result.ok) return null;
            const [hash, shortHash, subject] = result.stdout.trim().split("\x1f");
            if (!hash || !shortHash) return null;
            return {
              kind: COMMIT_OPEN_KIND,
              params: { repoName: repo.repoName, hash, shortHash },
              title: subject || shortHash,
              description: `${shortHash} · ${repo.repoName}`,
              key: `${repo.repoName}@${hash}`,
            };
          }),
      );
      items.unshift(...commits.filter((c): c is SearchOpenItem => c !== null));
    }
    return items;
  },
};
