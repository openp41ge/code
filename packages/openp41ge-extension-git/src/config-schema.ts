/**
 * config-schema.ts — the Git extension's config (`registerConfigSchema`):
 * the rules of the `git` binary it defines for the platform's scoped
 * terminal (`registerCommandBinaries`), at `commands.git`. A rule matches
 * git's whole argument list: words, `*` (one argument, or any characters in
 * a word), `**` (any number of arguments), `a|b` (either). A line runs when
 * an allow rule matches and no deny rule does.
 *
 * The defaults read (status, log, show, diff, blame, listing branches) and
 * sync: fetch, pull, finishing or abandoning a merge or rebase that stopped
 * on a conflict (add, commit, continue / abort / skip) and push. Other writes
 * (reset, checkout, stash, branches, starting a merge or rebase) are off;
 * options before the subcommand match no rule, and the deny rules keep
 * diff's `--output` (writes a file) and external diff programs out.
 */

import type { ConfigSchema } from "openp41ge-sdk";

/** Where git's rules are in this config. */
export const GIT_RULES_PATH = "commands.git";

const RULES = {
  type: "array",
  items: { type: "string" },
} as const;

export const GIT_CONFIG_SCHEMA: ConfigSchema = {
  type: "object",
  additionalProperties: true,
  description: "What git may run in the terminal (for you and for agents).",
  properties: {
    commands: {
      type: "object",
      title: "Terminal",
      additionalProperties: true,
      default: {
        git: {
          allow: [
            "status **",
            "log **",
            "show **",
            "diff **",
            "blame **",
            "branch --list **",
            "fetch **",
            "pull **",
            "add **",
            "commit **",
            "merge --continue|--abort",
            "rebase --continue|--abort|--skip",
            "push **",
          ],
          deny: ["** --output*", "** --ext-diff **"],
        },
      },
      properties: {
        git: {
          type: "object",
          title: "git",
          additionalProperties: false,
          description:
            "Rules over git's arguments (without `git`): words, `*` (one argument), `**` (any number), `a|b` (either). A command runs when an **allow** rule matches and no **deny** rule does.",
          properties: {
            allow: { ...RULES, title: "Allow", description: "e.g. `log **`, `show|diff **`." },
            deny: { ...RULES, title: "Deny", description: "Wins over allow, e.g. `** --output*`." },
          },
        },
      },
    },
  },
};
