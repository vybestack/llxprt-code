# Cherry-Picking Runbook (LLxprt Code)

This runbook is the end-to-end, repeatable workflow for syncing LLxprt Code with upstream `google-gemini/gemini-cli` between two release tags (or two commits).

Use this when you want to be able to say:

> “Do the cherrypicking analysis between `<from>` and `<to>`.”

…and have the agent produce the same artifacts every time, with the same batching and verification cadence.

For selection criteria, non-negotiables (privacy/multi-provider/tool batching), and branding substitutions, also follow `dev-docs/cherrypicking.md`. If this runbook and `dev-docs/cherrypicking.md` disagree on workflow/cadence, follow this runbook.

---

## Naming Convention (Required)

- **Branch name:** `YYYYMMDDgemerge` (no hyphen), e.g. `20251215gemerge`
- **Plan folder:** `project-plans/YYYYMMDDgemerge/` (matches branch name)

Do not create “marker-only merge commits” to record sync points. Tracking is done via the plan folder artifacts and commit messages (see `dev-docs/cherrypicking.md`).

---

## Inputs (You Must Ask For / Confirm)

1. **Upstream range**: `vX.Y.Z..vA.B.C` (or commit range)
2. **Current parity** (what we already match): e.g. “already at v0.10.0”
3. **Tracking issue**: e.g. `vybestack/llxprt-code#708`
4. **Special constraints** (often stable, but confirm):
   - A2A server stays **private** (do not make publishable).
   - Prefer **upstream integration test improvements** when they help deflake ours.
   - We renamed upstream tools:
     - upstream `web_search`/`web_fetch` ≠ LLxprt `google_web_search` / `google_web_fetch` (and sometimes `direct_web_fetch`).
     - upstream `ls/grep/edit` are _aliases_; LLxprt canonical names remain `list_directory`, `search_file_content`, `replace`.

---

## Required Artifacts (Write These Files)

Create `project-plans/YYYYMMDDgemerge/` and write:

- `project-plans/YYYYMMDDgemerge/CHERRIES.md`  
  Decision tables for every upstream commit in the range.
- `project-plans/YYYYMMDDgemerge/SUMMARY.md`  
  Short “what’s happening” overview + counts + any high-risk items.
- `project-plans/YYYYMMDDgemerge/PLAN.md`  
  Executable batch schedule (chronological), verification cadence, and links to reimplementation playbooks.
- `project-plans/YYYYMMDDgemerge/PROGRESS.md`  
  A checklist to track batch completion (and record the LLxprt commit hash per batch).
- `project-plans/YYYYMMDDgemerge/NOTES.md`  
  Running notes while executing batches (conflicts, decisions, deviations, follow-ups).
- `project-plans/YYYYMMDDgemerge/AUDIT.md`  
  Post-implementation reconciliation: upstream SHA → “PICKED/REIMPLEMENTED/SKIPPED/NO_OP” + LLxprt commit hash(es) + notes.

For every **REIMPLEMENT** upstream commit, add a per-commit playbook:

- `project-plans/YYYYMMDDgemerge/<upstream-sha>-plan.md`

You may generate these with subagents, but they must be specific enough that a context-wiped agent can execute them safely and deterministically.

Use `project-plans/20251215gemerge/` as a structure reference (not as a decision template).

---

## Phase 0 — Setup (Commands)

From repo root:

```bash
git fetch origin
git checkout main
git pull --ff-only
git checkout -b YYYYMMDDgemerge

# Ensure upstream remote exists (use upstream = gemini-cli)
git remote add upstream https://github.com/google-gemini/gemini-cli.git 2>/dev/null || true
git remote set-url upstream https://github.com/google-gemini/gemini-cli.git
git fetch upstream --tags

mkdir -p project-plans/YYYYMMDDgemerge
```

---

## Phase 1 — Upstream Commit Inventory

Goal: produce a complete, chronological list of upstream commits in the requested range.

Commands:

```bash
git log --reverse --date=short --format="%H %ad %s" <from-tag>..<to-tag> > /tmp/upstream-range.txt
wc -l /tmp/upstream-range.txt
```

For each upstream commit you will need:

- SHA
- date
- subject
- “areas touched” (derive from file list)

Helpful per-commit inspection:

```bash
git show --name-only --pretty=format: <sha>
```

---

## Phase 2 — Decisioning (Produce `CHERRIES.md`)

For every upstream commit in the range, choose exactly one:

- **PICK**: cherry-pick as-is (or with trivial conflict resolution)
- **REIMPLEMENT**: too divergent to cherry-pick cleanly, but desired behavior should be recreated in LLxprt
- **SKIP**: not relevant, conflicts with LLxprt goals, too high churn for value, Google-only, etc.

### Required table order

In `project-plans/YYYYMMDDgemerge/CHERRIES.md`, include three separate tables in this exact order:

1. **PICK table** (chronological)
2. **SKIP table** (chronological)
3. **REIMPLEMENT table** (chronological)

Each row must include:

| #   | Upstream SHA | Date | Areas | Decision | Rationale | Subject |
| --- | -----------: | ---- | ----- | -------- | --------- | ------- |

Notes:

