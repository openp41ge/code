# README Redesign Plan — openp41ge/code

Status: agreed work, not yet done
This is a working plan for contributors/agents. It is **not** the README.

## Goal

Rewrite this repo's `README.md` so it reads as a **project-overview** document
rather than developer onboarding. It should:

1. say **what this repo is** (the openp41ge **code editor** desktop app);
2. place it **within the openp41ge project** and name its **relationship to the sibling repos**;
3. **point elsewhere** for any developer onboarding — it must not contain build/setup/layout details.

## README rules

- Lead with the project and this repo's role in it.
- Include a **Relationship to other repos** section.
- **No developer onboarding**: no tech-stack lists as setup, no `pnpm`/`nx` commands, no project-structure/
  layout sections, no commands table. At most, link to `AGENTS.md` or another doc.
- Keep it short and durable; avoid details that go stale.

## Shared README skeleton (used across all openp41ge repos)

1. **Project intro** — what openp41ge is (one or two paragraphs).
2. **This repo** — what it is and does, in project terms.
3. **Relationship to other repos** — the project map and how siblings interact.
4. **Repo-specific notes** — still project-level, not onboarding.
5. **Developing / docs** — a single line pointing to the doc(s) with build/setup/test details.

## Relationship to other repos (shared content)

- `openp41ge/code` (this repo) — the openp41ge **code editor** desktop app (Electron).
- `openp41ge/browser` — the openp41ge companion web browser (CEF). The browser and the app are
  **separate programs** that talk over a defined, versioned link; the app can pin webpage elements
  into its panes. (Do **not** refer to the app as `openp41ge/app`.)
- `openp41ge/code-tests` — **private** tests repo for this app. CI here dispatches to code-tests,
  which posts a `code-tests` commit status back to this repo.
- `openp41ge/web` — the openp41ge backend services (authentication, portal/relay, content, mongo).

## Naming corrections

- **Standardise** on `openp41ge/code` for the Electron app; remove any `openp41ge/app` references.
- This app is a **code editor**. The current README (and `AGENTS.md`) describes it as a
  "desktop pane manager"; that description is wrong and must be corrected to a **code editor**
  throughout the README and its references.

## This repo's specific plan (code)

- Correct the product description from "desktop pane manager" to the openp41ge **code editor** desktop app.
- Remove the "Tech Stack", "Prerequisites", "Getting Started", "Useful Commands", and "Project Structure"
  onboarding sections; replace them with pointers to `AGENTS.md` (design) and any docs/`SETUP` file.
- Keep/reframe the core idea at a project level (organises editing, terminals, git, AI chat), but do not
  inline architecture or build steps.
- Add the **Relationship to other repos** section and the project intro.

## Steps / checklist

- [ ] Rewrite `README.md` to the shared skeleton.
- [ ] Remove tech-stack, prerequisites, getting-started, commands, and project-structure details; keep pointers.
- [ ] **Correct the description to "code editor"** wherever it currently says "desktop pane manager".
- [ ] Add the **Relationship to other repos** section using shared content above.
- [ ] Correct naming to `openp41ge/code`; drop `openp41ge/app`.
- [ ] Move developer onboarding to a linked doc (`AGENTS.md` / docs), not inlined.

## What NOT to do

- Do not embed build/install/run commands, the package tree, or the Nx/pnpm/lit stack description in the README.
- Do not inline the design plan; link to `AGENTS.md`.
- Do not rename the repo, its packages, or directories — only the README content and references.
