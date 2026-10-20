# Phase 5 source-facts and orphan-unit increment, 2026-10-20

Phase 5 is partial. Starting HEAD is `f99a23fc9e58a6b04b3d876d67497dd5e0828387` on `issue854`. This increment wires source normalization facts into the actual native session append/rebuild path and adds an indexed, response-free orphan unit stream. No provider route or backend default changes. The old normalizer stays intact.

## Inventory and implemented boundary

Before editing, `JournalSession.storeDependencies` already supplied the real tools normalizers and SHA-256 namespace hashing. It did not inject dummy normalizer functions. `journalRowCodec.idsOf` omitted empty calls and responses. `planOwnRowOccurrences` assigned every tuple its unsplit source row, part 0/unit 0, with no curation test. Thus a tool row containing calls had no `Ca` fact for its extracted AI part. Those source-row positions were also being written into the normalized occurrence lists, despite not describing normalized units.

`PlannedRow` now carries flags and block-directory types. `planSourceRowOccurrences` skips uncurated rows, assigns split call blocks to AI part 0 and remaining blocks to tool part 1, and computes indices within each part. The ROW id piece includes empty strings. Append and rebuild use this same planner. Rebuild gets types, IDs, scores and name lengths from headers/id pieces, without decoding block bodies. Fill retains the existing facts rather than changing their meaning.

| Field or namespace | Actual production state after this increment |
| --- | --- |
| ROW id piece/tuples | Raw strings including empty IDs; original source block coordinates, kind, score and UTF-8 name lengths. Native metadata, own string values, ownership and block bytes remain unchanged. |
| Raw namespace 0 `C`, `Ca`, `R`, `Rt`, `best`, score | Correct split-part source coordinates for nonempty IDs, including human-row results and earliest equal-score selection. Empty calls have `C`/`Ca`; empty responses are counted but have no `R`, `Rt` or best pointer. Empty-response continuity remains pending. |
| Namespace 4 occurrences; counts/Ke/counters in IdFact | Source occurrences only. They do not include reconstructed calls or orphan responses, and are not asserted to be unit-stream/Kimi counters. |
| Normalized namespaces 1/2 | Not produced by the source planner. Required `occurrenceSpace` distinguishes source facts from normalized library facts. Normalized queries on a production source-fact view throw instead of presenting source positions as complete normalization facts. Real provider normalizers remain typed dependencies. |
| Namespace 3/Mistral, namespace 5/Kimi | Existing normalized-library implementations remain tested. No production Mistral assignment or normalized Kimi exception list is claimed. `mappedRef` remains zero on ordinary native rows. |
| Namespace 6 | Existing clone/compaction relocation; unchanged. |
| Meta/state | Existing parent lists and state maps remain. No new normalized parent/unit bookkeeping is claimed. |
| Entry `reconBlocks`, `answered`, `callBlocks`, `unmappedBlocks`, derived contribution flags | Not filled by this slice. Zero is not evidence that a row has no normalized contribution. |
| Slots, LENS, RowFormatSettings, format/image keys | Slot codecs exist; production format keys, converter-settings coverage, LENS and transfer-summary fills are not implemented here. No new converter or key accepts unsupported settings. |

`VersionSnapshot.facts` reads the snapshot's own id root under its existing pin. A later response commit cannot change a pinned orphan result. `streamJournalOrphanUnits(snapshot)` is an explicit partial API, not an adapter or production send fallback. It walks rows once, skips uncurated rows, splits tool-call rows, and uses indexed `C` and `Ca` reads to emit orphan slots beside the first call of any speaker. The cross-speaker case `[human(text q, call a), ai(call a)]` emits human, synthetic tool, AI. Duplicate IDs, empty call IDs, orphan slot order, and orphan metadata retention are covered. Its per-part sets/arrays contain only the current row's calls; it has no history-sized ID map or output array. Fetching a referenced `Ca` reads one row, not a history scan.

## Rules and differential range

R3/R4 are implemented only for real-response-free, committed rows; R6 covers the synthetic-orphan successor; R7's stripping function and R8 are implemented. R1/reconstruction, general R2/R4 relocation, R5 media selection, general R6 look-ahead, tail overlay, pending membership, unit-rank/count aggregates and readAt remain pending. Real response rows or response-bearing call facts fail fast in the partial stream. Provider sends still use the complete old normalizer.

The newly frozen fixture contains 5000 deterministic cases, seeds 0..4999, with immutable input/output hashes, counts and pending flags. It was created with the old production normalizer before production edits. The generator uses exclusive creation and refuses to overwrite a frozen fixture. Twelve repeated structural families vary IDs, text, ordering and tail placement; this is not a claim of 5000 independently randomized structures. Fixture SHA-256: `4699c502e99b67ea231f47884bdc2109400c4138803a16a3e5ac7418e0fa8d9e`. Original normalizer sources remain at the starting Git commit and unchanged in the worktree; byte copies are retained with raw evidence.

All 5000 old-reference cases are checked against that fixture. The indexed implementation matches the explicitly admitted **1436 response-free/no-tail cases**, plus five literal edge cases. The other 3564 fixture cases are frozen future differential obligations, not passing indexed coverage and not skipped tests. The existing phase-4 45,000-case native corpus exercised the old normalizer and is not new-normalizer proof.

The resource test streams 4000 native IDs/8000 units, observes filesystem creation attempts without a scratch-root filter, and checks the unchanged 64 KiB query-cache cap. Four mutation controls reject: restricting orphan attachment to `Ca == current` loses the cross-speaker response; omitting empty IDs fails the tuple assertion; disabling cache eviction reaches 579844 bytes; adding an operation file reports one creation. All mutated sources restore byte-identically with `cmp`. This is not the phase-5 10k/100k/1M generator heap-flatness proof; that and the per-id retention trap remain open.

## Remaining dependency order

Complete source/normalized occurrence separation through actual R1-R8 unit bookkeeping, response/media block-range reads, response-arrival recomputation, tail facts and pending membership. Then finish the frozen Stage A differential, claim checks and generator heap controls before routing providers through the pin. Add typed, strict converter settings with every-field key tests when converter/slot fills are wired. No format-key or normalized-count shortcut may turn the present missing fields into valid zeroes.

W26 still needs async curated-rank access and planner/selection migration before deleting `curatedDensityRows` input copying. Chronology membership/deduplication, density/ranking/nonempty-span scratch and old-only deletion also remain. The earlier output-copy removal remains valid but does not close input normalization. Provider body/estimator/message-table/tool-ID spools remain phases 6 and 8. W23's eight zero-decoded-row planning/header assertions remain phases 5/6 through 7. This increment closes neither W26 nor W23 nor the default-flip gate.

Raw receipts and actual process IDs: `tmp/854-notes/p5/facts-run-a/`. The proof map records gates, isolated tests, source hashes and controls. Review skipped per Andrew 2026-10-09. No cleanup, obstruction move, `.llxprt` edit/staging, emitted-declaration/raw-recovery bulk staging, OCR, push or merge.
