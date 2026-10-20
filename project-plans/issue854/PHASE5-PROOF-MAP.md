# Phase 5 proof map

## Current native Mistral increment

Starting HEAD `2bba0b8e3`; implementation `819ca78dbeac092dfea8ad4e165ee17ebd4b3a90`. [PHASE5-MISTRAL-PROOF.json](PHASE5-MISTRAL-PROOF.json) binds 16 committed source/test paths and 8846 package/script hashes. Acceptance: **110 isolated serial processes over 55 files, 856 passes, 933836 assertions, zero failures or skips**, both outer backends, unchanged 180000 timeout, eight passing scoped gates. 302 recorded PIDs are absent; none live.

Native mapping-only slot fills now maintain namespace 3 and raw-ID-owned mappedRef VALUEs with retained salts. Append, reconstruction, density/removal rebuild, insertion, pop across activation, empty-prefix pop, reopen, owner, fork and compaction are covered against the existing tools mapper. The 160 new collision-heavy comparisons supplement the unchanged 5000-case normalized unit/occurrence/rank/count/pending corpus and frozen provider fixtures.

The wrong-salt and wrong-raw-reference controls fail actual mapping/corruption assertions. The retained-all-ID control fails the unchanged <150 response-append read bound at 14193 reads. All restore byte-identically before final acceptance. This is read-budget evidence, not heap proof. One repeated pinned-mapping assertion spans before/after mutation and remains; no prohibited touched audit finding is accepted.

This proves native assignment rather than the older hand-populated library/copy fixtures. It does not prove Kimi emitted bookkeeping, Mistral tail/lazy continuation, normalized request-only tail queries, format/settings/LENS, provider cutover, full retained heap or range CRC closure. W26, W23's eight planning/header cases and W25/default remain open. See [PHASE5-STATUS.md](PHASE5-STATUS.md) and [PHASE5-MISTRAL-DECISIONS.md](PHASE5-MISTRAL-DECISIONS.md). Review skipped per Andrew 2026-10-09.

## Historical normalized occurrence increment

Starting HEAD `4e23b8fdc`; implementation `9235a4420ad49bd9a15ce104c83a9de2c15781f6`. [PHASE5-OCCURRENCES-PROOF.json](PHASE5-OCCURRENCES-PROOF.json) binds 17 committed product/test paths and an 8606-entry tracked package/script source inventory. Acceptance is **102 isolated serial processes over 51 files, 708 passes, 931526 assertions, no failures or skips**, with both outer backends and explicit `--timeout 180000`. Six scoped gates pass. All 229 recorded child/driver PIDs are absent.

Native namespace 1/2 counts and `(label, part, unit)` occurrence positions now follow emitted normalized units. The new 5000-case differential derives expectations from unchanged old-normalizer output and preserves frozen input/output hashes. Request-tail fixture rows are persisted as equivalent curated rows for this test; normalized request-only tail query overlays remain unproved. Existing indexed count/readAt/pending differentials remain exact.

Named native evidence covers reconstructed duplicate calls, empty/prefix collisions, results attached to human/tool targets, cross-speaker orphan completion, old pins, removal rebuilds, long colliding-ID suffix insertion and later best-response selection. The native lifecycle matrix now compares persisted lists through pop, owner/fill, purge, density, compression, clone and compaction. Existing id-fact, journal/model, history and copy/Mistral regressions pass. Library Mistral remapping tests do not establish native mapping assignment.

Wrong-normalization and omitted-R1 controls fail literal position assertions. A history-wide retained-ID-map control fails the unchanged append read budget at 13779 versus `<150`. Every target is restored with `cmp`, followed by final serial acceptance. The map control proves read-budget rejection, not the outstanding retained-heap claim. Two existing `DUP_ASSERT` audit findings span different state/measurement boundaries; no prohibited touched findings remain.

File version 5 refuses CRC-correct version-4 journals whose normalized lists were absent, with no migration or layout-width change. Initial media-fixture/type and twelve lint failures remain preserved separately from acceptance. Raw receipts: `tmp/854-notes/p5/occurrence-run-e/`.

Native namespace 0/4 counters remain source-based. Kimi emitted counters/last eligible/exception namespace 5, Mistral mapping namespace 3 and active-slot `mappedRef`, format/settings summaries and `LENS`, normalized tail-query consumption, full mutation/10k-100k-1M heap proof and CRC closure remain open. Provider routing/default are unchanged. W26 scratch and W23's eight zero-decode planning/header cases remain phase-5-through-7 dependent. See [PHASE5-STATUS.md](PHASE5-STATUS.md). Review skipped per Andrew 2026-10-09.

## Historical indexed metadata increment

