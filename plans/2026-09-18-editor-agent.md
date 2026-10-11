2026-09-18

> **STATUS: PARKED.** This plan describes a future, multi-agent architecture (a
> subordinate editor agent + snapshot-based reconciliation). It is **on hold** and is
> **NOT the current work item**. The current scope (v1) is: implement `edit_file` and
> `create_or_replace_file` as **single-agent, multi-repo** tools — see
> `2026-09-18-tool-edit-and-replace-v1.md`. This document remains as the target
> architecture to revisit later.

# Editor Agent — a single subordinate write authority for agent file edits

## Goal

Introduce an **editor agent**: one small local model (1 model, 1 server) that is the
**only** thing allowed to write files on behalf of chat agents. Big/remote chat agents
never touch the filesystem or git — they request changes through a dedicated **tool
call**, and the editor agent applies (or reconciles) them. The editor agent is a
**subordinate** to the chat agents, not a peer of the chat: it's reached via a specific
tool, always in response to a request.

This is the convergent answer to "how do 100s of agents edit the same files without
corrupting each other, in a single shared branch, without relying on the AI to
reliably commit/merge." The editor agent sits on top of mechanical git enforcement.

## Rationale / Current State

- We want one **shared branch** (e.g. `master`/`main`) as the testable working state —
  the user tests one place, not N worktrees one by one.
- We do **not** want per-agent worktree isolation as the _primary_ model, because that
  makes the agent responsible for commit + merge + branch — exactly the step agentic
  systems skip. The editor agent removes that: **no agent ever runs git.**
- Today, `read_file` / `search_files` / `run_command` exist as chat tools
  (`openp41ge-agents-tool-*`), registered into a `ToolRegistry` in the main process and
  executed via `node-tool-executor.ts`. `/` want file mutation to be the same kind of
  thing, but routed through the editor agent.
- Scope enforcement already exists: tools receive `ToolExecutionContext` with
  `cwd` and `roots` (the connected worktrees); `read_file` rejects paths outside roots.
- Two agent tools will be added: an `edit_file` tool and a `create_or_replace_file`
  tool. Both are delegated to the editor agent.

### Design principle: the AI decides, git enforces

The editor agent is an LLM and therefore fallible. The safety story is **two layers**:

- **Decision layer (editor agent, AI):** reads the request, understands the file,
  decides apply / reject / reconcile / explain. It can verify the edit is coherent
  against the _actual_ file content the requester may not have fully seen.
- **Enforcement layer (git, not AI):** snapshot verification, 3-way merge, patch
  generation, `git apply`, change journal, commit. The editor agent **cannot** write
  outside these rails — its apply goes through the same primitive every edit uses.

Without the enforcement layer, this is just an AI that can corrupt files. With it, we
get semantic reconciliation without losing the mechanical safety.

## Key decisions (settled in discussion)

1. **One global editor agent, NOT bundled.** Not one per worktree, and crucially it is
   **not shipped inside the app bundle** — it's a separate, optionally-installed
   component the app downloads on demand. The server holds all worktrees; each worktree
   is a separate _workstream_ to the same model + server. One model, one server, one
   write authority.
2. **Small open-weight model.** Because it only "acts and reconciles" (no deep
   long-range reasoning, small per-request context), start from an open-weight model
   and fine-tune later. **Open question:** is a ~1B-param base sufficient? (See Open
   Questions.)
3. **Single message / response to the big agent.** The big agent makes one request and
   gets one result. No multi-turn dialogue. If the file was edited by others, the editor
   agent says so in its response — the big agent then re-reads / re-requests as it sees
   fit. Important behavior: the response must **explicitly call out when the file has
   changed since the requester read it**, so the requester knows the result may differ
   from what it expected.
4. **No extra validation gate yet** (no auto typecheck/lint before landing). Keep the
   editor agent's job narrow for now; add validation later if needed.
5. **Tools stay working-tree-only**, never touch the index implicitly (no auto
   `git add`, no `--index` apply). Commits are an explicit, coordinated action by the
   editor agent, not a side effect of editing.
6. **Snapshot ID = git blob hash** of the working-tree content (content-addressed).
   No version ledger / numeric snapshot-age tracking. Same content → same ID forever.
   It answers "did I edit what I read?" unambiguously, across repos and worktrees.

## Approach

### 1. Snapshot model

