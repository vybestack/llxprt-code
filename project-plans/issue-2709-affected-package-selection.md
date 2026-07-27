# Issue #2709 — run only test shards that can observe a PR

## Goal

Make pull-request CI faster by not starting Linux/macOS test-shard jobs that
cannot observe the changed files. The selector itself must be cheap enough that
it cannot erase the saving.

## Simple design

- CI gives a small Node script the PR's changed paths.
- The script uses a checked-in package dependency map to select the changed
  package's shard and every reverse-dependent shard.
- Tests that inspect files without importing them are represented by a short,
  explicit observer list.
- Unknown paths or selector failures run everything. Push, merge-group, and
  manually/nightly initiated full-suite workflows run everything.
- A separate lint check verifies the checked-in map against real TypeScript
  imports. This scan runs once after dependencies are installed; it does not run
  in the fast selector or in every test job.
- Selection stays at the existing six-shard level. Filtering individual packages
  inside the 55-second `rest` shard is deferred unless measurements prove that
  extra complexity is worthwhile.

This is not runtime program analysis. The PR-time selector reads paths and a
small data file and should complete in well under one second.

## Acceptance matrix

| Behavior | Evidence |
| --- | --- |
| A cli-only production change selects `cli` and any proven static observers, but no reverse-dependent package shard. | Selector behavior test; real graph proves cli has no incoming edge. |
| A lower-level package change selects its shard and every transitive reverse-dependent shard. | Fixture and real-edge tests, including the real undeclared providers → telemetry edge. |
| Package-local test changes select only the owning shard unless an explicit observer applies. | Table-driven path tests. |
| Boundary/API tests that read source or manifests are protected without always running whole tools/core/agents suites. | Explicit observer-rule tests tied to the files those tests actually inspect. |
| Arbitrary docs, scripts, and `.github` changes do not force all package shards; real shared install/build/test inputs do. | Positive and negative trigger tests with logged reasons. |
| PR selection is auditable; non-PR events and ambiguous inputs run all six shards. | Output/event/failure tests and CI logs. |
| Existing Linux/macOS coverage, shard commands, shell tests, required `Test` aggregation, and SecureStore jobs remain intact. | Workflow validation and exact-head CI. |
| Missing cli/core coverage artifacts are expected when those shards are unselected and do not create a false failure. | Workflow tests/CI on selected and unselected samples. |
| The fast selector has p95 runtime below one second and historical replay demonstrates a material reduction in selected shard time/jobs. | Repeated local benchmark, 120-commit replay, and PR CI job timings. |

## Bounded slices

1. RED-first selector tests for path classification, real dependency closure,
   observer rules, event gating, audit output, and fail-closed behavior.
2. Minimal path-only selector and checked-in graph/observer data.
3. One AST-based lint validator that fails when the checked-in graph drifts from
   actual imports.
4. Feed selected shards into the existing CI matrix without changing shard
   composition or package test behavior.
5. Benchmark selector overhead, replay history, run full verification, and
   report actual CI savings.

## Expected paths

- `project-plans/issue-2709-affected-package-selection.md`
- `scripts/affected-test-shards.data.json`
- `scripts/affected-test-shards.mjs`
- `scripts/check-affected-test-shards.ts`
- `scripts/tests/affected-test-shards.test.ts`
- `package.json`
- `tsconfig.scripts.json`
- `.github/workflows/ci.yml`

No dependency, lockfile, package source, shard-map, nightly-workflow, public API,
quality-rule, or agent-memory change is in scope.

## Non-goals

- No per-package filtering inside the existing `rest` shard.
- No AST scan in the fast PR selector.
- No always-running expensive package suites solely for invariant tests.
- No fabricated dependency edges from comments or forbidden-package strings.
- No blanket `scripts/` or `.github/` full-run rule.
- No skipped tests, reduced OS coverage, weaker coverage/lint/type/safety gates,
  suppression directives, or threshold increases.
- No optional cleanup after the accepted behavior and required gates pass.

## Scope ledger

| Slice | Paths | Status |
| --- | --- | --- |
| Goal and bounded acceptance | project plan | Complete |
| Selector behavior | selector data/script/test | Pending |
| Graph drift guard | checker, package script, scripts tsconfig | Pending |
| CI integration | ci.yml | Pending |
| Performance and exact-head evidence | command/CI results in PR | Pending |

Budget: target 8 paths and no more than 1,500 net changed lines. Mandatory scope
review above 25 files or 1,500 net lines; stop without approval above 40 files
or 2,500 net lines.

Review findings are classified as **Blocker-Fix**, **In-scope-Fix**,
**Reject**, or **Defer**. Reviewer suggestions do not expand scope. Local OCR
and PR OCR are each limited to two runs. Exact-head completion requires accepted
behavioral evidence, local and CI verification, completed/triaged reviews, clean
scope, correct ancestry, and a conflict-free PR.
