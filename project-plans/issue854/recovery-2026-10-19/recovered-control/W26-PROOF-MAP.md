# W26 summary-output proof, 2026-10-20

Implementation commit: `4e271ebf5e0c56430f037b06c8bfdb6e753ec7fe`, based on `79a870ad8`. **507 passes, zero failures/skips, 21,274 assertions in 73 serial isolated test processes; nine gates pass.** The bounded matrix runs 21 core and 14 agents files under both outer backend settings, then the three existing ordinary-JSC memory files. Each test file has its own Bun process and package working directory. All 8,799 enumerated package/script source hashes match before/after and the final worktree. No assertion, threshold, timeout, negative control, backend default or frozen oracle changed.

## Allocation and failure RED

`root-red.log` is the original actual native public-operation allocation failure: **0 pass / 2 fail**, both strategies created two `history-density-*` directories instead of the single remaining curated input owner. The implementation removes `runDiskSummary`'s output allocation, not its name. The final seven-case `summary-output-files.test.ts` runs under both outer settings: **7 pass / 0 fail / 45 assertions each**. Its full native public operation permits only one curated input rows/index pair and the existing chronology index. Its separately scoped real `prepareDisk` plus output emission creates **zero directories and zero files**. The filesystem observer covers sync/callback/promise mkdir, mkdtemp, creating open, writeFile and appendFile without filtering to one temporary root. A positive control creates real directories/files under another root. Warmed prompt-template initialization is outside operation observation, not hidden by a path filter.

`dispose-red.log` records both summary/close-fault cases rejecting the former error-masking finally: **0 pass / 2 fail**. Final cases inject a real descriptor close followed by an error at the filesystem seam. Both strategy errors now contain primary and cleanup failures, with the primary first and as AggregateError cause; live history remains unchanged. The separate earlier setup error was a wrong relative evidence directory before test launch, not a failed product run. Early type/lint failures were fixed in source/tests without changing any check: callback-open flag narrowing, required iterable contract, conditional assertion/nesting, unsafe finally throw and return-await placement.

## Behavior and bound map

| Contract                                                                                                                                                                                                                             | Final-source executions                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Real summary producers; copied rows/ordinals/values; exactly one summary and continuation; abort between pulls; summary-request leases return to zero; output-only zero creation; cross-root detector control; cleanup primary/cause | New agents `summary-output-files.test.ts`                                                                                                                                                                                                                                                                                                                                       |
| Exact original summary requests, split/rejoin, metadata and cache anchor for 512/8192 mixed rows                                                                                                                                     | Agents `middleout-disk.test.ts`, `oneshot-disk.test.ts`                                                                                                                                                                                                                                                                                                                         |
| Summary/provider cancellation, pinned inputs, queued append, middle-out no-op to one-shot, partial admission rollback and full nine-MiB preserved value                                                                              | Agents `middleout-disk-lifecycle.test.ts`, `oneshot-disk-lifecycle.test.ts`                                                                                                                                                                                                                                                                                                     |
| Held real native writer/finalization, same-writer continuation, original 512/8192 ownership bounds, object/byte rejecting controls and row-wise summary request charge                                                               | Agents `middleout-disk-publication-owners.test.ts`, `oneshot-disk-publication-owners.test.ts`, `middleout-disk-owners.test.ts`, `oneshot-disk-owners.test.ts`, `oneshot-disk-request-charge.test.ts`, `oneshot-disk-verification.test.ts`                                                                                                                                       |
| Original current-owner inheritance and density behavior through shared publication consumer                                                                                                                                          | Agents `journal-detached-owners.test.ts`, `density-disk-lifecycle.test.ts`, `density-disk-capture-owners.test.ts`; core `journalHistoryStore.detachedOwners.test.ts`, `chronology-density-stream.test.ts`                                                                                                                                                                       |
| Unpublished streamed group, backpressure, trailer-ack publication, producer/cancel/listener/ack rollback, media and cleanup failures; checkpoint/version restore and nine-MiB/512/8192 bounds and traps                              | Core `journalDetachedStream.test.ts`, `journalHistoryStore.publishDetached.test.ts`, `journalHistoryStore.detachedMedia.test.ts`, `journal-detached-no-scratch.test.ts`, `density-span-disk.test.ts`, plus both `historyStorePort.detached`, `detached-publication-shapes`, `detached-rollback-{contract,cancel,storage,scale}` and `detached-checkpoint` old/native file pairs |