- `read_file` (and any tool returning file content) also returns the file's blob hash
  (`git hash-object <path>`, **no** `-w`) as the snapshot ID.
- The snapshot is computed from the **working-tree** bytes at the path — never from the
  index or HEAD — so it always matches what the requester actually saw.
- Absent file (create case) is a distinct sentinel from an empty file (hash
  `e69de29…`).
- Contract change: `ToolExecutionResult` gains an **optional `snapshot?: string`**
  field (backward-compatible), rather than smuggling the hash into `content`.

### 2. Editor agent request/protocol

A chat agent requests a change via a dedicated tool call. The tool forwards the request
to the editor agent (main process). Editor agent input (per request):

```
{
  repo / worktree:   resolved from the file path against ctx.roots
  path:              the target file (exactly one connected root must contain it)
  snapshot:          blob hash the requester read (or "absent")
  mode:              edit | create | replace
  edits:             for edit — [{ old, new }]  (content-addressed, NOT line/column)
  patch:             the git patch the big agent intends to apply (when it has one)
  content:           for create/replace — the full new content
  reason:            the big agent's description of WHAT it is doing and WHY
}
```

- **Edits are `{ old, new }` text substitutions, not line/column numbers.** Line/column
  numbers go stale; content matching is immune to them(w and lets a shifted file be
  re-matched).
- **`reason` is mandatory-ish and load-bearing.** The big agent must describe what it is
  changing and why. This text is what lets the smaller model reconcile: it reads
  `reason` (intent) + the `patch`/`edits` (mechanics) + the file contents + recent
  changes, and can tell whether the request is coherent and how it interacts with what
  other agents already did.
- The editor agent resolves the single repo + worktree for the path and runs all git
  with `-C <root>`.

### Editor agent context (what the smaller model sees)

The smaller agent's per-request context is deliberately only as large as needed, but it
must include:

1. **The request itself** — `reason`, `edits`/`patch`, `content`, `snapshot`;
2. **The target file's current content** (or the relevant region if the file is large);
3. **Recent changes to that file/repo** — the tail of the change journal and/or recent
   `git log`/diffs for the path, so it knows what other agents have touched and why;
4. **The snapshot the requester read** vs the current hash, so it knows when the request
   is stale;
5. **(Optional, later)** a note of any concurrent in-flight request on the same file.

Because the intent (“what and why”) travels with the mechanical change (patch) and the
file contents (already in context), the small model has enough to reason about whether
and how to reconcile — it doesn't need world knowledge, just the local situation.

### 3. Enforcement layer (mechanical, per op)

**`edit_file` (surgical → merge-tolerant):**

1. Verify `snapshot` == current blob hash of the on-disk file. Mismatch → the editor
   agent re-reads, reconciles, and (as directed) explains rather than blindly applying.
2. Build `ours` = snapshot content with all `{old,new}` substitutions applied.
3. 3-way merge against the current on-disk content:
   `git merge-file --current=<file> --base=<snapshot content> ours`.
   - Clean (edits land on disjoint lines from any concurrent change) → write merged
     result, generate a git patch, `git apply`, return new snapshot + success.
   - Overlap → do **not** write; return the changed-region diff + new snapshot so the
     requester re-plans. Never leave conflict markers in the worktree.
   - This is the **rebase-conflict reducer**: if another agent shifted the file but left
     the target lines intact, the merge succeeds even though line numbers moved.

**`create_or_replace_file` (full rewrite → strict):**

- `create`: file absent → generate a new-file patch → `git apply`.
- `replace`: file present → **hard-reject unless `snapshot` == current hash**, message
  like "file has changed since last read (got <hash>, expected <hash>)". No fuzzy
  fallback for a full rewrite, because a rewrite clobbers 100% of the file.

**Commit policy:** the editor agent commits landed changes to the shared branch
(per-delta or batched, authored by the requesting agent). The target branch is
configured in a **repo settings file**. Big agents never commit/merge/push.

**Change journal:** every applied delta is logged (`agent, path, snapshot→result,
patch`) so any single contribution can be surgically reverted (inverse patch) and
audited. This is what makes a shared branch safe: last-writer-wins collisions are never
silently dropped — the loser is recorded and recoverable.

### 4. Concurrency model

