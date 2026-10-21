# Native summary input copy removed, first checkpoint, 2026-10-21

Starting HEAD: `745a8c962179d449b837708c2859879c70e9822b`. Native middle-out and one-shot now hold one published journal snapshot through preparation, provider attempts and detached publication. `openCompressionInput` selects the whole backend operation. The native implementation reads stored service-curation count/ranks and derives original numeric source ordinals from entry labels. It creates no curated `HistoryDensityRows` directory or rows/index files. The explicit old backend retains that copy until phase 9; missing native support cannot select it.

Compression uses service-curated rows, not provider-normalized units. Substituting `IndexedJournalRequestSnapshot.readAt` would split/reorder tool rows and change summary requests. This increment reuses the native tree's service-curation facts and stored row decoder without introducing another normalizer. The existing normalized request snapshot and its pending queries remain unchanged. Summary planners, tool boundaries, indexed request reads and output consumers now await row access. The two-row summary descriptor still preserves source ranges lazily.

The first checkpoint passes 28 tests and 199 assertions over five serial complete files, including the unchanged 512/8192-row independent request/output comparisons. The actual allocation test originally failed twice, observing one curated directory per public native operation; both paths now observe zero curated files/directories while still accounting for chronology scratch. Eight scoped gates and direct core/provider/agents declarations pass. Evidence: `tmp/p5/w26-indexed-input-run-x/checkpoint` and `W26-INDEXED-INPUT-PROOF.json`. Graph validation is not affected-shard test execution.

W26 remains open. Full lifecycle, retained-memory and negative-control acceptance is pending. Chronology membership/deduplication, high-density and truncation input copies, density/ranking owners, nonempty density spans and old-backend scratch remain. Provider normalization and default send spools remain in phases 5/6. This is a native compression-only cutover, with provider routes and backend default unchanged. #3917 remains separately RED without retry or suppression. No unrelated declaration/recovery or `.llxprt` staging, cleanup, OCR, push, merge or enforcement changes. Review skipped per Andrew 2026-10-09.

---

# W26 summary-output increment, 2026-10-20

W26 remains open. Implementation is committed at `4e271ebf5e0c56430f037b06c8bfdb6e753ec7fe`, based on `79a870ad8`. The shared middle-out/one-shot success path no longer constructs the output `HistoryDensityRows` in `runDiskSummary`. Its `history-density-*/rows,index` files are not renamed or replaced by another file. `prepareDisk` returns the split, two generated rows, and an indexed view of the preserved source ranges. `streamCompressionOutputRows` emits one row/position/source-ordinal tuple per pull. `writeCompressionValues` applies the existing annotation, cache-anchor and Responses invalidation rules, then awaits the real detached sink before pulling again. The existing `JournalCandidate` writes tentative ROWs into an unpublished persistent replacement group and publishes at the trailer acknowledgement. Its rollback protocol is unchanged.

This closes an actual output allocation, not the complete pinned-source-to-sink migration. The native path still reads its pinned dump into `curatedDensityRows` once. The summary descriptor retains two generated rows and scalar boundaries; it holds no history-sized output array, set or map. Retries prepare a new descriptor and do not rescan the input to count rows. Existing explicit disk-output `compressDisk` entry points remain for the standalone strategy contracts, while the public shared runner uses `prepareDisk`.

`runDiskSummary` now attempts both curated-close and pin-close even if either fails. An operation failure plus cleanup failures becomes an AggregateError with the operation error first and as `cause`; a cleanup error cannot overwrite the summary failure. Fault-injected filesystem-close tests establish this boundary for both strategies.

## Remaining work and dependency boundaries

