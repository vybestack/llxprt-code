# Issue 2861 Delivery Plan: OCR Checkpoint Completeness

Plan ID: PLAN-20260730-ISSUE2861
Base: `origin/main`
Issue: https://github.com/vybestack/llxprt-code/issues/2861

## Policy provenance

`dev-docs/workflow/ISSUE-DELIVERY.md` is not present on the candidate base after synchronizing `main`. This plan applies the bounded issue-delivery policy supplied with the issue request directly. `dev-docs/RULES.md` governs test-first development and behavioral evidence.

## Problem and chosen design

The post-review step already reads OCR preview output into one selected path list and uses it for the reviewed-range manifest and coverage report. Checkpoint advancement and persistence instead use the broad nondeleted Git-range file count. Preview-ineligible paths can therefore prevent a fully completed OCR scope from advancing.

The bounded implementation will:

- define one normalized, immutable preview-eligible path array from `ocr-selected-files.txt`;
- use that array for manifest selection/completion, coverage, the checkpoint denominator, and the checkpoint's auditable eligible path set;
- retain `rangeMetadata.cumulative` and `rangeMetadata.selected` only as broad Git-range observability;
- require a finite, positive eligible count and exact completed-count equality, so missing, malformed, partial, or drifted evidence cannot advance;
- preserve every existing non-coverage advancement gate.

The checkpoint will keep numeric `selected_files` for compatibility and add `eligible_files` containing the exact preview-eligible path array. No schema-version change is needed because checkpoint readers ignore additive fields and existing schema-1 checkpoints remain valid.

## Decision-complete acceptance matrix

| ID | Given | When | Then | Evidence |
| --- | --- | --- | --- | --- |
| A1 | The Git range and OCR preview each contain the same eligible paths | OCR succeeds with exact completed count and complete publication | the checkpoint advances and persists the eligible count and exact path set | checkpoint behavior and wiring tests |
| A2 | The Git range has 4 nondeleted paths but preview selects 3 eligible paths | OCR exits 0, reports 3 reviewed files, the 3/3 manifest is complete, and publication is complete | the checkpoint advances using 3 as its denominator | regression fixture and wiring test |
| A3 | Git-range paths are deleted, unsupported, generated, excluded, or otherwise preview-ineligible | preview omits them | they remain observable in broad range totals but do not inflate required OCR coverage | regression fixture and metadata wiring tests |
| A4 | Preview selects no eligible paths | the review evidence is otherwise successful | the checkpoint does not advance | checkpoint behavior test |
| A5 | Preview selects N paths but OCR reports fewer or more than N completed paths | checkpoint advancement is evaluated | the checkpoint does not advance because the scope is partial or drifted | checkpoint behavior tests |
| B1 | Preview evidence is malformed or absent | post-review evidence is evaluated | no positive eligible denominator can be established and the checkpoint does not advance | normalization/wiring and existing failure tests |
| B2 | OCR did not run, exits nonzero, has infrastructure/policy failure, failed findings, partial/failed completeness, synthesized output, or ambiguous/partial/failed publication | advancement is evaluated | the checkpoint does not advance | existing parameterized checkpoint tests |
| B3 | OCR preview succeeds and produces an eligible path list | manifest, coverage, advancement, and persistence are built | all four consume the same immutable normalized array or its exact length | wiring and path-set behavior tests |
| C1 | A checkpoint advances | it is embedded and serialized | `selected_files` is the eligible count and `eligible_files` is the exact auditable eligible path set | checkpoint serialization/wiring tests |
| C2 | A prior schema-1 checkpoint lacks `eligible_files` | it is deserialized and checked for ancestry | existing checkpoint compatibility remains unchanged | existing round-trip/ancestry tests |
| D1 | Broad selected/cumulative Git-range file and line totals exist | metadata and summary are built | those totals remain present as observability and are not used as checkpoint coverage | metadata and workflow wiring tests |