Primary model is the **shared single branch**, with the editor agent as the **sole
writer and sole committer**. Per-file serialization happens in the single-threaded main
process (no yield between check-and-apply), so read-modify-write races vanish; different
files still proceed in parallelarenastone. Worktree-per-agent isolation is NOT the
default (see Scope) — the editor agent's per-file serialization + 3-way merge is the
concurrency control.

**Recommended additional lever (not yet committed):** partition work at the dispatch
layer so agents own disjoint files/modules — the best same-file conflict is the one never
produced. Residual collisions are handled by the editor agent (reconcile/explain) and
the journal.

### 5. Editor agent packaging & lifecycle (NOT in the app bundle)

The editor agent is a **separate, separately-downloaded component** — not part of the
Electron app bundle. Rationale:

- **App stays slim.** Model weights (and the small serving runtime) are large and
  evolve; they shouldn't ship with the app or bloat it.
- **Swappable / fine-tunable.** Because weights are downloaded, a fine-tuned model can
  replace the base without an app release.
- **Versioned independently.** The editor agent has its own version; the app declares a
  compatible version range and refuses to use an incompatible one.

Lifecycle:

1. **Optional install.** The app checks for the editor agent at startup / on first edit
   request. If absent, `edit_file` / `create_or_replace_file` report **unavailable**
   (the existing `AgentTool.isAvailable` gate fits this) rather than failing silently.
2. **Download on demand** from a configured source (registry URL / manifest) — explicit,
   user-approvable, with integrity checks (hash) before use.
3. **Local server/subprocess.** The app spawns it as a sidecar local server (or
   subprocess) the host talks to over loopbacke — one model + one server, matching the
   "1 global agent" decision. It is not a remote service; it runs locally but is
   installed separately.
4. **Version/health check.** On each edit the host verifies the installed version is
   compatible and healthy; otherwise the edit tools are unavailable.

This keeps the editor agent out of the bundle while keeping the write authority local,
so edit latency is low and no data leaves the machine.

## Files Changed (proposed)

- `packages/openp41ge-core-agents-tool-types/src/index.ts` — add optional `snapshot?: string`
  to `ToolExecutionResult`.
- `packages/openp41ge-core-agents-tool-read-file/src/index.ts` — populate `snapshot` (blob
  hash) and (optionally) write it into the object store only if a future
  `git apply --3way` path needs it.
- `packages/openp41ge-core-agents-tool-edit-file/src/index.ts` — **new** `edit_file` tool.
- `packages/openp41ge-core-agents-tool-write-file/src/index.ts` — **new**
  `create_or_replace_file` tool.
- `packages/openp41ge/src/main/services/editor-agent.ts` — **new** editor agent: the
  single writer; request intake, reconcile logic, mechanical apply (merge/patch/journal/
  commit). (Working name; the plan may also call it a "file coordinator".)
  - **Separate download concern:** this module is the host-side _client/handshake_ (find,
    spawn, health-check, invoke the sidecar); the editor agent **runtime + weights live
    in a separate, separately-downloaded artifact**, not in the bundle.
- `packages/openp41ge/src/main/services/editor-agent-installer.ts` — **new** (or a
  registry/manifest module): on-demand download, integrity check (hash), version
  compatibility range, install path.
- `packages/openp41ge/src/main/services/node-tool-executor.ts` — register the two new
  tools; delegate to the editor agent. Tools gate on `isAvailable` when the editor agent
  isn't installed.
- `packages/openp41ge/src/main/services/repo-settings.ts` — **new** (or extend) repo
  settings for the target merge branch.
- Tests (in code-tests): edit/write scope, snapshot and conflict cases.

## Testing Strategy

- **Scope:** edit/write reject paths outside `ctx.roots` (as `read_file` does); deny on empty roots; allow inside one root; deny
  ambiguous/multiple-root resolution.
- **Snapshot:** worktree blob hash matches `git hash-object` of the on-disk file; index/
  HEAD hashes are NOT used; absent-file sentinel vs empty-file hash.
- **Edit merge:** disjoint concurrent change → applies cleanly even when line numbers
  shifted; overlapping change → rejected, no file mutation, no conflict markers left
  behind.
- **Replace:** present file + matching snapshot → replaced; present + mismatching
  snapshot → hard-reject with both hashes in the message; absent → created.
- **Commit/journal:** landed delta appears in the change journal; inverse patch reverts
  a single contribution without disturbing others.
