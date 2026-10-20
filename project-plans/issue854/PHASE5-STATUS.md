# Phase 5 Kimi emitted mapping increment, 2026-10-20

Native journal snapshots now answer last-eligible Kimi mappings and sparse mapped-digit corrections from production-owned facts. First coherent implementation: `4d88b25211a7d1b4ac5999afaf88797dbafc05f3`, starting at `4e119cb2c`; converter/lifecycle follow-up: `95ac306c970c52bdae6009c72e9acf64040ca13d`. The earlier eligible-count/ordinal work remains intact. This is a partial Phase 5 increment; provider routing and the backend default are unchanged.

## Implemented boundary

The native group writer maintains emitted per-ID call/response lists, five counters, the last eligible emitted position, global AI-call count and namespace-5 sparse exception admission. The existing `{ kind: 'kimi' }` fill rebuilds these fields through the same acknowledgement and poison path as row publication. Namespace-0 and original namespace-4 fields remain source-based. Separate emitted keys prevent a source last-call pointer from masquerading as an emitted one.

Eligibility includes named nonempty calls across all speakers and R1 reconstructed calls. Unnamed later calls do not replace mappings. Names are read from one selected source block and copied with exact UTF-16 code units. Old pins retain their own names, positions, counts and ordinals. Raw IDs remain distinct across normalized-ID collisions.

`kimiMappedId` supplies the last eligible name and global zero-based ordinal. `kimiIdFact` distinguishes written uses from consumed fallback uses. `kimiExceptions` streams the sparse list; it is empty for ordinary unique-ID histories. `kimiUnmappedCount` derives consumed fallback totals from those persisted exception counters. `kimiDigitCorrection` supplies the mapped-exception digit term. `kimiHolders` streams a selected raw ID's calls followed by its responses, without collecting the history.

Later eligible duplicates change mappings seen by both earlier journal call rows. Incremental updates visit touched IDs and affected normalized rows, not all history. Middle insertion, removal, compression, replace and prefix pop rebuild from surviving order. Clear requires refill. Owner changes, reopen, fork, clone compaction and held old pins are covered. Failed append retains the prior published mapping and poisons later writes.

Format 6 explicitly rejects CRC-valid format-5 files, whose Kimi activation marker did not imply these emitted fields. No shim or migration was added. Emitted values contain no offsets and use existing copy rules and bounded spill/cache machinery.

## Verification boundary

Final acceptance is **122 isolated serial processes over 61 files, 896 passes, 940226 assertions, zero failures or skips**, under both outer backends and unchanged `--timeout 180000`. Seven scoped gates pass: core declarations, core test-inclusive types, providers types, zero-warning ESLint, Prettier, affected-shard graph and AST audit. Graph validation does not establish execution of every affected shard. [PHASE5-KIMI-CORRECTIONS-PROOF.json](PHASE5-KIMI-CORRECTIONS-PROOF.json) binds 17 committed paths, the 8856-entry source boundary and 617 raw receipts. All 342 recorded child/driver PIDs are absent; none live.

The old normalizer/tools mapper supplies independent mapping expectations. A separate actual-chat-converter differential checks eligible count, fallback consumption, written IDs and mapped digits over frozen-source families and named edge cases. It includes empty/default reconstructed names, duplicates, empty/raw-prefix collisions, non-AI output drops, unnamed fallback drops and 9/10/99/100 digit boundaries. The existing 5000-case unit/metadata/occurrence corpus and frozen provider files are unchanged.

At 4000 rows, measured reads are 31 for a selected mapping, 0 for clean corrections, 60 for unique append, 72 for response arrival, 99 for duplicate append and 40 for one exception correction. Tests enforce the unchanged earlier append/ordinal bounds plus new selected-mapping and sparse/dense correction bounds. The 100-exception case bounds reads by actual duplicate work, rather than clean history size.

Five controls reject wrong last eligible, name, ordinal, written-use count and retention of all IDs. The latter takes 4603 reads against `<50`. All mutated targets restore with cmp and SHA-256 before final acceptance. These establish behavior and read budgets, not retained-heap acceptance. Repeated assertions check old pins before and after mutation; no prohibited touched audit finding is accepted. Raw logs, JUnit, exact PIDs and source inventories are under `tmp/854-notes/p5/kimi-corrections-run-h/`.

## Remaining work

Request-only Kimi tail continuation, including a future tail duplicate that overrides earlier journal mappings, remains open. No pending-ID tail overlay is claimed. Full format/settings keys and generations, summary/LENS measurement and stored holder name/token/byte remeasurement are not wired. `RowEntry.unmappedBlocks` and its row-prefix aggregate are not populated by this group. The complete unmapped digit sequence, conversion-order ranks and subtraction for dropped fallback uses remain open; the mapped digit correction must not be reported as a full byte/token total.

Mistral lazy/tail continuation, full 10k/100k/1M retained-heap acceptance, row-range whole-record CRC closure, Stage A completion and W26/W23/W25/default dependencies remain open. Sends still use the complete old normalizer.

See [PHASE5-KIMI-DECISIONS.md](PHASE5-KIMI-DECISIONS.md), [LOGDECISIONS.md](LOGDECISIONS.md) and the source-bound correction proof. Review skipped per Andrew 2026-10-09. No cleanup, obstruction move, .llxprt edit/staging, unrelated declaration/recovery staging, OCR, push or merge. The 293 pre-existing generated declarations and raw recovery material remain excluded.
