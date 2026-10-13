/**
 * required-migrations.ts — the data migrations this version of the app
 * needs applied before it reads any data: every set in the repo's
 * `migrations/` folder when it was built (a test keeps the two in step —
 * add a new set's id here). Only the ids ship; the sets are downloaded.
 */
export const REQUIRED_MIGRATIONS: readonly string[] = [
  "2026-10-09-chat-threads-per-workspace",
  "2026-10-10-repositories-per-workspace",
  "2026-10-10-agents-chat-threads",
  "2026-10-13-git-history-search",
];