1. **Curated input is still W26 work.** `curatedCandidate.ts:curatedDensityRows` still creates one `history-density-*/rows,index` pair. `planDiskMiddleOut`, `adjustDiskToolBoundary`/`forwardDiskToolBoundary`, and `diskSummaryRequestSelection.readAt` currently require synchronous indexed access. The native dump offers async rows, and `VersionSnapshot.entryAt/readRow` are async. The native trailer already stores the curated count; supplying async curated-rank access and migrating these planners/selections must remove the input copy without repeated full counting scans. This file is not described as unavoidable provider-normalization scratch.
2. **Chronology indexing is still W26 work.** `diskTruncation.ts:replacedSpan` creates `CompressionSpanIndex`, records preserved chronology seqs, and deduplicates removed seqs, including duplicate-marker/self-merge cases. The output descriptor does not remove that algorithm's index. Replacing it must preserve seq membership/deduplication, not infer removed chronology solely from contiguous ordinals.
3. **Density and ranking remain unchanged.** High-density input/output `HistoryDensityRows`, density optimizer replacement rows and `density-decision-index-*`, tool-response ranking rows and `tool-response-ranking-*`, and nonempty `DensitySpanRows` remain. Truncation's `curatedCandidate` still constructs `DetachedHistoryJournal`. Old-backend mutation/checkpoint/origin scratch remains until its deletion boundary.
4. **Phase 5 normalization is separate.** The actual normalizer is `prepareProviderContentSnapshot` in `core/services/history/provider-curated-stream.ts`, reached by `streamDiskSource` through `HistoryService.prepareCuratedForProviderSnapshot`. `completeResponses` needs the global `responded:` facts; `indexResponses` needs `call:`, duplicate response scores and selected block pointers; `stageOutput`/`adjacentResponse` need random completed-row access, including row `i+1`. The current streaming port does not supply these normalized units/id facts. Its `ProviderNormalizationDisk` remains phase 5. The compression-summary selection sanitizes rows itself and is not this normalizer, so phase 5 is not a blanket reason to retain every W26 file.
5. **Phase 6 provider scratch is separate.** The real default provider builders still own body, estimator/key, message-table and tool-id spools. The new output test uses only an external summary transport seam and makes no default-builder scratch-free claim. No phase 5/6 file was moved into the output producer.

Evidence root: `tmp/854-notes/p4/w26/output-run-b/`. The resource RED observed two density directories where one input owner was expected for each real native public compression. The output-only preparation/emission contract observes zero directory/file creates, including mkdir/mkdtemp/open/write/append APIs without a scratch-root filter. Its positive control creates files under a different root. The full public operation separately accounts for its remaining curated input and chronology index, and rejects unclassified paths.

Acceptance commands, process outcomes, memory values and source bindings belong in the new section of `W26-PROOF-MAP.md`. The earlier publication-only proof below remains historical. D-ORCH-7/G13, W25/default, W23's eight dependencies and W24's qualified proof boundary are unchanged. Review skipped per Andrew 2026-10-09. No cleanup, `.llxprt` change/staging, emitted-declaration/raw recovery bulk staging, OCR, push or merge is part of this increment.

---

# W26 first publication increment, 2026-10-20

W26 remains open. This increment removes empty density-span scratch from the native detached publication consumer. It does not remove the agents strategies' input or output staging files. Starting HEAD was `93e51002a0d452f2d4fed103382746a4f9b77f9e`.

## Closed implementation boundary

`HistoryStorePort.publishDetached` already dispatches native work to `publishDetachedOnJournal` and `JournalCandidate`. The candidate consumes each awaited sink row, preserves copied-row ownership by source ordinal, opens a replacement on first divergence, and compensates through a pinned prior version. Rewriting that protocol would duplicate working code.

The remaining unconditional allocation inside that consumer was `DensitySpanRows`: construction created `llxprt-resolver-*/intervals`, and projection created a second copy even when the producer made no density edits. The accumulator now acquires its disk index only for an actual density span. Without density edits it merges only the existing standing window and the rewind span, retaining the unchanged 1,024-span cap. Closing before the first edit still forbids subsequent append.

For native non-density detached publication, the observed operation-file count falls from two interval files to zero. A producer failure before projection previously created one file. No production source file or importer was deleted. This is a resource-lifetime change in the shared publication consumer, not completion of G13's strategy-producer migration.

## Production owner inventory captured before edits

Paths below are relative to `packages/`. The exact pre-edit symbol/caller census is `tmp/854-notes/p4/w26/stream-run-a/owner-inventory.txt`. Neither `oldDiskHistoryCandidate` nor `createHistoryValueScratch` exists in production at this HEAD; the following are the actual owners.

