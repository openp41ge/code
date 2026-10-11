import type { RepositoryModel, GitCloneSessionModel } from "./repository-model.js";

/**
 * RepoService is the top-level resolver for repository models.
 *
 * The tree component depends on this single interface for all data access.
 * In production, the implementation is IpcRepoService (calls via window.openp41ge).
 * In tests, it's TestRepoService (pure in-memory state).
 */
export interface RepoService {
  /** List all repositories. */
  listRepos(): Promise<RepositoryModel[]>;

  /** Get a single repository by name. Returns null if not found. */
  getRepo(name: string): Promise<RepositoryModel | null>;

  /** Clone a repository from URL. Returns a session with progress events. */
  clone(url: string): GitCloneSessionModel;

  /** Add an existing repository by path (or name + url). */
  addRepo(path: string, name?: string): Promise<RepositoryModel>;

  /** Remove a repository from the explorer (does not delete files). */
  removeRepo(name: string): Promise<void>;
}
