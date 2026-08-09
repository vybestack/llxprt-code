# Issue #3187 — bound CodeQL latency on the PR feedback path

Contributes to #2702 (CI execution optimization umbrella).

## Goal

Bound CodeQL's pull-request job execution so candidate runs can satisfy the
umbrella's under-ten-minute feedback target, while keeping failures fail-closed
and preserving current languages, default queries, events, source coverage,
permissions, and pinned actions.

A complete verdict may be success or failure. A timeout or failure yields a
non-success CodeQL check and is never converted to success. The job timeout does
not bound dependency time, hosted queueing, or check propagation; candidate CI
measured from workflow creation proves end-to-end acceptance.

## Evidence and attribution

### Before: successful pull-request runs

| Run | CodeQL job | Perform CodeQL Analysis |
| --- | ---: | ---: |
| 31290737638 | 10m25s | 10m00s |
| 31287893938 | 8m51s | 8m25s |
| 31285748447 | 6m30s | 6m08s |
| 31285400987 | 6m44s | 6m18s |
| 31281280511 | 7m52s | 7m27s |
| 31276892758 | 7m02s | 6m35s |

These are GitHub Actions measurements, not local timings.

### Main outlier: run 31271922174

The 79m07s CodeQL job started about 48 seconds after workflow creation. Its
78m37s analysis step spent the exceptional time in local query evaluation on
the assigned hosted runner:

- Extraction completed in about 2m32s. TRAP import took 36.6s and produced a
  254.04 MiB relations database with an 88.03 MiB string pool.
- The unchanged 89-query default suite ran for about 74m45s. Clear-text logging
  took 35m54s, regular-expression injection took 68m11s, and insufficient
  password hashing took 68m17s.
- SARIF export took 506ms, upload took about 1.43s, and GitHub processing wait
  took about 5.29s.
- CodeQL scanned all configured inputs: 4972 TypeScript files, 41 JavaScript
  files, and 21 GitHub Actions files.

Representative PR run 31290737638 used the same CodeQL 2.26.2 release and default
query count with a similarly sized database (257.90 MiB relations and 88.03 MiB
string pool). Its extraction and TRAP import were comparable, but query
execution took about 6m35s and backend processing about 5.13s. The PR event also
used CodeQL's `pr-diff-range` extension, so main and PR are not a controlled
same-mode benchmark.

### Systematic full-push latency

Repeated same-event push runs confirm that full-push analysis is systematically
long, not a singular hosted-runner outlier:

| Run | Event | Total CodeQL job |
| --- | --- | ---: |
| 31244295896 | push | 78m29s |
| 31237401470 | push | 70m21s |
| 31190066338 | push | 75m27s |
| 31139694459 | push | 77m30s |

### Attribution

Run 31271922174 spent about 74m45s in local default-query evaluation; queueing,
SARIF export/upload, and backend processing were not material contributors.
However, current evidence cannot isolate the remaining cause between CodeQL
full-event/query mode, repository workload, and hosted execution variance.
Hosted-runner variance is an unavoidable factor in these timings; it is
documented here for accuracy but cannot be shown to dominate the other
candidates.

## Accepted behavior

### AC-1: successful CodeQL remains unchanged within the bound

- **GIVEN** a non-duplicate pull-request CodeQL run that can finish within nine
  job-runtime minutes,
- **WHEN** the CodeQL job runs,
- **THEN** checkout, JavaScript initialization, all default queries, SARIF
  upload, and processing complete normally, and the real result remains
  authoritative rather than being masked as success.

### AC-2: pull-request hosted execution outliers fail closed

- **GIVEN** a pull-request CodeQL job that has acquired a runner but has not
  completed within nine minutes of CodeQL job execution,
- **WHEN** the job timeout is reached,
- **THEN** GitHub terminates it with a bounded non-success conclusion rather
  than leaving the running CodeQL job pending.
- **AND** the nine-minute cap bounds pull_request CodeQL job execution only; it
  does not bound skip_check dependency time, hosted queueing, or check
  propagation. Candidate-head evidence measured from workflow creation is what
  proves the under-ten-minute issue acceptance.

