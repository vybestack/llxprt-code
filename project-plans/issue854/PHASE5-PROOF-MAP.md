# Phase 5 response proof map

Starting HEAD: `46b13bc9bf105d9df0d6e48fffbf5c78a43248f1`. First response group: `270ad3e81`. Final implementation: `ad629b507a009f745e168081dd4e5947317b5e26`. This proves existing-call response units, not full phase 5 or provider routing. [PHASE5-STATUS.md](PHASE5-STATUS.md) states the implemented and missing fields. [PHASE5-RESPONSES-PROOF.json](PHASE5-RESPONSES-PROOF.json) records current source counterparts and receipts. The earlier source-fact/orphan proof remains in [PHASE5-PROOF.json](PHASE5-PROOF.json).

## Accepted boundary

Final logs/JUnit: `tmp/854-notes/p5/responses-run-b/accept-final-*`. All **29 serial isolated files pass 227 tests and 43,495 assertions, with zero failures/skips**. Each receipt binds the test's actual source SHA-256, child/driver PIDs, log hash and JUnit hash. Eight changed implementation/test paths also match both the worktree and their actual committed counterparts at the final implementation SHA.

| Behavior | Direct evidence |
| --- | --- |
| Existing-call R2/R4/R5/R6 | `journal-response-units.test.ts`: twelve literal old-stream differentials. Includes stable best tie, better duplicate without moving duplicate media, first-response order rather than call order, non-AI target/result, first-new-target media, interleaving, split block indices, empty/raw-prefix IDs and mixed real/orphan slots. |
| Pin held through consumer | Same file: first yield, opener close, later response commit, async consumption still equals the old pinned input. After consumption, fact reads reject the released pin. |
| Every immutable seed accounted | `normalization-unit-oracle.test.ts`: old-reference checks for all 5000 records; prior orphan-only 1436 retained; new API matches 3788, explicitly rejects 497 reconstruction and 715 tail cases. Independent family classification rejects unexpected refusals. No fixture regeneration. |
| Native rebuild/ownership | `journal-response-lifecycle.test.ts`: density replacement, rebuild, swapped owner IDs, replace and reopen compare actual new units with old output. Reopened owners are checked directly. |
| Long duplicate chain | Same file: 100 and 1000 responses, best at the end, fewer than 100 positional reads to emit the call and selected result. Does not traverse the intervening response prefix to select the best block. |
| Async JSON/media charge | Same file: full serialized output charge across consumer suspension, greater-than-512-KiB response/media unit, stored reference unchanged and cancellation releases to zero. One charged emitted unit at a time. This is explicit output ownership, not whole-generator heap or referenced-row decode accounting. |
| No operation files/cache cap | `journal-orphan-resources.test.ts`: 2000 real call/result pairs, 2000 media blocks, no output collection, zero creation attempts and cache at most 65536 bytes. The original 4000-ID/8000-unit orphan test and positive creation observer remain. |
| Native source facts | `journal-normalization-facts.test.ts` and row codec tests retain append/rebuild curation, empty tuples and split coordinates, human-row result and better duplicate evidence. |
| Regressions | Native session/repair/mutations, detached owner/media, commit/pins/pop, six compaction/owner files and Mistral copy. Existing normalized-library id-fact tests remain library evidence only. |

The immutable 5000-line fixture remains SHA-256 `4699c502e99b67ea231f47884bdc2109400c4138803a16a3e5ac7418e0fa8d9e`. The proof checks it, both old normalizer files and all eight provider golden/manifest files byte-for-byte against starting HEAD. The provider manifest has 22 named histories exercised through two frozen source modes per route. No provider fixture was regenerated or newly routed through this stream.

## RED and rejecting controls

Initial response RED establishes actual refusal by the existing implementation and missing pin ownership. Later lifecycle RED observes a zero-byte charge where the call unit requires 115 bytes. The initial refusal-count authoring failure omitted the empty-ID tool-continuity family; those 71 cases are explicitly included in the 497 reconstruction obligations. It was not a changed frozen expectation or an accepted differential mismatch. Registration, compiler/lint and proof-launch failures are separate receipts.

Final-source controls live in `responses-run-b/control-final/`. Each exits one at the intended assertion and restores its target byte-identically:

| Mutation | Rejecting assertion |
| --- | --- |
| Replace strict best-score comparison with later-wins equality | `stable-best-tie` actual old/new unit differential. |
| Attach responses only to AI calls | `human-call-tool-result` actual old/new differential. |
| Reverse selected media references | Multi-part and interleaved media actual old/new differentials. |
| Remove query-cache eviction | Real-response resource test exceeds the unchanged 65536-byte cap. |
| Create a per-operation file | Real-response creation observer reports one instead of zero. |
| Release the emitted-row charge before yield | Lifecycle observer reports zero instead of the live call-unit charge. |

No thresholds, assertions, timeouts, compiler/lint rules or scanner exemptions changed. Final serial acceptance follows restoration.

## Gates, processes and limits

Six scoped gates pass over the complete eight-path source set: declaration-only core build, strict noemit core types including tests, zero-warning ESLint, Prettier, affected-shard graph and AST audit. There are no touched audit findings. Graph validation does not establish execution of affected shards. No whole-repository build/test claim is made.

The proof verifies **85 recorded acceptance/control/gate PIDs absent**, with no live recorded child or driver. This inventory excludes unrelated machine processes. No obstruction move was needed. The 293 pre-existing untracked agent declarations, raw recovery material and `.llxprt` remain unstaged.

Still missing: R1/reconstructed targets and empty-response continuity, tails/pending, range-only block reads, normalized occurrences/contributions and unit ranks/counts/readAt, Stage A claim checks, generator 10k/100k/1M heap-flatness and retaining trap, format/settings keys and converter fills. Existing row-sized relocated reads may reread one source row per selected block. W26, W23, provider spool deletion and W25/default remain open. Production uses the old normalizer. Review skipped per Andrew 2026-10-09. No cleanup, OCR, push or merge.