- **Chronological order** means ascending by upstream commit date (oldest first).
- “Areas” should be a short comma-separated summary like `core`, `cli`, `integration-tests`, `docs`, `a2a-server`, `policy`, etc.
- If a commit is “docs only”, that does _not_ automatically mean SKIP; decide based on relevance and whether it documents features we have/want.

Also write:

- Counts (PICK/SKIP/REIMPLEMENT) at the top of `CHERRIES.md`
- A short “decision notes” section for recurring themes (A2A privateness, tool renames, test deflaking, formatting churn)

### Stop point (human review)

After writing `CHERRIES.md` and `SUMMARY.md`, stop and wait for review/overrides before writing the batch execution plan.

---

## Phase 3 — Batch Execution Plan (Produce `PLAN.md`)

Goal: turn the decisions into an executable, deterministic batch schedule.

### Batch construction rules

1. **Chronological order always** (oldest upstream first).
2. **PICK** commits:
   - group into batches of **5 upstream commits** at a time
   - cherry-pick the 5 commits in a single command (unless a conflict forces you to restart the batch)
   - exception: if a PICK commit is likely to be high-conflict/high-risk, make it a **solo batch**
     - typical signals: touches tool scheduling/execution, policy/approvals, core tool naming, multi-provider routing, or other LLxprt “non-negotiables”
3. **REIMPLEMENT** commits:
   - **solo batch** (batch size 1)
   - `PLAN.md` must link to `project-plans/YYYYMMDDgemerge/<sha>-plan.md`
4. **SKIP** commits:
   - do not batch (they are not executed)

### Verification cadence (Required)

- After **every batch** (PICK or REIMPLEMENT): run “quick verify”
  ```bash
  npm run lint
  npm run typecheck
  ```
- After **every 2nd batch** (Batch 2, 4, 6, …): run “full verify”
  ```bash
  npm run lint
  npm run typecheck
  npm run test
  npm run format
  npm run build
  node scripts/start.js --profile-load synthetic --prompt "write me a haiku"
  ```

Formatting rule:

- If `npm run format` modifies files during full verify, **commit the formatting changes**, but do **not** rerun lint/typecheck/test solely because formatting changed files.

### Commit rule (Required)

- Every batch produces a commit.
- If a batch requires follow-up fixes (conflict fixes, test fixes, format-only changes), add a separate fix commit immediately after the batch (before starting the next batch).

Recommended commit message templates:

- Batch commit (PICK): `cherry-pick: upstream <from>..<to> batch NN`
- Batch commit (REIMPLEMENT): `reimplement: <upstream subject> (upstream <sha>)`
- Follow-up fix: `fix: post-batch NN verification`

### Required PLAN.md contents

`project-plans/YYYYMMDDgemerge/PLAN.md` must include:

1. A short “non-negotiables” section pointing to `dev-docs/cherrypicking.md` (privacy/multi-provider/tool batching/branding).
2. A “file existence pre-check” section (files referenced by reimplement plans that might not exist in LLxprt).
3. A “branding substitutions” section (or link to the canonical table in `dev-docs/cherrypicking.md`).
4. The full batch schedule:
   - Batch number
   - Type: `PICK` or `REIMPLEMENT`
   - Upstream SHA(s)
   - The exact command to run (or link to `<sha>-plan.md`)
   - The commit message template to use
   - Quick verify steps
   - Full verify marker on every even batch
5. A “failure recovery” section:
   - How to abort/retry a cherry-pick batch
   - When to create a follow-up fix commit
6. A “note-taking requirement”:
   - After each batch, update `PROGRESS.md`, append to `NOTES.md`, and update `AUDIT.md`

---

## Phase 4 — Tracking During Execution (`PROGRESS.md` + `NOTES.md` + `AUDIT.md`)

### `PROGRESS.md` (Checklist)

Maintain a batch checklist like:

| Batch | Type | Upstream SHA(s) | Status | LLxprt Commit | Notes |
| ----: | ---- | --------------- | ------ | ------------- | ----- |

Status values:

- `TODO`
- `DOING`
- `DONE`
- `SKIPPED` (only if the plan explicitly says it is a NO-OP / not applicable)

### `NOTES.md` (Running Notes)

After each batch, append:

- Batch number
- What conflicted / what was tricky
- Any deviations from the plan (and why)
- Follow-ups created (with links to files/issues)

### `AUDIT.md` (Post-facto Reconciliation)

Update continuously as you execute:

- upstream SHA
- decision (PICKED/REIMPLEMENTED/SKIPPED/NO_OP)
- LLxprt commit hash(es)
- any notes (e.g. “adapted tool names”, “kept LLxprt parallel batching”, “A2A kept private”)

---

## Phase 5 — PR Creation (After Execution)

Open a PR against `main` that:

- References the tracking issue (e.g. `Fixes #708`)
- Links to `project-plans/YYYYMMDDgemerge/CHERRIES.md` and `project-plans/YYYYMMDDgemerge/AUDIT.md`
- Summarizes major functional changes and any intentional SKIPs/NO_OPs

---

## Troubleshooting Notes

- If `npm run typecheck` fails in a workspace due to stale `@vybestack/llxprt-code-core` types after core changes, run:
  ```bash
  npm run build --workspace @vybestack/llxprt-code-core
  ```
  Then rerun `npm run typecheck`.
