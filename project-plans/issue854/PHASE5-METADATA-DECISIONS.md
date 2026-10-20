# Indexed unit metadata decisions, 2026-10-20

The first increment persists the contribution of each native row and exposes `VersionSnapshot.units`, `unitsBelow(label)` and `unitAt(index)`. Count comes from the pinned trailer. Rank and selection descend the row tree using child aggregates. They do not enumerate row content.

Three remaining bits of the existing entry flags encode stripped part-0 self, split part-1 self and reconstructed adjacency. `reconBlocks` counts reconstructed blocks, but contributes one unit when nonzero. `answered` counts distinct real-call slots, contributing one adjacent unit when nonzero. These bits do not change the 1112-byte entry or provider summary layouts. Uncurated entries cannot carry contribution bits. Existing padding and invalid-entry assertions remain unchanged. Journals from earlier implementation increments are not a supported resume format.

The empty-id fact records the first tool response in `Rt` for reconstruction only. It still has no real-response `R` or best pointer, and the empty id is excluded from call targets and adjacent slots. This avoids replaying empty-id occurrences to locate its first reconstructed unit.

Append now uses the same segment builder as other mutations. Dirty contribution labels come only from IDs in the added rows, not all historical IDs. Existing call/reconstruction rows are updated by path copying. Rebuild first writes its row/fact index, then streams only headers and ID pieces through a bounded contribution-tree build after all source facts are known. No block bodies or history-sized row map are needed. This additional index pass belongs to a rebuild, not a request prelude.

The initial native RED expected eight units but the snapshot had no count API. A second RED found the missing empty reconstruction contribution, expected two units versus one. Initial GREEN includes native count/rank, reconstruction, publication and pop suites, strict test-inclusive core types and zero-warning scoped ESLint. Raw receipts are in `tmp/854-notes/p5/metadata-run-d/`.

This increment does not claim normalized namespace maintenance, provider format/settings summaries, pending-tail indexed metadata, full mutation/heap acceptance or CRC closure. Production provider routing and the default backend remain unchanged. Review skipped per Andrew 2026-10-09.