Starting HEAD `01c30ba7e`; native contributions/rank `055ca8b30`; indexed snapshot implementation `3a921873d56bc6ac6a3d6a52f34a8f5683245fb6`. [PHASE5-METADATA-PROOF.json](PHASE5-METADATA-PROOF.json) binds 27 source paths to committed blobs. Final acceptance is **98 isolated serial processes over 49 files, 696 passes, 817434 assertions, no failures or skips**, under both outer backend settings. Six scoped gates pass. All 124 recorded matrix/control/gate PIDs are absent. Raw receipts: `tmp/854-notes/p5/metadata-run-d/`.

The frozen 5000-case differential now checks indexed count, every indexed `readAt`, every `isPending` result and first pending output, in addition to existing streamed hashes. Native mutation tests cover append, pop, owner, fill, purge, density, compression, clone and compaction. The 40/4000/100000-row metadata tests bound preparation to fewer than 120 heads with zero block/body reads, rank/select to fewer than 20 heads, and one selected text unit to exactly one block read with no whole body. One response appended after 40 or 4000 distinct calls stays below 150 positional reads. The full retained-heap acceptance is still open.

Two controls inject a journal-prefix rescan or retain per-row counts; each fails the unchanged metadata-read bound and restores byte-for-byte. The audit has two `DUP_ASSERT` reports for repeated assertions across different mutation/measurement boundaries. Both remain; there are no touched `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING` or `NO_ASSERT` findings. The file header requires version 4 to reject entries without persisted contributions. No fixture regeneration or provider routing/default change.

Normalized occurrence placement/counts, Kimi/Mistral native bookkeeping, format/settings summaries, full mutation/heap acceptance and CRC closure remain open. See [PHASE5-STATUS.md](PHASE5-STATUS.md) and [PHASE5-METADATA-DECISIONS.md](PHASE5-METADATA-DECISIONS.md). Review skipped per Andrew 2026-10-09.

## Historical reconstruction/tail increment

Starting HEAD `29bcdd89f`; first green R1 `57d30e894`; tail/range implementation `abfd39888d71a069f8dbc89182e833138328b028`. [PHASE5-TAIL-PROOF.json](PHASE5-TAIL-PROOF.json) supersedes the response-only coverage counts below while preserving those receipts as historical evidence. Current acceptance: **80 isolated serial processes, 40 files, both outer backends, 588 passes, 205292 assertions, no failures/skips; six scoped gates; zero touched audit findings**. All 22 source paths match their actual implementation blobs. All 189 recorded job PIDs are absent.

`normalization-unit-oracle.test.ts` now compares all 5000 immutable output hashes, counts, pending flags and first pending ordinals, with no unsupported branch. These are twelve repeated structural families, not 5000 independent random structures. `journal-reconstruction-units.test.ts` adds seven named reconstruction differentials; `journal-tail-units.test.ts` adds nine tail/pending/metadata differentials. `journal-tail-resources.test.ts` checks copied pending ownership, closed-pin rejection and selection before a 2000-row prefix, still under 100 positional reads.

`journal-block-ranges.test.ts` rejects the whole-row read fallback using more than 2 MiB of unrelated text. `journal-lazy-units.test.ts` checks three relocated response payloads and stored media references without payload reads during plan creation, then exact single-block consumption and invalid-reference rejection. `journal-response-fact-errors.test.ts` rejects a real response missing best. Controls for wrong reconstructed unit, whole-history tail copying and dropped responses fail and restore with cmp. Raw evidence: `tmp/854-notes/p5/tail-run-c/`.

Pending membership is streamed, not an indexed first-output/count API. Normalized occurrences/contributions, persistent unit aggregates, full native mutation/heap proof and provider/settings integration remain open. Range reads do not verify whole-body CRC. No production routing/default change. See [PHASE5-STATUS.md](PHASE5-STATUS.md) for the exact boundary.

## Historical response-only increment

Starting HEAD: `46b13bc9bf105d9df0d6e48fffbf5c78a43248f1`. First response group: `270ad3e81`. Final implementation: `ad629b507a009f745e168081dd4e5947317b5e26`. This proves existing-call response units, not full phase 5 or provider routing. [PHASE5-STATUS.md](PHASE5-STATUS.md) states the implemented and missing fields. [PHASE5-RESPONSES-PROOF.json](PHASE5-RESPONSES-PROOF.json) records current source counterparts and receipts. The earlier source-fact/orphan proof remains in [PHASE5-PROOF.json](PHASE5-PROOF.json).

## Accepted boundary

Final logs/JUnit: `tmp/854-notes/p5/responses-run-b/accept-final-*`. All **29 serial isolated files pass 227 tests and 43,495 assertions, with zero failures/skips**. Each receipt binds the test's actual source SHA-256, child/driver PIDs, log hash and JUnit hash. Eight changed implementation/test paths also match both the worktree and their actual committed counterparts at the final implementation SHA.

