# Issue #3064 — Auto-created failure issues must carry milestone, label, and type

## Problem

Five workflows create GitHub issues automatically when something fails. They do
not consistently stamp the metadata needed to triage them, so the issues fall
out of the release view and get filtered out by hand.

Current state, audited on `main`:

| Site | `ci/cd` label | Milestone | Issue type |
| --- | --- | --- | --- |
| `.github/workflows/nightly.yml` (notify_failure) | yes | yes (#3149) | no |
| `.github/workflows/evals-nightly.yml` (notify) | yes | yes (#3149) | no |
| `.github/workflows/release.yml` (Create Issue on Failure) | yes | no | no |
| `.github/workflows/smoke-test.yml` (Create Issue on Failure) | no | no | no |
| `.github/workflows/ocr-infrastructure-notifier.yml` | yes | no | no |

`.github/scripts/issue-planner.ts` only comments on existing issues, so it is
out of scope.

## Facts established during research

- Repository issue types are `Task`, `Bug`, `Feature`
  (`IT_kwDODYHhhs4BsMlP` is `Bug`).
- `gh issue create` in gh 2.83.2 has `--milestone` but **no** `--type` flag.
- The REST API does accept a type on update:
  `gh api -X PATCH repos/OWNER/REPO/issues/N -f type=Bug` was verified live
  against issue #3064 and returned `{"number":3064,"type":"Bug"}`.
- Open milestones are titled with bare versions (`0.11.0`, `0.12.0`, …) and
  `main`'s `package.json` version is `0.11.0`, so exact-title matching against
  the version works.
- `nightly.yml` / `evals-nightly.yml` already contain an identical
  `resolve_milestone()` bash function that reads `package.json` from `main`
  over the API (their notify jobs have no checkout) and matches an open
  milestone by exact title, failing soft.
- `.github/scripts/assign-issue.sh` sources `.github/scripts/assign-constants.sh`
  and `assign.yml` performs a checkout before running it, so a sourced shared
  helper in `.github/scripts/` is an established pattern here.
- `scripts/tests/assign-helpers.ts` executes the real bash scripts against a
  stateful fake `gh` on `PATH`. That harness style is the model for the tests
  below.

## Acceptance criteria

**AC1 — label.** Every auto-created failure issue is created with the `ci/cd`
label.

**AC2 — milestone.** Every auto-created failure issue is assigned the open
milestone whose title exactly equals the `version` field of `package.json` on
`main`, resolved at run time.

**AC3 — type.** Every auto-created failure issue is given issue type `Bug`.

**AC4 — recurring issues.** Where a workflow reuses a long-lived open issue
instead of creating a new one (nightly, evals-nightly, ocr-infrastructure
notifier), the same milestone and type are re-applied to that issue.

**AC5 — fail soft on metadata, never on notification.** Metadata resolution or
application that fails must log a warning and leave the notification intact.
Specifically:

- `package.json` unreadable on `main` → warn, no milestone, issue still created.
- `package.json` has no `version` → warn, no milestone, issue still created.
- no open milestone titled with that version → warn, no milestone, issue still
  created.
- `gh issue create` output is not a parseable issue URL → warn, no type applied.
- the type PATCH fails → warn, issue remains created and labelled.

**AC6 — consistent implementation.** All five sites use the same
`resolve_milestone()` / `apply_issue_type()` bash contract, matching the
function already shipped in `nightly.yml` and `evals-nightly.yml`.

## Design

### Why the logic is inlined per workflow rather than shared

A sourced helper in `.github/scripts/` was considered and rejected. Three of the
five jobs (`nightly.yml` notify_failure, `evals-nightly.yml` notify,
`ocr-infrastructure-notifier.yml`) have no checkout step at all — that is
precisely why the existing `resolve_milestone()` reads `package.json` over the
API instead of from disk. `smoke-test.yml` checks out a dispatch-supplied ref
and `release.yml` a release ref, neither of which is guaranteed to contain a
newly added helper.

Sharing would therefore require adding five pinned sparse-checkout steps plus a
`contents: read` permission grant to the privileged `workflow_run`-triggered OCR
notifier. That is a structural change to job wiring and permissions well beyond
what this issue asks for, so the logic stays inline. Each site carries a short
comment pointing at this decision so the duplication reads as deliberate.

### The two bash functions

Added at each site, in the style already used by `nightly.yml`:

- `resolve_milestone` — prints the milestone title on stdout, or nothing. Reads
  `repos/${GH_REPO}/contents/package.json?ref=main`, extracts `.version`, then
  exact-matches across all pages of open milestones. Every failure path warns to
  stderr and returns empty (AC5). This is the function already present in
  `nightly.yml` and `evals-nightly.yml`, unchanged; it is added verbatim to the
  other three.
- `apply_issue_type <issue-number-or-url>` — new. Accepts either a bare number
  or the URL that `gh issue create` prints, extracts the trailing number, and
  runs `gh api -X PATCH "repos/${GH_REPO}/issues/N" -f type=Bug`. Warns and
  returns non-zero on unparseable input or a failed PATCH; callers ignore the
  status (AC5).

`GH_REPO` and `GH_TOKEN` come from the environment. `smoke-test.yml` and
`release.yml` currently export `GITHUB_TOKEN` but not `GH_REPO`, so both gain
`GH_REPO: '${{ github.repository }}'` in their step `env`.

### Per-site changes

1. **nightly.yml** — delete inline `resolve_milestone()`, source the helper,
   keep `LABEL_ARGS`/`MILESTONE_ARGS`, apply type after create and after the
   existing-issue comment path.
2. **evals-nightly.yml** — same as nightly.
3. **release.yml** — capture the create output, add `--milestone`, apply type.
4. **smoke-test.yml** — add `--label ci/cd`, `--milestone`, apply type.
5. **ocr-infrastructure-notifier.yml** — add `--milestone` to
   `create_infrastructure_issue`, apply type after create, and apply milestone
   plus type on the two existing-issue comment paths.

`smoke-test.yml` and `release.yml` pass `--label ci/cd` directly with no
`ensure_label` fallback: the label already exists and a missing label should
fail loudly rather than be papered over.

## Test plan

Tests are behavioral, not string-matching. Following the
`scripts/tests/assign-helpers.ts` precedent, a shared harness extracts the real
`run:` script out of each workflow's notification step, then **executes that
bash** with a fake `gh` on `PATH`. The fake `gh` is infrastructure: it models
GitHub API responses from a JSON fixture and appends every invocation's argv to
a log file. Assertions are made against the recorded argv and the resulting
fake-API state, so they describe observable behavior rather than source text.

### `scripts/tests/auto-issue-metadata-helpers.ts` (new)

- `notificationScript(workflowPath, jobId, stepName)` — parses the workflow YAML
  and returns the step's `run:` text and its declared `env` keys.
- `runNotification({ script, env, fakeGh })` — writes the fake `gh` (and a
  passthrough `jq`) into a temp `PATH` dir, runs the script under `bash`, and
  returns `{ status, stdout, stderr, ghCalls }` where `ghCalls` is the parsed
  argv log.
- Fixture knobs for the fail-soft paths: `packageJson` (content, or a fetch
  failure), `milestones` (paged list), and `failOn` (method/endpoint to reject).

### `scripts/tests/auto-issue-metadata.test.ts` (new)

Run once per site via a table over the five workflows, so every case below is
asserted five times against real execution.

Happy path:

1. The `gh issue create` argv includes `--label ci/cd`.
2. The `gh issue create` argv includes `--milestone 0.11.0` when `main`'s
   `package.json` says `0.11.0` and an open milestone of that title exists.
3. After creation, a `gh api -X PATCH repos/OWNER/REPO/issues/N -f type=Bug`
   call is recorded with `N` taken from the URL the fake create printed.

Milestone resolution boundaries:

4. No open milestone titled with the current version → no `--milestone` in the
   create argv, a warning on stderr, and the issue is still created.
5. `package.json` fetch fails → no `--milestone`, warning, issue still created.
6. `package.json` has no `version` field → no `--milestone`, warning, issue
   still created.
7. Exact-title matching only: an open milestone titled `0.11.0-rc1` does not
   satisfy version `0.11.0`.
8. A milestone that appears only on the second page of `milestones?state=open`
   is still found.

Type application boundaries:

9. The type PATCH failing does not fail the step: exit status stays 0 and the
   created issue is unaffected.
10. Create output that is not a parseable issue URL → warning, no PATCH call,
    step still exits 0.

Recurring-issue paths (nightly, evals-nightly, ocr-infrastructure-notifier):

11. When an open issue with the same title already exists, the step comments on
    it and records both a milestone edit and a type PATCH for that issue number,
    and records no `gh issue create`.

Cross-cutting:

12. No site ever exits non-zero solely because milestone or type handling
    failed.

### Existing tests to update

- `scripts/tests/nightly-notifier-repository.test.ts` and
  `scripts/tests/nightly-notifier-shell-helpers.ts` parse nightly's inline shell
  and assert every `gh` invocation targets `GH_REPO`; the new
  `gh api ... repos/${GH_REPO}/issues/N` call must satisfy that harness.
- `scripts/tests/evals-nightly-workflow.test.ts`,
  `scripts/tests/ocr-review-workflow-behaviors.test.ts`,
  `scripts/tests/ocr-review-workflow.bun.test.ts`, and
  `scripts/tests/release-process-b.test.ts` assert on exact shell strings at the
  touched sites and will need their expectations updated to the new argv.

### Existing tests to update

- `scripts/tests/nightly-notifier-repository.test.ts` and
  `scripts/tests/nightly-notifier-shell-helpers.ts` parse nightly's inline
  shell; removing inline `resolve_milestone()` and adding a `source` line must
  keep `gh issue create` repository-targeting assertions passing.
- `scripts/tests/evals-nightly-workflow.test.ts`,
  `scripts/tests/ocr-review-workflow-behaviors.test.ts`,
  `scripts/tests/ocr-review-workflow.bun.test.ts`, and
  `scripts/tests/release-process-b.test.ts` assert on exact shell strings at the
  touched sites and will need their expectations updated to the new argv.

## Out of scope

- Changing which issues get created, their titles, bodies, or dedup logic.
- Backfilling metadata on issues already created.
- `.github/scripts/issue-planner.ts` (comments only, creates nothing).
- Any label taxonomy change beyond using the existing `ci/cd` label.
