# W21 exact replay contracts, new evidence 2026-10-19

Verified starting revision: `529a4abf59a4e72cde1cecbf7164949f94591208`. Implementation and tests: `88dd7f8f00ab3c7e1c6e005673ff001ea25c3aa3`; `commit-proof.json` verifies all six committed source blobs against tested SHA-256 values. This increment covers the exact generated/reference-media/unstamped replay remainder. W21 remains partial for the discovery inventory. Historical deleted proof logs remain missing; all evidence described here was generated in this run.

## Production defect and fix

The public native equal-text test found [#3900](https://github.com/vybestack/llxprt-code/issues/3900). After resuming two genuinely unstamped disk rows, rebuilding them and appending a new equal-text row, chronology was `[1, 2, 1]` instead of `[1, 2, 3]`. The unchanged-production native process PID 72969 exited one with one pass and one failure; old PID 72787 passed both then-present cases. The exact RED is `formatted-contracts/journal-src_recording_recording-exact-identity-replay.test.ts.log` under the raw evidence root below.

`HistoryServiceCore` constructed `detachedValues` with the constructor's chronology object. Resume installs a new chronology object, but detached replacement continued to stamp the old object while ordinary append used the adopted object. The two counters could overlap. `createDetachedHistoryAPI` now receives a getter, and both host chronology access and snapshots use the service's current stamper. This also handles the existing candidate-resume swap without repairing individual callers. The additional public marked-resume case proves rejection restores the counter, then append/rebuild/append allocate 43/44/45 and survive another resume.

Only `HistoryServiceCore.ts` and `detachedHistoryAPI.ts` change production behavior. No production history array, fallback, operation file, spool, extra whole-file pass or backend-default change is introduced.

## Original 25-case map

The complete original `RecordingIntegration.replay.test.ts` and original compressionBoundary13 were read before edits. `inventory.md` retains the pre-edit enumeration; part-three's original map remains unchanged. Existing counterparts below are run rather than copied. All original 25 replay cases and assertions remain unchanged and explicitly old.

| Original case | Exact coverage and boundary |
| --- | --- |
| r01 expected length | Existing native-core addition and native-replay complete row sequence. |
| r02 inline media | Existing native-replay full inline row. It is separate from reference-media proof. |
| r03 real reference verification/no replay reservation | New native-media suite uses actual LocalMediaStore-admitted references, verifies original bytes and repeated public resume, and transfers reservations only on adoption. |
| r04 summary/post compression | Existing native-core and adopted native-replay membership. New generated compression extends it. |
| r05 session_event separate from history | Old sessionEvents remain format-specific. Existing native-lifecycle proves debug output and unchanged journal. |
| r06 latest provider/directories | Existing deterministic lifecycle and new generated metadata through two public resumes. |
| r07 eventCount versus JSONL lines | Old layout only; do not invent binary line count. Native independent row trees prove membership. |
| r08 final JSONL seq | Old layout only; existing native-boundary trailer acknowledgements are the native boundary. |
| r09 no idle file | Existing native-lifecycle idle attachment/no materialization. |
| r10 80000-character row | Existing native-replay full row, unchanged size. |
| r11 fifty rapid additions | Existing native-replay full order and values, unchanged count. |
| r12 stable path across flushes | Existing native-replay and new generated two-segment path/row/resume comparisons. |
| r13 arbitrary list length | Existing native-replay eight samples, 1..12 rows. |
| r14 arbitrary list order | Same existing exact row-sequence property. |
| r15 provider/model generated | New eight fixed samples, original provider/model regex domains, persisted metadata after two resumes. |
| r16 directories generated | Same eight samples, original 1..5 directory domain, exact order after two resumes. |
| r17 generated session_event count | JSONL event-log count remains old-only; existing native-lifecycle debug/output boundary is run. |
| r18 generated compression membership | New eight pre/post samples with original 1..8 / 0..8 lists and 1..12-character strings, compress adopted history and resume exact summary/post order. |
| r19 generated JSONL line count | Old-only, as r07. |
| r20 generated maximum JSONL seq | Old-only, as r08. |
| r21 latest history subscription | Existing native-core subscription switch and native-boundary populated handover. New origin test additionally rebinds a selected-origin recorder to a distinct service. |
| r22 no post-disposal recording | Existing native-faults and native-lifecycle disposal boundaries. |
| r23 generated flush segments | New eight original-domain first/second lists, 1..6 entries of 1..10 characters; stable file and exact complete membership through two resumes. |
| r24 random large text | New six fixed 1000..5000-character samples, original minimum and run count. Existing 80000-character case is retained separately. |
| r25 compressed size | New eight original-domain 1..500 counts and 1..24-character summaries, exact prior cardinality and summary/post membership after resume. Native has no compressed-event payload; the original JSONL payload assertion remains. |

Original compressionBoundary13 now has an exact counterpart: raw-seed two distinct equal-text unstamped disk rows without HistoryService admission, public resume/adopt/subscribe, rebuild once, append a genuinely new identical-text row, rebuild again, then resume twice. Native rows initially remain unstamped; old adoption stamps them by its existing contract. The resulting three native labels are distinct, chronology is 1/2/3, and complete row bytes survive later resumes. No value-based deduplication is introduced.

## Fixed inputs and independent oracles

The generated suite uses fixed fast-check seeds 8542115 (eight metadata/segment tuples), 8542118 (eight pre/post compression tuples), 8542125 (eight compression-size/summary tuples) and 8542124 (six minimum-large-text strings). All domains and iteration counts match the original cases. Sampled counts include 306, 6, 497, 194, 496, 7, 91 and 495. Expected input rows carry fixed chronology and alternating chronology-key positions. Each backend receives a fresh clone of the same input; fixture `input.json` files retain the actual vectors. No immutable golden is regenerated or generator size reduced.

The outer backend setting selects the shared generated/unstamped/rollback fixtures. The native origin and media suites deliberately use native objects under both outer settings. JSONL discovery reads the process backend; passing an unrelated explicit resume environment is insufficient for a mixed fixture. That test-input mistake was corrected without changing production selection or defaults.

Full row structural equality is accompanied by exact UTF-8 JSON buffer equality, including metadata insertion order. Native disk oracles independently open the positional file, walk the CRC-checked row tree and resolve numeric owner IDs from the persisted owner dictionary. Equal numeric IDs after initial mirror seed are expected. Rebinding the same recorder to a service with different owner allocation proves an actual numeric remap while preserving origin strings, complete row bytes and foreign-row exclusion. The metadata-order control passes structural equality and fails the serialized-buffer assertion.

## Reference-media transaction boundary

The new media suite admits actual small binary blobs into LocalMediaStore. Resume boot reads verify the reference and original bytes without retaining reservations. HistoryMediaOwnership acquires reservations on adoption. Integration disposal leaves them owned by the live history; history disposal and ownership settlement release them. Another resume repeats the transition without row duplication.

Four failure cases exercise a held real positional read, failure on the second reference reservation, a throwing publication listener and a throwing after-publication callback. The held case independently observes prior durable rows and synchronous service accounting without attempting a public read that correctly waits for adoption. Errors preserve the prior path, complete rows, token/context state, recorder membership and old-media reservation; partial new reservations are released. An append after rejection proves the previous recorder remains usable. A later successful adoption releases old media and owns the new references; final disposal releases both. The media reservation failure controls only the external store boundary, not the adoption or ownership implementation. Successful I/O retains the actual platform full flush.

## Development failures kept separate from product RED

The first counterpart run failed before load because Bun executed an ignored test-utils declaration file. Only that verified ignored, untracked, nonsymlink directory was moved intact to a unique held path. Declaration build regenerated another directory, also individually verified and held intact. Their recorded inodes are 396533907 and 396746782. No directory contents were deleted.

Earlier generated tests attempted both fixture backends inside one process, contrary to discovery's process backend. Initial identity expectations assumed old adoption left rows unstamped and that initial mirror seed remapped owners; the fixture now distinguishes the actual contracts and performs a real rebind. An unadopted native primary initially filtered its owned rows, corrected by the public adoption route. None of these is called a production defect.

The pending-media test initially awaited Bun's rejection matcher before it could release the read gate, and another pending assertion tried a public read that joins the held mutation. A nonblocking promise outcome observer and independent disk observations fix the fixture. Only exact recorded blocked child PIDs were stopped, with SIGTERM, and logs remain. Reservation checks initially ran after closing LocalMediaStore; final checks occur before close. Initial lint/type/oracle attempts remain separate from final proof. No assertion threshold, generator bound, test timeout, scanner policy or production guarantee was weakened.

Initial AST audit notices classified before/after path, disk and accounting comparisons as self-confirming. Final assertions compare the complete named before/after state structurally with the same exact fields and values. Duplicate-assert notices refer to distinct lifecycle phases. Audit policy is unchanged.

## Evidence and scope

Raw evidence root: `tmp/854-notes/p4/w21/exact-replay/run-20261019-a/`; actual fixture directories remain under the sibling `fixtures/`. Final process, gate, control and source-hash tables follow below; `input-proof.json` retains all 30 paired sample hashes and paths. Final declaration build leaves its generated outputs intact after the already-completed test matrix; no further runtime import or directory movement is needed.

W21 remains partial for wider unreadable-session/directory-scan/resume-identity/extension/checkpoint/fork/janitor inventory beyond previously bounded proofs. This increment supplies no full-package, affected-shard execution or monorepo closure. W23 send/planning-envelope and W24 whole-product/write-amplification/topology requirements remain separate. W22-W26 and later work remain; W25's default flip is not authorized. Review skipped per Andrew 2026-10-09. No OCR, push, merge, cleanup/deletion command, `.llxprt/` edit, pattern kill or raw recovery staging is part of this increment.

## Final executed proof

Final matrix: **48 serial isolated Bun processes, 492 pass, zero failures and zero skips, across 24 files**. Every file ran alone from packages/core under outer old and journal. The new suites contribute 76 case executions; native-only cases run under both outer environments. All 1848 core TypeScript source hashes match the final worktree, and the six staged source blobs match their tested hashes.

| File | old pass / PID | journal pass / PID |
| --- | --- | --- |
| src/recording/recording-exact-generated-replay.test.ts | 30 / 84794 | 30 / 86107 |
| src/recording/recording-exact-identity-replay.test.ts | 3 / 85050 | 3 / 86154 |
| src/recording/recording-exact-media-replay.test.ts | 5 / 85091 | 5 / 86164 |
| src/recording/RecordingIntegration.replay.test.ts | 25 / 85210 | 25 / 86181 |
| src/recording/RecordingIntegration.compressionBoundary.test.ts | 13 / 85247 | 13 / 86191 |
| src/recording/recording-integration-native-core.test.ts | 19 / 85261 | 19 / 86207 |
| src/recording/recording-integration-native-replay.test.ts | 8 / 85272 | 8 / 86214 |
| src/recording/recording-integration-native-lifecycle.test.ts | 14 / 85296 | 14 / 86227 |
| src/recording/recording-integration-native-ownership.test.ts | 2 / 85382 | 2 / 86234 |
| src/recording/recording-integration-native-boundary.test.ts | 14 / 85390 | 14 / 86237 |
| src/recording/recording-integration-native-faults.test.ts | 6 / 85406 | 6 / 86251 |
| src/recording/journalResumeAdoption.test.ts | 8 / 85420 | 8 / 86257 |
| src/recording/journalResumeAdoption.detach.test.ts | 2 / 85429 | 2 / 86264 |
| src/recording/journalResumeAdoption.bound.test.ts | 15 / 85433 | 15 / 86270 |
| src/services/history/detached-publication-shapes.journal.test.ts | 12 / 85446 | 12 / 86272 |
| src/services/history/HistoryService.replaceAll.test.ts | 4 / 85452 | 4 / 86282 |
| src/services/history/HistoryService.chronology.test.ts | 16 / 85461 | 16 / 86291 |
| src/services/history/detached-rollback-contract.test.ts | 13 / 85467 | 13 / 86302 |
| src/services/history/detached-rollback-contract.journal.test.ts | 9 / 85496 | 9 / 86315 |
| src/services/history/detached-checkpoint-serialization.test.ts | 1 / 85524 | 1 / 86328 |
| src/services/history/detached-checkpoint.journal.test.ts | 4 / 85534 | 4 / 86333 |
| src/services/history/historyStorePort.profileReplacement.test.ts | 16 / 85779 | 16 / 86396 |
| src/services/history/detached-rollback-cancel.journal.test.ts | 3 / 85788 | 3 / 86400 |
| src/services/history/detached-rollback-storage.journal.test.ts | 4 / 85798 | 4 / 86408 |

Each positive process exited zero. Commands are bun test followed by the listed file, with LLXPRT_HISTORY_BACKEND set to the column backend. final-tests/matrix.json retains full commands indirectly through the fixed runner, absolute logs and all source hashes; final-tests/source-hashes.json retains the source census. The drift guard below validates the graph, not affected-shard execution.

| Final gate | PID | Exit |
| --- | --- | --- |
| build-types | 88132 | 0 |
| core-tsc | 89480 | 0 |
| core-runner-tsc | 90741 | 0 |
| touched-tsc | 90747 | 0 |
| eslint | 90825 | 0 |
| prettier | 91013 | 0 |
| affected-graph | 91020 | 0 |
| audit | 91114 | 0 |

AST audit: zero touched high-risk findings; 9 duplicate-assert notices compare distinct pre/post or disposal phases. Exact notices are retained in summary.json. No scanner rule changed. The fixed-input comparison proves all 30 sample vectors are byte-identical across both backends and all preserved fixture generations; input-proof.json retains hashes and paths.

| Rejecting control, full file | PID | Pass | Fail | Exit |
| --- | --- | --- | --- | --- |
| stale-chronology | 84490 | 1 | 2 | 1 |
| foreign-origin-leak | 84510 | 2 | 1 | 1 |
| omitted-media-rollback | 84528 | 1 | 4 | 1 |
| metadata-order-loss | 84555 | 1 | 29 | 1 |

All four controls use the journal environment and full test files without filtering or skips. controls/results.json retains original, mutated and restored SHA-256 values; every restored hash equals its original. The three sources not in the production fix remain equal to HEAD.

| Staged tested source | SHA-256 |
| --- | --- |
| packages/core/src/services/history/HistoryServiceCore.ts | e694bf1c49877f432fcd09fb33f204a03c9515a1e69f22d774485853320c7289 |
| packages/core/src/services/history/detachedHistoryAPI.ts | 9b1454aadfe3bff456254be8e387a8a3ae0a57e7e634c9889c63c5edfdedd1e0 |
| packages/core/src/recording/recording-exact-generated-replay.test.ts | c6cfc8c96a60e8fb7c3943ea72661f376ec104e4536934e71f339c6c7effe243 |
| packages/core/src/recording/recording-exact-identity-replay.test.ts | d6cada3b58cb710e768173b73250529510eab04ebe37a5b5d52870f52ff33fdb |
| packages/core/src/recording/recording-exact-media-replay.test.ts | 8198695f508aaa3c0d6540fabe69161034d7fa48c75f5b097031a21d861343ac |
| packages/core/src/recording/__tests__/support/exact-replay-fixture.ts | b86e3e82c7ecde5ddd617cdb5a0883e40914f570216dc4979099fd2946a98ea2 |

summary.json checks 113 distinct recorded child/supervisor PIDs, including the three explicitly stopped blocked fixture children; all are absent. Managed task completion is separately checked by the primary tool. These are new proof artifacts, not recovered historical raw logs.