| Owner and artifact | Production allocation callers | Disposition |
| --- | --- | --- |
| `core/src/services/history/densitySpanRows.ts`, resolver `intervals` | `journalPublishDetached.ts`; old `detachedHistoryMutation.ts` mutation/restore; old `historyDiskDensity.ts`; its own sorted projection | Empty native publication case removed here. Nonempty density spans still allocate. |
| `core/src/services/history/historyDensityRows.ts`, `history-density-*/rows,index` | Agents `compression/curatedCandidate.ts`, `diskMiddleOut.ts`, `diskHighDensity.ts`, `diskDensityOptimization.ts`, `toolResponseDiskRanking.ts`; core `journalDensity.ts`; old `historyDiskDensity.ts`, `historyMergeRows.ts`, `historyValidationRepair.ts`, `dumpSnapshotValues.ts`; agents `api/control/sessionHistoryClear.ts` | All remain. `semantic-purge-disk-rows.ts` also inherits this owner. |
| `core/src/services/history/detachedHistoryJournal.ts`, `history-detached-*/rows,index,markers` | Agents `compression/curatedCandidate.ts`; old core `detachedHistoryMutation.ts` and `detachedHistoryCheckpoint.ts` | All remain. Native publication does not instantiate this class. |
| `core/src/services/history/historyMutationSnapshot.ts`, `history-mutation-*` | `captureHistoryMutationSnapshot` via old `historyJournalStore.ts` and old mutation operations | Old-contract support remains until deletion. Native publication/checkpoints use version pins. |
| `core/src/services/history/historyRowOrigins.ts`, `history-row-origins-*` | Old capture/mutation snapshot and detached origin adoption | Old support remains; native copied rows read owners from source ordinal entries. |
| `core/src/services/history/compression-span-index.ts`, `compression-span-*` | Agents `compression/diskTruncation.ts` (`replacedSpan`, also called by `cache-anchor-values.ts`); core `compression-span-stream.ts` | Remains in compression metadata preparation. |
| Agents `compression/densityDiskIndex.ts`, `density-decision-index-*` | `DiskDensityOptimization` in `diskDensityOptimization.ts` | Remains, together with replacement `HistoryDensityRows`. |
| Agents `compression/toolResponseDiskRanking.ts`, `tool-response-ranking-*` plus `HistoryDensityRows` | Tool-response ranking/truncation callers | Remains. |

Native profile staging (`journalProfileReplacement.ts`) streams `ProfileCandidateRows` and captures compensation, rather than a temporary previous-history copy. Native checkpoints (`journalCheckpoints.ts`) retain a version and its row count. Native resume adoption (`recording/journalResumeAdoption.ts`, `services/history/journalAdoption.ts`) adopts the recorder's persistent journal. Stopping an adopted recorder clones the active database to an unlinked persistent store; that database is not an operation candidate. This source inspection is not a global no-file claim for surrounding profile or resume callers.

Other existing owners are separately scoped: old repair/tool-pairing indexes, old attachment/resume projection, provider normalization and send/tokenizer/body/key spools, and media-owner reservation indexes. The persistent journal, its checkpoint versions and its replacement commit groups are database storage, not candidate files.

## Exact next W26 work

1. Replace agents curated `HistoryDensityRows`/`DetachedHistoryJournal` input copies with pinned async row access, carrying source ordinals and available lengths without counting by another full scan.
2. Replace middle-out/one-shot/high-density output `HistoryDensityRows` with producer metadata and async sink output. Preserve wire bytes, source-owner inheritance, annotation, cache anchor, summary selection, retries and lease reset.
3. Remove compression span indexing, density optimizer decision/replacement files, ranking scratch and nonempty `DensitySpanRows` without moving history-sized rows or ID maps into RAM or adding another temporary-file fallback.
4. Delete the old-only contract implementation at its scheduled deletion boundary, not by changing the backend default in this increment.

Provider-send spools remain phase 6 and are not claimed eliminated here. W23's eight planning/header dependencies remain on phases 5/6 through 7. W25 prerequisites and the old default are unchanged. W24 retains its documented pinned-code qualification; this increment does not promote historical receipts to a new full-product source boundary.

Verification receipts and final status belong in `W26-PROOF-MAP.md`. Review skipped per Andrew 2026-10-09. No cleanup, `.llxprt` edit/staging, emitted-declaration/raw recovery bulk staging, OCR, push or merge belongs to this increment.