These are 70 backend test executions, not 70 distinct files. Explicit old-layout contracts remain valid and named native fixtures run the real native pipeline even under the old outer environment. The compatibility `compressDisk` strategy tests intentionally supply an explicit output disk; the public middle-out/one-shot runner no longer does so. The affected graph gate is not shard execution. This is not a full package or monorepo run.

## Existing real-send retained-memory gates

All three unchanged files pass. The normal workload performs **845 requests and 89 high-density compressions**, with peak/final growth **154,174 / 75,454 bytes**, late fitted/endpoint **-115,525 / -65,542 bytes**. The original 1 MiB allowance and late accumulation bounds remain unchanged. The retaining control rejects **77,668,844 bytes**. The release control rejects its **35,929,874-byte peak** despite ending at **201,652 bytes**. Their predicates are asserted to reject, so passing control tests mean the measurement caught the retained values. This real ChatSession/Responses/default-builder workload uses high-density; it supplies shared-consumer/send regression evidence, not a new output-specific steady-state heap experiment. Output-specific scale/ownership proof is the unchanged 512/8192 and large-value strategy matrix above. Provider builder spools remain phase 6.

## Gates, source binding and process closure

Passed gates: direct declaration-only core and agents builds, existing core/agents noemit configs, agents Bun-test types, scoped lint, Prettier, affected-import graph and AST test audit. No cleanup build wrapper ran. The audit has zero findings on both new test/helper paths. `driver.ts`, `results.json`, `current.json`, `done.json`, source manifests and `acceptance-summary.json` are under `tmp/854-notes/p4/w26/output-run-b/`. Driver 27795, its shell 27794, all 82 lane children and all three retained-worker PIDs are absent: **87 recorded PIDs, zero alive**. No owned heavy task remains.

Documentation finalization independently rehashes all 8,799 source entries and all 82 execution logs, recounts test results, and verifies each changed production/test file byte-for-byte against the implementation commit. The tracked package/script diff is empty; no production mutation or pending restoration remains. `W26-SUMMARY-OUTPUT-PROOF.json` commits the exact commands, receipt/log digests, source bindings and fresh PID-absence check. The two allocation RED cases plus two error-masking RED cases are **four executed failures**; five filtered cases in the targeted error run are not skipped acceptance tests. Historical RED logs contain earlier test versions. Matching completed runs are reused without another workload, review or whole-monorepo gate.

| Binding                                    | SHA-256                                                            |
| ------------------------------------------ | ------------------------------------------------------------------ |
| `root-red.log`                             | `335480e71935072a61801105648a325633a797127a8a079b2aa3be447e26cb88` |
| `dispose-red.log`                          | `3103011da29a84d6ec4cb6e12af1829e3dde30e82b7705325a0b274ffe0b0959` |
| `results.json`                             | `6a4606b328191be99ef651fcc4d2a942e412fec09d9207caa404e979deaee6dd` |
| `source-before.json` = `source-after.json` | `82f671ae3b3d8fc7911b631b6fff3b9ae3117069d10d2bb900667f2e9f9eaac7` |
| `summaryOutput.ts`                         | `6d67ec83afd75f7650f2fa3920baad0059a75ae1b4a7ac5ca6ebdb832bdf151d` |
| `summary-output-files.test.ts`             | `7004092981f952a13dc0307f366a03e0edf6fbb951ecc13bd8003db8c108064e` |
| `operation-file-creates.ts`                | `9f86aea8db9203d718b07aea38a2bd30226a407e27761f5372de695b1bd034dd` |
| `audit/findings.tsv`                       | `a785b1fbf6a0e67bbe7f84de543fe27d75d7980fbcc40fdd1485d373b667e55b` |