## Accepted review finding triage

| Finding | Classification | Disposition |
| --- | --- | --- |
| 1. Advancement independent of manifest completeness | **Blocker-Fix** | Require terminal manifest completeness, validated preview evidence, eligible completion length, and strict OCR count equality in one decision. Missing, malformed, warning, partial, or drifted evidence is fail-closed. |
| 2a. Stale infrastructure-failure read | **In-scope-Fix** | Re-read the infrastructure-failure artifact immediately before checkpoint decision construction so coverage or manifest persistence failures from the same post step block advancement. |
| 2b. Publish checkpoint only after later redaction/hash/upload steps | **Defer** | Valid lifecycle concern, but it requires a pre-existing multi-step architecture redesign outside the bounded denominator/evidence issue. No workflow job or final-step lifecycle redesign is implemented here. |
| 3. Preview cardinality tolerance | **Blocker-Fix** | Parse the declared `Will review (N):` count, normalize and deduplicate extracted paths, and require exact nonnegative safe-integer cardinality before success evidence or selected-path persistence. Extraction failure uses the existing preview infrastructure-failure path. |
| 4. Coercible `files_reviewed` | **Blocker-Fix** | Accept only a raw nonnegative safe integer, preserve numeric metadata compatibility with a zero fallback plus explicit validity state, and gate manifest completion and advancement on validity. |
| 5. Missing cohesive behavioral fixture | **Blocker-Fix** | Exercise extracted workflow functions end-to-end from preview normalization through OCR validation, eligible completion, manifest completeness, decision, checkpoint construction, serialization, deserialization, and metadata observability. Keep only minimal YAML wiring checks for data-flow ordering. |

Local OCR run `20260730T164102Z-0a3f48d7` completed with `complete_best_effort` coverage and one Low finding:

- **In-scope-Fix:** remove the extra blank line between adjacent workflow helper functions. Fixed; no behavioral or scope expansion.

### Remediation RED evidence

Before the remediation production edits, the targeted test command failed because `previewSelectionFromOutput` was absent, the checkpoint decision still consumed raw OCR completion instead of eligible completion and terminal manifest evidence, and infrastructure failure was not re-read after manifest persistence. This RED run is retained in the delivery report; the same targeted suite must be GREEN before completion.

## Explicit non-goals

- Changing OCR preview eligibility rules, include/exclude configuration, generated-file detection, or deletion handling.
- Changing upstream OCR counting, OCR version/provider behavior, or accepting coercible `files_reviewed` values; the local workflow only validates the raw external field fail-closed.
- Changing coverage warning thresholds, finding routing, publication lifecycle architecture, range selection, or checkpoint ancestry.
- Backfilling `eligible_files` into historical checkpoints or changing checkpoint schema version.
- Adding a digest when the exact auditable path array is persisted.
- Adding dependencies, public APIs, reusable public abstractions, workflow jobs, quality-tool changes, agent-memory changes, lint/complexity/coverage weakening, or CI gate changes.
- Moving tests, unrelated refactors, cleanup, telemetry redesign, or optional hardening.

## Bounded test-first vertical slices

### Slice 1: advancement denominator and drift

RED: extend checkpoint behavior fixtures for 4 broad/3 eligible success, zero eligible files, fewer completed files, more completed files, and malformed completed evidence.

GREEN: require finite exact equality between completed files and the positive preview-eligible denominator while preserving all existing gates.

### Slice 2: one immutable preview-eligible set

RED: add workflow/path-set tests proving normalization and that manifest, coverage, checkpoint decision, and persisted checkpoint all consume the preview-derived set rather than `rangeMetadata.selected.files`.

GREEN: define the immutable preview-eligible array once and replace all selected-list checkpoint wiring with that array or its length.

### Slice 3: auditable persistence and observability separation

RED: assert advanced checkpoint data stores the exact eligible array while broad Git-range totals remain in summary/metadata observability.