### AC-2b: non-pull-request events retain full-job timeout allowance

- **GIVEN** a push, merge_group, or workflow_dispatch CodeQL run,
- **WHEN** the CodeQL job runs,
- **THEN** the timeout-minutes expression evaluates to 360 (six hours), matching
  GitHub Actions' ordinary job limit and accommodating the measured 70–79-minute
  full-push scans.

### AC-3: security coverage is preserved

- **GIVEN** any currently supported CI event,
- **WHEN** the workflow is evaluated,
- **THEN** CodeQL retains existing push, pull-request, merge-group, and manual
  event coverage and remains gated only by the existing duplicate-run check.
- **AND** the language remains `javascript`, the default query suite remains in
  use, and no path exclusion, docs-only gate, custom config, or success wrapper
  is introduced.

### AC-4: least privilege and action integrity are preserved

- **GIVEN** the CodeQL job configuration,
- **WHEN** permissions and action references are inspected,
- **THEN** permissions remain exactly `actions: read`, `contents: read`, and
  `security-events: write`; checkout does not persist credentials; and checkout,
  init, and analyze remain pinned to full commit SHAs with ratchet comments.

### AC-5: candidate-head evidence gates completion

- **GIVEN** the final PR candidate,
- **WHEN** at least three non-skipped, successful pull-request-event CodeQL runs
  are collected,
- **THEN** each run records its URL/ID, head SHA, workflow creation time, CodeQL
  start/completion times, job duration, analysis-step duration, queue/dependency
  delay, and successful SARIF processing.
- **AND** each accepted run reaches a CodeQL conclusion under ten minutes from
  workflow creation, not merely under nine minutes from runner assignment.
- **AND** the before/after range and unavoidable hosted-runner and queue variance
  are documented in the PR and issues, then #2702 receives the re-baseline.

## Boundary cases

- Documentation-only PRs still run CodeQL; the existing behavioral contract
  explicitly protects that behavior.
- Only the existing duplicate-run mechanism may skip CodeQL.
- Query, action, upload, and timeout failures yield a non-success CodeQL check
  and are never converted to success.
- The nine-minute timeout-minutes cap applies only to pull_request CodeQL job
  execution; push, merge_group, and workflow_dispatch use a 360-minute
  allowance compatible with measured 70–79-minute full-push scans.
- Job timeout starts after runner assignment, so skip_check dependency time,
  hosted queueing, and check propagation are not bounded by the nine-minute cap.
  Candidate acceptance measures workflow creation to conclusion.
- This issue bounds CodeQL's contribution to the umbrella path; it does not
  authorize changes to unrelated CI jobs.

## Test-first implementation plan

### RED: behavioral workflow contract

Add `scripts/tests/ci-codeql-latency.bun.test.ts` using `bun:test` and the
existing real-workflow YAML helpers. Before changing the workflow, run it and
observe failures for the absent timeout and persisted checkout credentials.

The test will verify:

- the CodeQL job timeout-minutes is an event-aware expression that caps
  pull_request at 9 minutes and all other events at 360;
- runner, dependency, duplicate-only condition, and docs-only behavior are
  unchanged;
- no job or CodeQL step uses `continue-on-error` (the no-success-masking
  contract);
- permissions remain exact and least privilege;
- checkout does not persist credentials;
- checkout/init/analyze use full pinned SHAs and retain ratchet comments;
- init remains exactly JavaScript with default queries and no custom config;
- analyze remains present at the same pinned CodeQL revision; and
- current push, pull-request, merge-group, and manual event coverage remains
  intact.

### GREEN: smallest workflow change

In `.github/workflows/ci.yml` only:

- set an event-aware `timeout-minutes` expression on the `codeql` job that
  evaluates to 9 for pull_request and 360 for all other events; and
- set `persist-credentials: false` on its checkout step.

