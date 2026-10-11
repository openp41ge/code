/**
 * repo-name.ts — the workspace name of a repository, derived from its clone
 * URL. The name identifies the repo everywhere (the open workspace, the
 * platform's git actions, `context.workspaceRepos`, extensions) and is its
 * folder under the repositories directory. The SSH and HTTPS URLs of one
 * repo share a name, so a workspace holds each repo once.
 *
 *   git@github.com:acme/app.git            → github.com/acme/app
 *   deploy@git.example.com:team/app.git    → git.example.com/team/app
 *   https://gitlab.com/org/team/proj.git   → gitlab.com/org/team/proj
 *
 * The output is stable on purpose: existing clones live at these paths.
 */
export function deriveRepoName(url: string): string {
  const cleaned = url
    .replace(/^https?:\/\//, "")
    // The user (git@, deploy@, https://alice@) is not part of the repo.
    .replace(/^[^@/:]+@/, "")
    .replace(/\.git$/, "");
  const parts = cleaned.split(/[/:]/);
  // A bare name (no host separator) is kept as-is, not turned into "name/name".
  if (parts.length === 1) return cleaned;
  const provider = parts[0];
  const repoName = parts[parts.length - 1];
  const orgPath = parts.slice(1, -1).join("/");
  return orgPath ? `${provider}/${orgPath}/${repoName}` : `${provider}/${repoName}`;
}

/** SSH (scp-like): `<user>@<host>:<path>`, e.g. `git@github.com:acme/app.git`. */
const SSH_URL = /^[\w.-]+@[\w.-]+:[^\s/][^\s]*$/;
/** HTTPS: `https://[<user>@]<host>[:<port>]/<path>`. */
const HTTPS_URL = /^https:\/\/(?:[^\s@/]+@)?[\w.-]+(?::\d+)?\/[^\s/][^\s]*$/;

/**
 * Check that `url` is a full clone URL: `git@<host>:<path>`,
 * `<user>@<host>:<path>` or `https://<host>/<path>`. Returns null when it is,
 * otherwise a message for the user. Surrounding whitespace is ignored.
 */
export function validateRepoUrl(url: string): string | null {
  const value = url.trim();
  if (SSH_URL.test(value) || HTTPS_URL.test(value)) return null;
  // A common slip: `git@host/org/repo` (slash) for `git@host:org/repo`.
  const slashed = /^([\w.-]+@[\w.-]+)\/([^\s/][^\s]*)$/.exec(value);
  if (slashed) {
    return `SSH URLs need a colon after the host: ${slashed[1]}:${slashed[2]}`;
  }
  return (
    "Enter the full clone URL, e.g. git@github.com:org/repo.git, " +
    "user@host:org/repo.git or https://github.com/org/repo"
  );
}
