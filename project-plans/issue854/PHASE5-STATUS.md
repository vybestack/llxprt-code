# Phase 5 indexed metadata increment, 2026-10-20

Native unit contributions, count and prefix rank are now persisted. An indexed request snapshot uses those fields to select units and locate pending output without enumerating the journal prefix. Phase 5 remains partial. Starting HEAD was `01c30ba7e95b506a3a0e6580315ff75997fec98e`; the first contribution increment is `055ca8b30`. Production provider sends still use the existing normalizer and the default backend is unchanged.

## Implemented boundary

`RowEntry` stores the stripped self contributions of both possible split parts and the reconstructed adjacent contribution in three entry flag bits. `reconBlocks` contributes one reconstructed unit when nonzero; `answered` contributes one adjacent unit when nonzero. Uncurated rows contribute no units. The 1112-byte entry and format-summary widths are unchanged. The file version is now **4**, so version-3 journals lacking these fields fail admission instead of returning incorrect counts. No migration or fallback was added.

The pinned trailer supplies `VersionSnapshot.units`. `unitsBelow(label)` combines child unit totals along one tree descent. `unitAt(index)` selects a row and local unit ordinal through those same stored totals. Append updates new entries and the earlier first-call/first-tool-response entries affected by the appended IDs. Those entries are path-copied with the new right spine. Rebuild streams headers and ID pieces through a contribution-tree pass after its source facts are complete. It does not decode content blocks or retain all row counts.

`IndexedJournalRequestSnapshot.create` holds one native pin and owns encoded pending input. Its prelude visits only targets of IDs in the tail overlay and tail rows. A prefix query gives each affected journal row's output start; local contribution changes adjust later ordinals. Each overlay row stores a fixed-width pending mask, not one boolean per historical unit. Count and `pending.firstOutputIndex` are fixed scalars. `isPending(index)` uses those tail-bounded descriptors. `readAt(index)` selects through the tree and creates plans for the selected row with one curated successor for metadata decisions. Only the selected plan's blocks are materialized. Sequential reading continues through the lazy plan generator.

Empty IDs retain `Rt` for the first tool response, including duplicate response blocks in that part. They still have no real-response `R` or `best` and are excluded from call targets. The completed-part generator can therefore start at an indexed row without replaying earlier empty-ID responses. The naive fact model was updated to expect this intentional `Rt` distinction, and the array mutation model now derives the newly persisted contribution flags independently. Existing equality assertions remain. Frozen normalization and provider wire fixtures are unchanged.

## Fields and claims

| Field or API | Current boundary |
| --- | --- |
| R1 through R8 order, targets, slots, media and metadata | Existing lazy plan path retained; indexed selection uses the same per-row plan rules. |
| Native `C`, `Ca`, `R`, `Rt`, `best` | Stored source facts; pending overlay merges only pending IDs. |
| `reconBlocks`, `answered`, contribution flags, aggregate `units` | Maintained by native append/rebuild and preserved by owner/fill/copy paths; queried from the pinned current version. |
| Indexed count/rank/selection | Implemented in the native tree and snapshot. |
| Pending count, first output ordinal and membership | Implemented by the tail-bounded indexed overlay. Pending input is not persisted as a history mutation. |
| Normalized namespaces 1/2 | **Not maintained by native normalization.** Source-view queries still reject; low-level trie tests do not establish native occurrence placement. |
| Kimi/Mistral bookkeeping and format/settings summaries | **Not wired.** `callBlocks`, exceptions, `mappedRef`, active-slot summaries and `LENS` need their own completed native maintenance. |
| Provider routing | Unchanged; the indexed snapshot has not replaced provider send selection. |

## Verification boundary

The indexed differential compares count, every selected unit, pending membership and first pending ordinal for all 5000 frozen cases, in addition to existing output hashes. Native tests cover count changes when a later AI call creates an orphan beside an earlier human call; real responses, pop, owner, fill, purge, density, compression, clone and compaction; pin ownership; and empty journals. Read-budget tests use 40, 4000 and 100000 rows. Prelude and rank/select reads must fetch no block/body payload; selecting one text unit must fetch exactly its one block. Separate append tests use 40 and 4000 distinct call IDs and bound reads after one response append.

Two negative controls add a prefix rescan or retain all historical counts during snapshot preparation. Both must fail the unchanged metadata read budget. Sources are restored byte-for-byte after each control. These are read-budget controls, not a completed retained-heap proof.

Implementation `3a921873d56bc6ac6a3d6a52f34a8f5683245fb6` passes **98 isolated serial processes over 49 files: 696 passes, 817434 assertions, zero failures or skips**. All six scoped gates pass: declaration-only core build, strict test-inclusive core types, zero-warning scoped ESLint, Prettier, affected-shard graph and AST test audit. The audit's two duplicate-assertion reports concern distinct state/measurement boundaries; no touched `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING` or `NO_ASSERT` findings remain. Graph validation is not a claim that all affected shards ran.

Raw REDs, controls, serial acceptance logs, JUnit and gate receipts are under `tmp/854-notes/p5/metadata-run-d/`. [PHASE5-METADATA-PROOF.json](PHASE5-METADATA-PROOF.json) binds 27 source paths to committed blobs and verifies all 124 recorded matrix/control/gate PIDs absent, with none live. Earlier lazy-stream receipts remain in `PHASE5-TAIL-PROOF.json`.

## Remaining work

Complete normalized occurrence placement and counts over reconstructed/split/stripped/relocated units, with injected provider ID transforms and duplicate ordinals. Complete Kimi/Mistral and format/settings summary maintenance. Extend native mutation and retained-heap acceptance through 10k/100k/1M controls before claiming Phase 5 completion. This increment does not resolve CRC coverage: range reads validate framing, identity and bounds but do not validate unselected body bytes against a whole-record CRC. The full-row reader retains that check. Stage A completion, provider-native conversion, W26 scratch/ranking/chronology removal, phases 6/8 provider spools and W25/default requirements remain open.

No cleanup, deletion, obstruction move, `.llxprt` edit/staging, generated-declaration staging, raw-recovery staging, OCR, push or merge. The 293 pre-existing untracked agent declarations remain excluded. Review skipped per Andrew 2026-10-09.