No CodeQL path configuration, query/language change, docs gate, cache claim,
action upgrade, dependency, diagnostic subsystem, or non-blocking handling is
part of the implementation.

### Verification

1. Run the new targeted Bun test and the existing docs-only CI test.
2. Run repository workflow lint/policy checks.
3. Run the full required local verification and smoke test.
4. Complete review and classify every finding as `Blocker-Fix`, `In-scope-Fix`,
   `Reject`, or `Defer`.
5. On the final candidate head, collect at least three successful PR-event
   CodeQL executions and confirm complete under-ten-minute wall-clock verdicts.
6. Record after evidence in PR/issue comments so an evidence-only commit does
   not replace the measured candidate head, then update #2702.

## Explicit non-goals

- Moving CodeQL off pull requests or changing workflow event coverage.
- Skipping docs, tests, fixtures, generated inputs, or any other analyzed path.
- Removing/changing languages or default queries.
- Turning failures, timeouts, or skipped jobs into success.
- Adding custom CodeQL configuration, caching, diagnostics, runners,
  dependencies, reusable workflows, public abstractions, or unrelated cleanup.
- Weakening lint, complexity, safety, source-size, coverage, cross-platform, or
  CI requirements.

## Review triage

| # | Finding | Classification | Disposition |
| --- | --- | --- | --- |
| 1 | Unconditional `timeout-minutes: 9` weakened full push/merge_group/workflow_dispatch scans that take 70–79 min. | Blocker-Fix | Made timeout event-aware: `pull_request` → 9, all other events → 360. No event, language, query, upload, or failure behavior gated, skipped, removed, or weakened. |
| 2 | Plan root-cause attribution was unsupported (claimed hosted variance dominates). | In-scope-Fix | Rewrote attribution: 74m45s in local default-query evaluation; queueing/SARIF/backend not material. Added repeated push runs showing systematic long analysis. Cannot isolate remaining cause between full-event/query mode, repository workload, and hosted variance. PR uses pr-diff-range so is not a controlled comparison. Runner variance documented without claiming it dominates. |
| 3 | 9-minute scope not clarified everywhere. | In-scope-Fix | Clarified in goal, AC-2, AC-2b, and boundary cases that 9 minutes bounds pull_request CodeQL job execution only; does not bound skip_check dependency time, hosted queueing, or check propagation. Candidate-head evidence measured from workflow creation proves the under-10-minute acceptance. |
| 4 | Plan claimed failures make PR "unmergeable". | In-scope-Fix | Replaced with exact fail-closed semantics: timeout/failure yields a non-success CodeQL check and is never converted to success. No branch protection/rulesets created or changed. |
| 5 | Test rationale for `always()` was misleading. | In-scope-Fix | Removed the misleading `always()` assertion/comment. `always()` affects dependency-result execution, not whether this job's own failure is converted to success. Preserved the `continue-on-error` no-success-masking contract. |
| 6 | Optional broader action-integrity hardening. | Defer | Not implemented. Only the event-aware timeout behavior required by the findings was implemented. |
| 7 | AC-2 called the non-success conclusion a blocking verdict without branch-policy evidence. | In-scope-Fix | Replaced it with the exact bounded non-success conclusion; no branch protection or ruleset change was added. |
| 8 | Workflow comment extended the measured 70–79-minute range to unmeasured merge-group/manual runs. | In-scope-Fix | Limited the measured-duration claim to full push scans and stated separately that every non-PR event retains 360 minutes. |
| 9 | Candidate-head after evidence is unavailable before the PR exists. | Defer | Collect at least three successful, non-skipped PR-event runs on the final candidate head before completion. |
| 10 | Event-timeout tests asserted values from a local lookup table instead of the parsed workflow. | In-scope-Fix | Removed the tautological lookup table and its assertions; the remaining test pins the exact parsed GitHub expression that encodes the event condition and both timeout values. |
| 11 | A second review comment reported the same self-referential test issue at the workflow line. | In-scope-Fix | Resolved by the same removal; no local expression evaluator or parallel implementation was introduced. |