W26 remains open. `W26-STATUS.md` lists curated input, chronology, density/ranking and old-only owners plus precise phase 5 normalization/phase 6 provider dependencies. No file owner's remaining allocation is relabeled as eliminated. The following proof is the earlier publication-only increment, not cumulative new acceptance. Review skipped per Andrew 2026-10-09. No push, merge, default flip, cleanup, `.llxprt` edit/staging, declaration staging or raw recovery bulk staging.

---

# W26 publication consumer proof

## Accepted result

**453 passes, zero failures/skips, 20,900 assertions in 61 accepted isolated test processes; eight gates pass.** The acceptance set contains 56 original backend executions, the two final-source no-file executions and three original memory files. The two earlier no-file executions are superseded, not double-counted. Every new-test case passes under both outer settings: nine cases/54 assertions each.

The accepted gates are direct declaration-only core build; existing core/agents `tsconfig.noemit.json`; agents `tsconfig.test-bun.json --types node,bun`; scoped lint; Prettier; affected-import graph; and AST test audit. Direct declaration emission avoids the standard build runner's cleanup path. No build configuration or exclusion changed. The audit scanned 4,474 files without scanner errors and reports zero findings on either touched test.

Fresh ordinary-JSC memory: normal peak/final growth **82,209/71,840 bytes**, late fitted/endpoint **57,312/50,817**, 845 requests/89 compressions. Retaining control rejects at **77,717,282 bytes**; release control rejects its **36,096,585-byte** peak despite ending at 135,448. Original 1 MiB allowance, late gates, 512/8192-row ownership bounds/traps and full-byte >9 MiB checkpoint test remain unchanged and pass.

Preserved setup/gate failures: the first memory invocation failed before worker creation because the supplied evidence parent did not exist. Creating that parent fixed the launch input without a workload retry. An incorrectly chosen ESLint-project `tsconfig.json` gate exposed existing excluded tests plus a readonly-array mismatch in the new test; the established `tsconfig.noemit.json` gate was recovered from W24 receipts without modifying its exclusions. The new assertion now copies its expected readonly array. Lint then rejected conditional assertions; final tests check file growth and every case's owners unconditionally, preserving exact zero-byte no-op behavior and strengthening owner coverage.

Across the matrix and memory runs, production and the span unit test remain byte-identical to final sources. The only source change after those runs is the new test's type/lint correction, with both final no-file executions rerun. `type-fix-source-bridge.json` records that one-path difference. All **8,796** package/script manifest entries match after the accepted gates. All **88 enumerated task/worker PIDs are absent**, including drivers 78231, 86198, 94035 and 97428. No mutation, pending restore or owned heavy job remains.

SHA-256 bindings:

| Source/receipt | SHA-256 |
| --- | --- |
| `densitySpanRows.ts` | `f69f7d3bb6cca4135f870eecd65770ff08df6c25a778262526f9c89e1af4d81d` |
| `density-span-disk.test.ts` | `68199fe915d464d4e8c937df29cde2719633b5dd26d60b3370d89ee2daeaf6d6` |
| `journal-detached-no-scratch.test.ts` | `a200727e1fc2ecef1a6a19205374042211850d9430a1bbd92ec9908f9a26892d` |
| `root-red.log` | `c73adffb4271eb940789d8d5c6879fb8c7b7852215b52c60c47b6e2cd6240b99` |
| `accepted-source-before.json` = `source-after.json` | `0b2aba5212cdd9d05213ccd266db87cc2e3d811b4b6aa4c8c6434974a97cb5ef` |
| `results.json` | `89e6668b9a7834320f11360429601bb6a4974027a3418a795c26f1439186cf95` |
| `continuation-results.json` | `de720e445eb1c928b54f788d0d8cdef37a2c08a8636f4d43ac1034c8f2349d7f` |
| `accepted-gate-results.json` | `8045ddc14b0434f97098a8f899943371ea9496838329eb57ed9ffff9add40ba5` |
| `audit/findings.tsv` | `a785b1fbf6a0e67bbe7f84de543fe27d75d7980fbcc40fdd1485d373b667e55b` |

This proof covers only native detached publication without density edits. It does not establish zero scratch for a complete agents compression or density operation. `W26-STATUS.md` records the remaining owners.

## Fail-first resource contract

