# Issue #2900 Plan: Harden node24 PR-comment steps (404 fallback + API error diagnostics)

Plan ID: PLAN-20260823-ISSUE2900
Generated: 2026-08-23
Issue: https://github.com/vybestack/llxprt-code/issues/2900

## Investigation Result

The issue lists two affected files. One no longer exists on main:

- `.github/actions/post-coverage-comment/action.yml` was deleted in PR #3145
  (commit d604b4db3a, "Delete every Vitest escape hatch...", Fixes #2970). That
  PR removed the entire coverage plumbing because no test script passed
  `--coverage`, so the coverage comment step posted nothing and its composite
  action was dead weight. No workflow references the composite path anymore
  (verified by recursive search of `.github/`). The coverage half of this issue
  is therefore obsolete; reviving it would restore deleted dead code and is out
  of scope.
- `.github/workflows/pr-review.yml` still contains the `Post walkthrough comment`
  step (github-script@v9, inline find-or-update script). It carries both
  findings: an unwrapped `updateComment` that 404s if the matched comment is
  deleted between `listComments` and `updateComment`, and no `core.setFailed`
  diagnostics when API calls fail (the step's `continue-on-error: true` keeps
  the job green while github-script's raw error is the only trace).

Reference pattern in-repo: `issue-planner.yml`'s "Upsert plan comment" step
wraps its API work in try/catch and calls
`core.setFailed(\`Failed to reconcile planner comment: ${error.message || error}\`)`.
`ocr-infrastructure-notifier.yml` uses the same `core.setFailed` convention.
`issue-planner.ts` also demonstrates status-checked recovery: `deleteComment`
errors are swallowed only when `status === 404`, otherwise re-thrown.

Test precedent: `scripts/tests/ocr-review-github-script-syntax.bun.test.ts`
compiles inline github-script blocks with `AsyncFunction` exactly as the action
runtime does. `scripts/tests/pr-review-walkthrough-workflow.test.ts` already
asserts the step's structure (`continue-on-error: true`, `if: always()`,
github-script usage, marker env).

## Accepted Behavior

### AC-1: 404 on updateComment falls back to createComment

**Given** the walkthrough comment matched by marker exists at `listComments`
time,
**when** `updateComment` rejects with HTTP status 404 (a maintainer deleted the
comment mid-run),
**then** the script calls `createComment` with the same body on the same issue,
logs the recovery via `core.info`, and the step does not fail.

### AC-2: Non-404 API failures surface a root-cause message

**Given** any GitHub API call in the script (`listComments`, `updateComment`,
`createComment`) rejects with a non-404 error (rate limit, permissions, network),
**when** the outer catch handles it,
**then** `core.setFailed` is called exactly once with a message prefixed
`Failed to post walkthrough comment:` that includes the error message, and the
fallback `createComment` is not attempted. The step's `continue-on-error: true`
remains, so the job stays green while the step outcome is failure with the
clear message. Only errors whose `status` is exactly 404 trigger the fallback;
errors without a status (plain `Error`) never fall back.

### AC-3: Fallback createComment failure is not swallowed

**Given** the 404 fallback path runs,
**when** the fallback `createComment` itself rejects,
**then** that error reaches the outer catch and `core.setFailed` reports it
(the script must not silently lose the comment on double failure).

### AC-4: Guard clauses and happy paths are preserved

**Given** the comment file is missing, the marker env is unset, or the context
has no issue/PR number,
**when** the script runs,
**then** it returns early with a `core.info` note, makes no API calls, and does
not fail (existing behavior, unchanged).

**Given** a matched comment exists and `updateComment` succeeds, it is updated
in place (`comment_id` + body, `Updated comment <id>.` log). **Given** no
matched comment exists, `createComment` creates one (`Created comment <id>.`
log). No duplicate-posting behavior changes.

### AC-5: Step wiring is unchanged

`if: always()` and `continue-on-error: true` on the `Post walkthrough comment`
step remain exactly as before (already asserted by
`pr-review-walkthrough-workflow.test.ts`).

## Inputs and Boundary Cases

Inputs: the inline github-script source in the `Post walkthrough comment` step,
driven by `COMMENT_FILE` (real temp file in tests), `COMMENT_MARKER`, a fake
`github` (paginate + rest.issues), fake `core`, and a `context` with/without
`issue.number`.

Boundary cases:

- `updateComment` rejects 404 → fallback create, no failure (AC-1).
- `updateComment` rejects 403 / network `Error` with no `status` property →
  `core.setFailed`, no fallback create (AC-2 boundary: status must be exactly
  404).
- `listComments` (paginate) rejects → `core.setFailed` (AC-2).
- `createComment` rejects on the no-match path → `core.setFailed` (AC-2).
- `createComment` rejects on the 404-fallback path → `core.setFailed` (AC-3).
- Comment file missing / marker unset / no issue number → early return, zero
  API calls, no failure (AC-4).
- Multiple comments where only one carries the marker → only that comment id is
  updated (AC-4).

## Behavioral Evidence

| Criterion | Evidence |
|---|---|
| AC-1 | New test: execute the real script string with fake github whose updateComment rejects `{status: 404}`; assert createComment called with body, setFailed not called |
| AC-2 | Tests: updateComment rejects `{status: 403}`; paginate rejects; createComment rejects — each asserts one `core.setFailed('Failed to post walkthrough comment: …')` and no fallback create; a status-less `Error` rejection also asserts no fallback |
| AC-3 | Test: updateComment 404 then createComment rejects → setFailed called |
| AC-4 | Tests: guard clauses make zero API calls and log skip; matched-comment update and no-match create happy paths; multi-comment marker matching |
| AC-5 | Existing tests in `pr-review-walkthrough-workflow.test.ts` (continue-on-error, always()) stay green unchanged |

Tests live in a new `scripts/tests/pr-review-walkthrough-comment-script.test.ts`
(bun:test, TS) that extracts the script from the workflow YAML and executes it
via `AsyncFunction` with injected `github`/`core`/`context`/`require` — the
same compilation route `actions/github-script` itself uses, so the tests
exercise the production script text, not a copy.

## Out of Scope

- Restoring `.github/actions/post-coverage-comment/` (deleted deliberately in
  #3145; the coverage half of the issue is obsolete).
- Moving the inline script into a separate `.ts` helper (issue says keep
  changes limited to the comment-posting script).
- Changes to any other workflow, step, `if:`, or `continue-on-error` wiring.
- Retry/backoff logic beyond the single 404 fallback the issue requests.

## Verification

Full verification cycle per the issue-workflow skill (test, lint, typecheck,
format, build, stepfun-37 smoke), plus `actionlint` on the modified workflow,
then local OCR review (max 2 rounds), PR, CI watch, CodeRabbit triage.

### Verification record (2026-08-23)

- Targeted tests: 92 pass / 0 fail (14 in the new behavioral suite + 78
  structural workflow tests).
- Full `npm run test`: ~20 failures in packages/core + telemetry, all
  reproduced identically on a clean `main` worktree at the same SHA CI runs
  (e.g. `ripgrepPathResolver` `vi.fn()` mocks, scheduler hook timeouts), and
  main's CI is green at that SHA — proven pre-existing/environmental, none
  touch the changed files.
- `npm run lint` / `npm run typecheck` / `npm run format` / `npm run build`:
  exit 0. Smoke (`stepfun-37` haiku): exit 0. `actionlint` on
  `pr-review.yml`: clean.

### Review record (2 rounds, cap reached)

Round 1 (deepthinker): production script passed all ACs. Three In-scope-Fix
findings on the test file, all remediated: (1) `process.env`
COMMENT_FILE/COMMENT_MARKER now captured before overwrite and restored in
afterEach; (2) the `as` constructor assertion replaced with a runtime type
predicate; (3) added the string-status `'404'` boundary test (verified by
mutation: loosening `!==` to `!=` fails exactly that test).

Round 2 (deepthinker): remediations confirmed; one In-scope-Fix — the
constructor predicate accepted any function although arrow/async functions
throw on `new`. Fixed: the predicate now also requires a non-null object
`prototype` (arrow/async functions lack one). Two reviewer suggestions
rejected with rationale: `error?.message` in the production catch (the
accepted Octokit error shape always has `.message`; speculative), and typing
the constructor's return as `Promise<unknown>` (the constructor returns a
function object, not a promise).

Local OCR count against the two-file diff: 2 (both within cap). Findings:
the env-restore issue (fixed above) and the two rejected suggestions. No
further local OCR rounds.
