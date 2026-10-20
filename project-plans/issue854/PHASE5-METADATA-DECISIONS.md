# Indexed unit metadata decisions, 2026-10-20

The first increment persists the contribution of each native row and exposes `VersionSnapshot.units`, `unitsBelow(label)` and `unitAt(index)`. Count comes from the pinned trailer. Rank and selection descend the row tree using child aggregates. They do not enumerate row content.

Three remaining bits of the existing entry flags encode stripped part-0 self, split part-1 self and reconstructed adjacency. `reconBlocks` counts reconstructed blocks, but contributes one unit when nonzero. `answered` counts distinct real-call slots, contributing one adjacent unit when nonzero. These bits do not change the 1112-byte entry or provider summary layouts. Uncurated entries cannot carry contribution bits. Existing padding and invalid-entry assertions remain unchanged. Journals from earlier implementation increments are not a supported resume format.

The empty-id fact records the first tool response in `Rt` for reconstruction only. It still has no real-response `R` or best pointer, and the empty id is excluded from call targets and adjacent slots. This avoids replaying empty-id occurrences to locate its first reconstructed unit.

Append now uses the same segment builder as other mutations. Dirty contribution labels come only from IDs in the added rows, not all historical IDs. Existing call/reconstruction rows are updated by path copying. Rebuild first writes its row/fact index, then streams only headers and ID pieces through a bounded contribution-tree build after all source facts are known. No block bodies or history-sized row map are needed. This additional index pass belongs to a rebuild, not a request prelude.

The initial native RED expected eight units but the snapshot had no count API. A second RED found the missing empty reconstruction contribution, expected two units versus one. Initial GREEN includes native count/rank, reconstruction, publication and pop suites, strict test-inclusive core types and zero-warning scoped ESLint. Raw receipts are in `tmp/854-notes/p5/metadata-run-d/`.

The second increment adds an indexed request snapshot. Its prelude stores descriptors only for tail rows and tail-related journal targets. Target labels come from ID facts, output starts from native prefix sums, and within-row pending membership from a small bit mask. Count and first pending output are scalars. A curated-successor query supplies the single look-ahead row needed by indexed plan selection. `readAt` does not enumerate preceding units. The snapshot owns the encoded tail and one hold on the native pin; closing it releases that hold.

File admission now requires version 4. Reusing version 3 would silently admit journals whose entries lack contribution bits and return wrong counts. A CRC-correct version-3 header was accepted in the format RED; the version change makes it fail admission. Existing layout widths remain unchanged. This is a format replacement, not a compatibility shim.

The broad native regression matrix exposed two old test-model assumptions: the naive fact model excluded empty IDs from `Rt`, and the mutation model expected only source flags in entries. Both models now include the newly specified fields, without dropping equality assertions. Frozen 5000-case and provider-wire fixtures remain unchanged. The named native empty-ID test separately verifies that `Rt` exists while `R` and `best` remain absent.

Two controls insert a full prefix rescan or retain all per-row counts during snapshot creation. Each fails the existing metadata-read bound; restoration is byte-checked. These controls establish that the read budget detects those implementations. They do not establish the pending full retained-heap claim.

The test audit reports two `DUP_ASSERT` findings in the indexed metadata matrix: the same pinned count before and after a later append, and zero payload reads at two independently reset measurement boundaries. Both assertions are retained because each tests a different state. No `MOCK_MIRROR`, `ALWAYS_TRUE`, `SELF_CONFIRMING` or `NO_ASSERT` finding is accepted on touched tests.

Normalized namespace maintenance, provider format/settings summaries, full mutation/heap acceptance and CRC closure remain open. Production provider routing and the default backend remain unchanged. Review skipped per Andrew 2026-10-09.