GREEN: add the exact `eligible_files` array to checkpoint persistence, retain the eligible numeric count, and leave broad range metadata unchanged.

Production changes must follow a failing behavioral or workflow contract test. Existing blocking-state tests remain required evidence and must not be weakened.

## Expected paths

Planned new file:

1. `project-plans/issue-2861-ocr-checkpoint-completeness.md`

Planned modified files:

2. `.github/workflows/ocr-review.yml`
3. `scripts/tests/ocr-review-incremental-checkpoint-b.test.ts`
4. `scripts/tests/ocr-reviewed-range-manifest-wiring.test.ts`
5. `scripts/tests/ocr-review-coverage-preview.test.ts`
6. `scripts/tests/ocr-telemetry-workflow.test.ts`
7. `packages/tools/src/utils/imageResize.ts` — pre-existing TS2322 type-narrowing defect on origin/main (PR #2865) that blocked repository-wide typecheck, test, and build gates. Bounded CI-unblocking fix authorized by the issue-delivery scope policy. The fix adds a `typeof` guard before the `Number.isInteger()` call so TypeScript narrows `number | undefined` to `number` without assertions or suppressions.

The two additional existing tests are directly coupled to the preview-selected-file behavior changed by this issue and must validate the fail-closed parser and selected-file persistence rather than the removed fail-open shell source shape. Any additional production path, workflow file, subsystem, dependency, public abstraction, unrelated test move/refactor, or behavior outside this matrix requires approval.

## Scope ledger

| Category | Planned net lines | Actual net lines |
| --- | ---: | ---: |
| Plan | 145 | 162 |
| Workflow production | 35 | 101 |
| CI-unblock type-narrowing fix | 5 | 5 |
| Behavioral/workflow tests | 180 | 274 |
| Total (7 expected files) | 365 | 542 |

Budget and stop rules:

- Target: no more than 25 files or 1,500 net changed lines.
- Mandatory scope review above either target threshold.
- Hard stop without approval above 40 files or 2,500 net changed lines.
- All generated or incidental tracked changes count; no changes under `.llxprt/` are permitted.

## Review triage contract

Every DeepThinker, OCR, CodeRabbit, CI, and human finding will be classified as exactly one of:

- **Blocker-Fix**: required accepted behavior, correctness, safety, architecture, or delivery gate cannot complete without it.
- **In-scope-Fix**: valid and contained within this matrix and scope ledger.
- **Reject**: factually incorrect, already covered, or harmful to accepted behavior.
- **Defer**: valid but outside this issue's matrix; it is not implemented in this PR.

Reviewer suggestions do not authorize scope expansion. At most two local OCR and two PR OCR reviews may run for this effort.

## Approval stops

Stop before:

- adding an unplanned subsystem, dependency, public abstraction/API, workflow file/job, agent-memory change, quality-tool change, or CI/lint/complexity/coverage policy change;
- implementing behavior outside A1-D1;
- moving an unrelated refactor or test into scope;
- exceeding the target budget without a scope review or exceeding the hard budget without approval;
- weakening existing architecture, TDD, safety, cross-platform, source-size, or verification requirements.

## Required gates and exact-head completion

The candidate head is complete only when:

1. Every acceptance row has behavioral evidence on the exact head.
2. Targeted tests and `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, and `npm run build` pass.
3. The prescribed llxprt smoke test passes.
4. DeepThinker and local OCR reviews are complete within limits; every finding is classified; every Blocker-Fix and In-scope-Fix is resolved.
5. The exact committed head is pushed; CI and bounded PR reviews pass; CodeRabbit threads are evaluated, answered, and resolved.
6. `git merge-base --is-ancestor origin/main HEAD` succeeds, GitHub reports the PR conflict-free, and the final scope ledger reconciles cleanly.
7. No forbidden suppression, weakened gate, optional cleanup, or out-of-matrix change is present.

Stop successfully at that point. Do not continue optional hardening or cleanup.