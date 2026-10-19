# W22 first agents batch proof map, 2026-10-19

**The first twenty agents package files are green on journal. This document preserves that bounded proof and its later boundary-fixture increment.** Current running-package counts are in W22-STATUS.md; the first-batch 786-path remainder below is historical to that checkpoint. This is new evidence from base `b1714cdea75dd297a122b443b853bbe36b1cead5`, not restored historical proof.

Raw evidence is `tmp/854-notes/p4/w22/run-20261019-a/`, abbreviated `run/` below. Inventory and initial status were created before tests using both package runner discovery functions. No source test was excluded. All files run serially, alone in Bun, from `packages/agents`, with existing package preloads and timeouts.

## Actual failure and scoped fix

The untouched journal batch produced **143 passes and four failures** across twenty files. Both cases in `agent-carry-durability.test.ts` and both in `agent-carry-transaction.test.ts` expected admission to fail, but it succeeded. Their shared fault assumption was wrong: `SessionRecordingService.waitForCommitSequence` is a JSONL-only method. A journal candidate does not call it. These are fixture failures, not demonstrated production defects.

`helpers/carry-acknowledgement-failure.ts` selects the fault boundary by the actual backend. The old branch retains the original one-shot acknowledgement failure and original two-ack assertion. The native branch wraps real handles through `resolveJournalDependencies`, forwards positional reads/writes/vectors and platform flush unchanged, and rejects exactly the armed trailer write. It installs before candidate creation and arms after the first input row pauses. The tests also require all 512 or 8192 source rows to have been visited, a positive rejected trailer position and a different candidate pathname from the retained source.

No production code changes. No row arrays, scratch fallback, retry, skip, timeout change, default change or weakened assertion. The shared suffix fixture still uses its backend-selected real recorder factory, real HistoryService and async row observers. All source digest, token conservation, owner-release, failed-client state, source-byte-size, startup retry and client-identity assertions remain. Native candidate failure replaces old layout-specific acknowledgement mechanics only.

## Evidence boundaries

| Batch | Files/processes | Pass | Fail | Meaning |
| --- | ---: | ---: | ---: | --- |
| `initial-20` | 20 | 0 | 20 | Generated MCP declaration loader failures, before test bodies |
| `unobstructed-20` | 20 | 143 | 4 | Actual untouched journal baseline |
| `fixed-carry-journal` | 2 | 4 | 0 | First corrected fault fixture, before adding consumed-row assertions |
| `final-carry-journal` | 2 | 0 | 3 | ENOSPC during seeding; one file did not finish all cases, not fault proof |
| `final-system-carry-journal` | 2 | 4 | 0 | Final changed tests on journal |
| `final-system-carry-old` | 2 | 4 | 0 | Same final tests, explicitly old comparison; not native proof |
| `retaining-system-trap-journal` | 1 | 0 | 4 | Expected rejection with the unchanged retaining trap enabled |

No skips in completed case runs. The old/trap launches immediately after ENOSPC failed to create their output directories and spawned no test child; they are not counted as executed tests. The first nested-background shell launch also exited before a driver started; it contributes no test execution.

The generated MCP obstruction was individually verified ignored and moved intact to `run/held-generated/mcp-dist`, with ignore, inode and hash records. The ENOSPC cause was external-volume capacity, about 298 MiB free while the system volume had 104 GiB free. No files were deleted or truncated. Subsequent test HOME/TMPDIR roots are unique under `/private/tmp/llxprt-w22-branch3-20261019-99211/`; raw logs, JUnit, commands, PIDs and inventories remain in the workspace. This changes test isolation placement only, not production storage behavior.

## Current package accounting

Take unchanged-file results from `unobstructed-20` and the two changed-file results from `final-system-carry-journal`. This yields **147 passing cases in twenty distinct files, zero current failures/skips**. It is cumulative per-file proof, not one twenty-file final-source rerun. `run/accounting.json` preserves every executed JUnit case name and selected source hash. `run/not-run.txt` contains all 786 pending paths.

Of 147 passes, **26 are native history contracts** in the carry and public-reader suites below. The other **121 are journal-selected shared/public cases**; they are not counted as native history-specific coverage. There are zero explicitly old-only cases in these twenty package files. Four supplemental old executions verify the changed tests under old and remain separate.

All table paths are relative to `packages/agents/src/api/__tests__/`.

