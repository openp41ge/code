---
name: commit
description: Always use to commit work. Reviews unstaged changes, groups them logically, commits with descriptive messages and structured git notes.
---

# Commit

Reviews the current working tree, groups changes into logical commits, and commits them in sequence with descriptive messages.

## Usage

Run this skill from the project root:

```bash
cd /path/to/project
```

The skill will:

1. Run `git status` and `git diff --stat` to review all changes
2. Analyze the files and group them into logical commits (e.g., "new component", "refactor", "bug fix", "icon system")
3. Show you the plan
4. Stage and commit each group with an appropriate message
5. Report the result

## Instructions for the Agent

1. Start by running `git status --short` and `git diff --stat` in the project root to see what's changed
2. Read the diff of each changed file (`git diff <file>`) to understand the scope
3. Group changes into logical commits:
   - New files vs modifications
   - Related features/components together
   - Separate concerns (e.g., don't mix icon system changes with tab bar shadow changes)
4. For each group, present the plan to the user before executing
5. Stage with `git add <file1> <file2> ...` and commit with `git commit -m "<message>"`
6. Commit messages should follow conventional format:
   - `feat: add X` for new features
   - `fix: correct X` for bug fixes
   - `refactor: extract X into reusable component` for restructuring
   - `style: update X styling` for visual changes
   - `chore: add X` for tooling/misc
7. After all commits, run `git log --oneline -5` to show what was done