`packages/core/src/services/history/journal-detached-no-scratch.test.ts` drives the real `JournalHistoryStore.publishDetached` consumer over a persistent native journal. Filesystem spies pass through to the actual filesystem and observe synchronous/asynchronous `mkdtemp` and creating `open` calls during the operation. They measure creation attempts, including files deleted before return. Journal creation and the process-wide scratch root are initialized before observation; neither is an operation candidate.

The original eight-case run at baseline production failed **0 pass / 8 fail** on actual resolver file creation (`root-red.log`). Successful replacement/no-op/prefix/empty/compression cases each created two `intervals` files. Producer/cancellation failure followed by continuation created three; acknowledged failure followed by continuation created four. These counts include every operation inside each observed action, not an end-directory census. The final test adds a batch-listener rejection case.

## Contract-to-execution map

All paths below are under `packages/core/src/services/history/` unless otherwise stated.

| Contract | Executable proof |
| --- | --- |
| No candidate creation; identical copied prefix writes zero; prefix/empty use one commit; divergence streams; copied tail keeps its ordinal owner's ID | New `journal-detached-no-scratch.test.ts` |
| Producer, cancellation, acknowledged hook and batch-listener rejection restore the prior version and continue on the same writer without candidate files | New `journal-detached-no-scratch.test.ts` |
| Empty collector projection preserves sorted overlapping-reason merge; close before first edit remains closed; original 512/8192 nonmonotonic sort/window behavior | `density-span-disk.test.ts` |
| Native/old output/range/token parity, replacement acknowledgement, streaming append, publication ordering | `journalHistoryStore.publishDetached.test.ts`, `historyStorePort.detached{,.journal}.test.ts`, `detached-publication-shapes{,.journal}.test.ts` |
| Backpressure, feed failure, copied-row ownership and operation ownership | `journalDetachedStream.test.ts`, `journalHistoryStore.detachedOwners.test.ts` |
| Media prepare/publish/finalize/rollback; preservation of primary and compensation failures | `journalHistoryStore.detachedMedia.test.ts`, `detached-rollback-contract{,.journal}.test.ts` |
| Cancellation; storage failure remains poisoned until reopen | `detached-rollback-cancel{,.journal}.test.ts`, `detached-rollback-storage{,.journal}.test.ts` |
| Original 512/8192-row ownership positive and rejecting object/byte traps, checkpoints and full >9 MiB row restore | `detached-rollback-scale{,.journal}.test.ts`, `detached-checkpoint{,.journal}.test.ts` |
| Density behavior and publication ownership through agents strategy callers, without changing their staging implementation | `chronology-density-stream.test.ts`; agents `middleout-disk.test.ts`, `middleout-disk-lifecycle.test.ts`, `middleout-disk-publication-owners.test.ts`, `oneshot-disk-lifecycle.test.ts`, `oneshot-disk-publication-owners.test.ts`, `density-disk-lifecycle.test.ts`, `density-disk-capture-owners.test.ts`, `journal-detached-owners.test.ts` |
| Original 1 MiB retained allowance, late accumulation gates and retaining/release traps | Agents `core/__tests__/journal-retained-growth{,-retaining-trap,-release-trap}.test.ts` |

Each backend matrix test file runs in its own Bun process from its package directory, serially, under both outer `LLXPRT_HISTORY_BACKEND` settings. Explicit-old layout contracts retain native counterparts; running a named native fixture under the old outer setting is still native proof, not additional old coverage. No old pin or fixture changed in this increment.

## Receipt boundary

Raw root: `tmp/854-notes/p4/w26/stream-run-a/`. `driver.ts`, `results.json`, `current.json`, `source-before.json` and `source-after.json` bind task commands, PIDs, outcomes and package/script source hashes. The retained-growth workers write under the same root. The matrix and scoped gates must finish before this increment is committed. Affected-graph validation is not shard execution. No full-package or whole-monorepo claim follows.

W24's qualified whole-product proof keeps its historical boundary; these ordinary-runtime ChatSession tests are separate. No threshold, assertion, timeout, default, strategy fixture or frozen wire oracle changed. Review skipped per Andrew 2026-10-09.
