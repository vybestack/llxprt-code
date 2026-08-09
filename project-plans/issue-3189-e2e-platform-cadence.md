# Issue 3189: Move macOS E2E off the PR feedback path

## Decision and scope

The maintainer approved moving macOS E2E from the pull-request feedback path to
nightly CI. Windows E2E is already nightly-only, so its cadence does not change.
This is a scheduling change, not a reduction in behavioral coverage.

The bounded implementation removes the duplicate `e2e_mac` job from
`.github/workflows/e2e.yml`, preserves both Linux PR E2E sandbox legs, and locks
macOS and Windows nightly coverage into workflow-structure tests. It does not
change E2E commands, model budgets, quota behavior, sandbox behavior,
dependencies, action pins, permissions, or runner infrastructure.

## Acceptance matrix

| ID | Accepted behavior | Evidence |
| --- | --- | --- |
| A1 | Qualifying PR, approved labeled target, merge-group, and manual E2E runs allocate only the Linux `sandbox:none` and `sandbox:docker` E2E jobs. | Parsed workflow assertions prove `e2e_mac` is absent, no PR E2E job uses a macOS or Windows runner, and the Linux matrix retains exactly both sandbox modes. |
| A2 | PR E2E duplicate suppression, docs-only fail-closed behavior, mergeability authorization, real-model budget enforcement, and per-sandbox cancellation isolation remain unchanged. | Existing workflow wiring, truth-table, quota, budget, and concurrency tests continue to pass after their obsolete macOS expectations are removed. |
| A3 | Nightly CI continues to run the complete integration suite on macOS `sandbox:none` and Windows `sandbox:none`, alongside both Linux sandbox modes. | A Bun workflow-structure test parses `nightly.yml` and asserts the exact platform/sandbox matrix rows and the platform-specific E2E commands. |
| A4 | Nightly macOS and Windows E2E failures remain blocking and visible to the final nightly failure aggregator. | Workflow-structure assertions require `fail-fast: false`, require the aggregator to depend on `e2e_full`, and require failure/cancellation reporting through `needs.e2e_full.result`. |
| A5 | Scheduled and manual nightly runs exercise the same platform matrix. | Parsed trigger assertions require both `schedule` and `workflow_dispatch`; `e2e_full` has no event condition that excludes either trigger. |
| A6 | Candidate evidence demonstrates that the PR workflow no longer allocates macOS and that nightly macOS and Windows jobs still execute successfully. | PR check/job evidence plus a candidate-head nightly dispatch are linked to #3189, #3184, and #2702 before completion. |

## Explicit non-goals

- Do not delete or skip any integration test.
- Do not remove Linux `sandbox:none` or Linux `sandbox:docker` from PR E2E.
- Do not remove macOS or Windows from nightly E2E.
- Do not weaken real-model request budgets, quota hard failures, authorization,
  cancellation, sandbox assertions, action pinning, permissions, lint,
  complexity, security, or coverage gates.
- Do not add dependencies, services, runner pools, reusable workflow
  abstractions, or unrelated workflow cleanup.
- Do not change `.llxprt/`.

## Test-first implementation

### Phase 0: Preflight

1. Parse the current PR and nightly workflows with the established typed YAML
   helpers.
2. Confirm `e2e_mac` exists in `e2e.yml` and is the only PR E2E macOS runner.
3. Confirm `nightly.yml` already contains macOS none and Windows none in
   `e2e_full`, and that the final failure job consumes `e2e_full.result`.
4. Confirm all affected tests use Bun and `bun:test`.

### Phase 1: RED — express the approved cadence

1. Add `scripts/tests/e2e-platform-cadence.bun.test.ts` using the real committed
   workflow files and typed YAML helpers.
2. Assert that `e2e.yml` has no `e2e_mac` job and no E2E job allocated to macOS
   or Windows; this assertion must fail against the pre-change workflow.
3. Assert that the Linux PR matrix retains `sandbox:none` and
   `sandbox:docker`.
4. Assert that nightly `e2e_full` retains the exact Linux none, Linux Docker,
   macOS none, and Windows none rows; scheduled and manual triggers; both
   platform execution paths; non-fail-fast matrix behavior; and failure
   aggregation through `e2e_full`.
5. Update existing workflow tests only where they encode the superseded
   requirement that `e2e_mac` exist. Preserve every Linux, authorization,
   fail-closed, quota, model-budget, and cancellation assertion.
6. Run the affected test set and record the expected RED failure caused by the
   still-present `e2e_mac` job.

### Phase 2: GREEN — remove only duplicate PR macOS scheduling

1. Delete the `e2e_mac` job from `.github/workflows/e2e.yml`.
2. Do not edit `.github/workflows/nightly.yml` unless the RED assertions reveal
   a concrete mismatch with the already-observed accepted behavior; stop for
   approval if a behavioral nightly change is required.
3. Run the focused workflow-structure tests until green.
4. Inspect the workflow diff to confirm Linux E2E commands, gates, action pins,
   permissions, concurrency, and model-budget enforcement are unchanged.

### Phase 3: Verification and candidate evidence

1. Run the repository's focused script-test shard.
2. Run full test, lint, typecheck, format, build, and the required StepFun smoke
   command.
3. Run DeepThinker and Open Code Review, classify every finding as
   `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`, and remediate all
   in-scope findings within the review-cycle limit.
4. Create the issue-linked PR and watch all required checks until green.
5. Verify the PR E2E run allocates Linux none and Docker but no macOS runner.
6. Dispatch `nightly.yml` on the candidate head and require successful macOS none
   and Windows none E2E jobs plus successful aggregation.
7. Record before/after PR E2E wall-clock and nightly platform evidence on #3189,
   #3184, and #2702.

## Expected changed paths

- `.github/workflows/e2e.yml`
- `scripts/tests/e2e-platform-cadence.bun.test.ts`
- `scripts/tests/e2e-docs-only-wiring.bun.test.ts`
- `scripts/tests/pr-workflow-concurrency.test.ts`
- `scripts/tests/pr-mergeability-workflow-wiring-b.test.ts`
- `scripts/tests/workflow-quota-selection.test.ts`
- `project-plans/issue-3189-e2e-platform-cadence.md`

Any production source, dependency, lockfile, quality configuration, nightly
behavior, or unrelated workflow change requires separate justification and
approval.
