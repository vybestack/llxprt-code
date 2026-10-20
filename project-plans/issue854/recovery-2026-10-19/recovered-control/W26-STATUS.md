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