| Behavior                       | Direct evidence                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing-call R2/R4/R5/R6      | `journal-response-units.test.ts`: twelve literal old-stream differentials. Includes stable best tie, better duplicate without moving duplicate media, first-response order rather than call order, non-AI target/result, first-new-target media, interleaving, split block indices, empty/raw-prefix IDs and mixed real/orphan slots. |
| Pin held through consumer      | Same file: first yield, opener close, later response commit, async consumption still equals the old pinned input. After consumption, fact reads reject the released pin.                                                                                                                                                              |
| Every immutable seed accounted | `normalization-unit-oracle.test.ts`: old-reference checks for all 5000 records; prior orphan-only 1436 retained; new API matches 3788, explicitly rejects 497 reconstruction and 715 tail cases. Independent family classification rejects unexpected refusals. No fixture regeneration.                                              |
| Native rebuild/ownership       | `journal-response-lifecycle.test.ts`: density replacement, rebuild, swapped owner IDs, replace and reopen compare actual new units with old output. Reopened owners are checked directly.                                                                                                                                             |
| Long duplicate chain           | Same file: 100 and 1000 responses, best at the end, fewer than 100 positional reads to emit the call and selected result. Does not traverse the intervening response prefix to select the best block.                                                                                                                                 |
| Async JSON/media charge        | Same file: full serialized output charge across consumer suspension, greater-than-512-KiB response/media unit, stored reference unchanged and cancellation releases to zero. One charged emitted unit at a time. This is explicit output ownership, not whole-generator heap or referenced-row decode accounting.                     |
| No operation files/cache cap   | `journal-orphan-resources.test.ts`: 2000 real call/result pairs, 2000 media blocks, no output collection, zero creation attempts and cache at most 65536 bytes. The original 4000-ID/8000-unit orphan test and positive creation observer remain.                                                                                     |
| Native source facts            | `journal-normalization-facts.test.ts` and row codec tests retain append/rebuild curation, empty tuples and split coordinates, human-row result and better duplicate evidence.                                                                                                                                                         |
| Regressions                    | Native session/repair/mutations, detached owner/media, commit/pins/pop, six compaction/owner files and Mistral copy. Existing normalized-library id-fact tests remain library evidence only.                                                                                                                                          |

The immutable 5000-line fixture remains SHA-256 `4699c502e99b67ea231f47884bdc2109400c4138803a16a3e5ac7418e0fa8d9e`. The proof checks it, both old normalizer files and all eight provider golden/manifest files byte-for-byte against starting HEAD. The provider manifest has 22 named histories exercised through two frozen source modes per route. No provider fixture was regenerated or newly routed through this stream.

## RED and rejecting controls

Initial response RED establishes actual refusal by the existing implementation and missing pin ownership. Later lifecycle RED observes a zero-byte charge where the call unit requires 115 bytes. The initial refusal-count authoring failure omitted the empty-ID tool-continuity family; those 71 cases are explicitly included in the 497 reconstruction obligations. It was not a changed frozen expectation or an accepted differential mismatch. Registration, compiler/lint and proof-launch failures are separate receipts.

Final-source controls live in `responses-run-b/control-final/`. Each exits one at the intended assertion and restores its target byte-identically:

| Mutation                                                      | Rejecting assertion                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Replace strict best-score comparison with later-wins equality | `stable-best-tie` actual old/new unit differential.                   |
| Attach responses only to AI calls                             | `human-call-tool-result` actual old/new differential.                 |
| Reverse selected media references                             | Multi-part and interleaved media actual old/new differentials.        |
| Remove query-cache eviction                                   | Real-response resource test exceeds the unchanged 65536-byte cap.     |
| Create a per-operation file                                   | Real-response creation observer reports one instead of zero.          |
| Release the emitted-row charge before yield                   | Lifecycle observer reports zero instead of the live call-unit charge. |

No thresholds, assertions, timeouts, compiler/lint rules or scanner exemptions changed. Final serial acceptance follows restoration.

## Gates, processes and limits

Six scoped gates pass over the complete eight-path source set: declaration-only core build, strict noemit core types including tests, zero-warning ESLint, Prettier, affected-shard graph and AST audit. There are no touched audit findings. Graph validation does not establish execution of affected shards. No whole-repository build/test claim is made.

The proof verifies **85 recorded acceptance/control/gate PIDs absent**, with no live recorded child or driver. This inventory excludes unrelated machine processes. No obstruction move was needed. The 293 pre-existing untracked agent declarations, raw recovery material and `.llxprt` remain unstaged.

Still missing: R1/reconstructed targets and empty-response continuity, tails/pending, range-only block reads, normalized occurrences/contributions and unit ranks/counts/readAt, Stage A claim checks, generator 10k/100k/1M heap-flatness and retaining trap, format/settings keys and converter fills. Existing row-sized relocated reads may reread one source row per selected block. W26, W23, provider spool deletion and W25/default remain open. Production uses the old normalizer. Review skipped per Andrew 2026-10-09. No cleanup, OCR, push or merge.
