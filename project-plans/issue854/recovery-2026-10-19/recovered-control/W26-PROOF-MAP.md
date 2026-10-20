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
