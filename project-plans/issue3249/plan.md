# Plan: Move Windows Installed-Command Smoke Off the PR Critical Path (Issue #3249)

Plan ID: PLAN-20260818-ISSUE3249
Generated: 2026-08-18
Issue: #3249
Status: In progress

## Problem statement

The `Windows Installed Command (issue #2603)` workflow
(`.github/workflows/windows-installed-command.yml`) triggers on
`pull_request` (and `push` to main) with a path filter that includes
`packages/*/src/**`, `packages/*/package.json`, `package-lock.json`,
`.nvmrc`, `README.md`, and more. Nearly every functional PR matches at
least one entry, so virtually every PR allocates a `windows-latest`
runner for 20–45 minutes (job timeout: 60 minutes) to run the real
global/local/npm-exec install smoke plus the startup benchmark.

Evidence: run 32160691698 / job 95793376713 (PR #3246) — the Windows
job was still in progress 17+ minutes after the cheap relevance job
finished in 14 seconds. Other recent runs: 32151153415 ≈ 43 min,
32130512701 ≈ 25 min, 32110403185 ≈ 27 min. Windows validation is
already scheduled elsewhere (nightly Windows CI shards, `e2e_full`
windows leg, `windows_bun_native_smoke`), so the per-PR run duplicates
nightly coverage at PR-critical-path cost.

The #2693 semantic relevance gate cannot solve this: it only trims
irrelevant root-manifest edits. Any runtime-source change (the common
case) classifies relevant and selects RUN by design (fail-closed).

## Preflight findings

1. `.github/workflows/windows-installed-command.yml` has three triggers:
   `pull_request` (paths), `push` (main, paths), `workflow_dispatch`.
2. It defines two jobs: `windows_relevance` (cheap ubuntu classifier
   gate, exists solely to protect the PR path) and
   `windows-installed-command` (windows-latest, 60 min timeout).
3. `nightly.yml` (`Nightly Tests`) runs on schedule + dispatch and
   already aggregates job results in a `notify_failure` job that files a
   `ci/cd`-labeled issue on failure. It already consumes a reusable
   workflow (`_evals-run.yml` via `uses:`) for `behavioral_evals`.
4. `scripts/windows-installed-command-relevance.ts` (1018 lines) is the
   semantic classifier; after removing the PR trigger it becomes dead
   code. Referenced only by: the workflow, three dedicated test files,
   `tsconfig.scripts.json`, and `dev-docs/ci-relevance-guide.md`.
5. `scripts/tests/windows-installed-command-workflow.bun.test.ts`
   asserts the CURRENT wiring (PR/push path filters, relevance gate,
   fail-closed condition) and must be rewritten to own the NEW contract.
6. `scripts/tests/issue-2603-windows-lineage-helpers.test.ts` and
   `scripts/tests/pr-mergeability-workflow-wiring-b.test.ts` reference
   the workflow but do not assert PR triggers; they remain valid.
7. The smoke itself (`scripts/windows-installed-command-smoke.cjs`) uses
   no secrets and no PR context; it runs fine on any ref, which
   `workflow_call` and `workflow_dispatch` both provide.
8. Main has no branch protection/ruleset requiring this check, so
   removing the PR trigger strands no required status check.

## Proposed accepted behavior

### REQ-3249-1: No per-PR or per-merge Windows runner allocation

**Full text:** The windows-installed-command workflow must not trigger on
`pull_request` or `push` events. Windows install validation runs on the
nightly schedule and on manual dispatch only.

- GIVEN any pull request whose diff touches `packages/*/src/**`,
  `package-lock.json`, `.nvmrc`, or any path the old filter matched
- WHEN the PR is opened or updated
- THEN the workflow does not start
- AND no `windows-latest` runner is allocated for it

### REQ-3249-2: The workflow is reusable and manually dispatchable

**Full text:** `windows-installed-command.yml` keeps exactly two
triggers — `workflow_call` (so nightly invokes it without duplicating
the smoke steps) and `workflow_dispatch` (for debugging Windows-specific
install failures on demand). The relevance gate job is removed: with no
PR events there is nothing to classify, and an unconditional single job
is the honest wiring. The smoke steps themselves (checkout, Node from
`.nvmrc` with npm cache, Bun from `.bun-version`, PowerShell 7 path
export, `npm ci`, `node scripts/windows-installed-command-smoke.cjs`,
diagnostic artifact upload on failure) are preserved unchanged, as is
the 60-minute timeout and `contents: read` permission.

### REQ-3249-3: Nightly runs the Windows installed-command smoke

**Full text:** `nightly.yml` gains a `windows_installed_command` job
that calls the reusable workflow, and the smoke's result participates in
the existing nightly failure notification.

- GIVEN a nightly run
- WHEN the windows installed-command smoke fails or is cancelled
- THEN `notify_failure` includes `windows_installed_command=<result>` in
  the failed-jobs list of the auto-filed issue

### REQ-3249-4: Dead classifier and its tests are removed

**Full text:** `scripts/windows-installed-command-relevance.ts`, its
three test files
(`windows-installed-command-relevance.bun.test.ts`,
`windows-installed-command-relevance-remediation.bun.test.ts`,
`windows-installed-command-relevance-parser-boundary.bun.test.ts`), and
its four `tsconfig.scripts.json` entries are deleted. No stale
references remain in code or docs.

### REQ-3249-5: Behavioral test owns the new wiring contract

**Full text:** `scripts/tests/windows-installed-command-workflow.bun.test.ts`
is rewritten (Bun test, real YAML via `typed-test-helpers.ts`, no mock
theater) to lock in:

- the workflow has NO `pull_request` and NO `push` trigger (the
  regression guard for this issue)
- it HAS `workflow_call` and `workflow_dispatch`
- exactly one job, on `windows-latest`, no `needs`, timeout ≤ 60
- a step runs `node scripts/windows-installed-command-smoke.cjs`
- failure artifact upload step remains
- `nightly.yml` calls the workflow via `uses:`, and its `notify_failure`
  job needs the result and surfaces it in the failed-jobs aggregation

### REQ-3249-6: CI relevance guide reflects reality

**Full text:** `dev-docs/ci-relevance-guide.md` moves
`windows-installed-command.yml` from the event-path-filtered table to
the reusable/caller-controlled table, replaces the now-obsolete
"Windows installed-command semantic relevance" section with a short
note pointing to the nightly call site and this issue, and removes
stale references to the deleted classifier.

## Implementation notes

- Do not duplicate the smoke steps inside `nightly.yml`; call the
  reusable workflow so the definition exists once.
- The workflow keeps its `name:` for run-history continuity.
- The caller job in `nightly.yml` passes `permissions: contents: read`;
  no secrets are needed.
- The `concurrency` block in `windows-installed-command.yml` (written to
  cancel superseded per-PR runs) is removed along with the PR triggers;
  the nightly caller already has its own concurrency group.

## Verification

Full cycle per the issue workflow:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Plus targeted confirmation that the rewritten wiring test fails
against the OLD workflow shape (it must actually guard the contract).