| File | Native history | Shared/public | Final journal PID |
| --- | ---: | ---: | ---: |
| `activation-media-owner-lifetime.behavior.test.ts` | 0 | 2 | 2017 |
| `activation-preflight-cleanup-failure.behavior.test.ts` | 0 | 2 | 2115 |
| `activationPreflightState.behavior.test.ts` | 0 | 22 | 2271 |
| `adoption-binding-failure.behavior.test.ts` | 0 | 1 | 2574 |
| `adoption-scheduler-owner.test.ts` | 0 | 2 | 2692 |
| `agent-bootstrap.spec.ts` | 0 | 37 | 2959 |
| `agent-carry-durability.test.ts` | 2 | 0 | 32713 |
| `agent-carry-faults.test.ts` | 6 | 0 | 3965 |
| `agent-carry-media.test.ts` | 1 | 0 | 7232 |
| `agent-carry-owner-controls.test.ts` | 4 | 0 | 7301 |
| `agent-carry-stream.test.ts` | 5 | 0 | 9326 |
| `agent-carry-tokens.test.ts` | 2 | 0 | 10408 |
| `agent-carry-transaction.test.ts` | 2 | 0 | 33156 |
| `agent-history-reader.test.ts` | 4 | 0 | 13830 |
| `agent-safe-boundary-coordinator.behavior.test.ts` | 0 | 7 | 15061 |
| `agent.approvalMode.behavior.test.ts` | 0 | 5 | 15227 |
| `agent.sequenceModel.behavior.test.ts` | 0 | 7 | 16446 |
| `agent.settings.behavior.test.ts` | 0 | 16 | 16648 |
| `agentAdmission.owner.behavior.test.ts` | 0 | 16 | 19769 |
| `agentMessageBus.behavior.test.ts` | 0 | 4 | 20058 |

The 26 native cases cover: failed final acknowledgement and conserved prior tokens/rows at both scales; source/abort/startup faults and retry; referenced-media/signature/cache/provider metadata; reference/copy retaining controls; bounded streaming, paused source/output snapshots and a 9 MiB single row; mixed-block token counts; unchanged durable source and successful retry; scoped public readers at both scales with active/deferred histories. Existing 180000 ms bounds, 512/8192 inputs, owner limits and negative controls are unchanged.

## Gates and next scope

All eight gates passed in `run/gates-a/`: API surface, declaration build, agents no-emit types, agents Bun types with installed Bun ambient types, three-path zero-warning lint/Prettier, affected graph and AST audit. Core source is unchanged, so this increment does not add a separate core tsc requirement. The captured source boundary contains 3317 TypeScript files across agents/core/test-utils. Final comparisons and gate results will be recorded in W22-STATUS.md.

Next package paths start with `agentUnconfigured.behavior.test.ts`, `apiSessionControl.characterization.test.ts`, `app-service-boundary.spec.ts` and `app-service.spec.ts`; then the async-child files. The full pending inventory includes the existing W11/W17 native runtime suites and all seven `test-bun` files. No affected-graph gate substitutes for their execution.

W23-W26 and later phases remain separate. W26 scratch-candidate removal remains required within the PR. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup command, `.llxprt/` edit or broad recovery staging.

## Boundary fixture increment and continued sweep

`package-next-20` completed sixteen of its twenty selected files before stopping at the first failure. Fifteen files passed; `boundary.adequacy.test.ts` was four pass/one fail because `session-package-export.test.ts` imported `core/src/recording/__tests__/support/backendEnv.js`. The guard was unchanged. Commit `f518c3a7c016b8e99237dc963531413ed7e4742b` switches only backend lifetime wiring to the existing agents helper, retaining both old/native export bodies. `export-assertion-proof.json` proves all fifteen assertion ASTs identical. `fixed-boundary-export` has five guard passes, one native export pass and one old export pass.

The resulting first 37-file map is 264 passes: 27 native history, 236 shared/public and one explicit old with its native counterpart RUN. `accounting-after-boundary.json` preserves exact case names, source hashes and PIDs. The old comparison carry reruns stay separate. All eight four-path gates pass in `gates-b/`, and all 3317 source hashes plus four committed code blobs match tested bytes. The export scan retains the same three SELF_CONFIRMING and one DUP_ASSERT notices found in gates-a before this edit; no new finding or suppression.

`package-36-55` subsequently passed all twenty selected files. A serial pending-path supervisor now continues twenty-file batches and stops on the first failure, without retries. Current execution-only additions have pending native/shared/old case classification, reported separately in W22-STATUS.md and `current-progress.json`. They are not silently counted as native history contracts. The full inventory includes W11/W17 native runtime regressions and test-bun meta suites; all still require current W22 execution/accounting before closure.