- **Contract:** `ToolExecutionResult.snapshot` populated by `read_file`; `edit_file` /
  `create_or_replace_file` return it on success.
- Quality gate: `nx run-many -t typecheck`, `nx lint`; the tests pass in code-tests.

## Scope

- **In:** one global editor agent (model + server); `edit_file` and
  `create_or_replace_file` tools routed through it; snapshot-hash model; git-patch
  enforcement (merge + journal + commit-to-shared-branch); read_file snapshotity.
- **In (design contract only for now):** the two-layer "AI decides, git enforces"
  principle and the subordinate tool-call access pattern.
- **Out (pending):** per-agent worktree creation (could return later, e.g. as an
  escalation for high-contention files). The tools are worktree-agnostic, so this is a
  later addition, not a conflict.
- **Out (for now):** auto validation gate (typecheck/lint before landing) — user flagged
  it as "may cause more problems right now."
- **Out:** multi-turn dialogue with the big agent (single message/response only) — the
  editor agent explains in-band and the big agent re-requests if needed.

## Open Questions

1. **Model size.** Is a ~1B-param open-weight model enough for "act and reconcile, small
   per-request context"? The richer context we now send (reason/intent + patch + file
   contents + recent changes) does the heavy lifting, so the model only reasons about the
   _local_ situation — this strengthens the case that a small model can suffice. Still
   verify on a small benchmark: it must reliably (a) detect overlap between the request
   and recent changes, (b) decide clean-merge vs reject, and (c) produce a coherent
   explanation. If it fails at (a), 1B is too small.
2. **Editor agent vs stateless tool-with-merge.** If the editor agent's job is purely
   mechanical merge/reconcile, could the merge logic be pure code (no LLM) with an LLM
   only for the "explain" path? Keep the LLM as thin as possible up front.
   2a. **Redundancy of `edits` vs `patch`.** The request carries both the structured
   `{old,new}` edits and a git patch. Confirm the editor agent treats the patch as
   authoritative and `edits` as a cross-check / fallback, or vice-versa. (Recommend:
   patch is the single source of truth; `edits` is a convenience for region isolation.)
3. **Contract for "explain concurrency."** Exactly when does the editor agent tell the
   requester other agents changed the file — always on snapshot mismatch, or only when a
   merge conflict forced a rejection? (Recommend: always mention it on mismatch, flag it
   loudly on conflict.)
4. **Dialog state** — confirm single-turn (no pending-question state on the tool), even
   when the editor agent would benefit from asking.
5. **Change journal location** — repo-backed (git ref / `.openp41ge/` log, visible to all
   agents) vs host store. Lean repo-backed for durability across restarts, but note repo
   noise.
6. **Commit granularity** — per landed delta (recommended: revertability/audit) vs
   batched. Confirm.
7. **Repo settings file** — schema for the target merge branch (and any per-repo
   overrides).
8. **Pick/ownership partitioning** — do we commit to dispatch-layer file/module ownership
   to minimize same-file contention?
9. **Install source & integrity** — where does the editor agent download from (registry
   URL / manifest)? What hash verification before use, and is the install user-approvable?
10. **Version compatibility** — how does the app declare the supported editor-agent
    version range, and what does it do when the installed version is out of range
    (block edit tools vs prompt reinstall)?
11. **Host:edge: server or subprocess** — spawn the editor agent as a loopback local
    server (recommended: simpler health/version checks, one process) vs a subprocess
    with IPC. Confirm lifecycle (started at app launch vs lazily on first edit).

## Completion Criteria

- [ ] `read_file` returns a `snapshot` (working-tree blob hash) in its result.
- [ ] `edit_file` applies `{old,new}` substitutions via a 3-way merge against current
      content; applies cleanly when the target lines are untouched (even if shifted);
      rejects without mutating the file on overlap.
- [ ] `create_or_replace_file` creates absent files; hard-rejects replacing a file whose
      content changed since the requester's snapshot.
- [ ] Both tools reject paths outside the connected worktrees / ambiguous multi-root paths.
- [ ] No tool stage or commit implicitly; the editor agent is the sole writer; git is
      invoked with `-C <worktree-root>`.
- [ ] Every applied delta is journaled and surgically revertable (inverse patch).
- [ ] The editor agent's response explicitly states when other agents changed the file
      since the requester read it.
- [ ] `nx run-many -t typecheck`, `nx lint` clean; the tests pass in code-tests.
