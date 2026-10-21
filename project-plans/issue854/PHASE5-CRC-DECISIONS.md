# Phase 5 range integrity decisions

## Contract and layout

Starting revision: `31534370cf574f721cc36455797e383c077e5d66`. Its file format is version 7. The defect is that `readStoredBlock` returned a body range after validating the frame header, without checking those payload bytes. Full-row reads already check the whole-body CRC.

Version 8 adds a four-byte little-endian CRC-32 suffix after the id piece, metadata piece and every block, including empty pieces. Existing header lengths describe payloads only. Directory offsets include preceding suffixes. Pieces are contiguous and the last suffix ends exactly at `bodyLen`. The header dimensions, offset-field classifications, row entries and tree aggregates do not change. All earlier file versions are refused; there is no migration or alternate decoding branch.

The existing frame CRC is the metadata CRC for this layout. It covers frame kind, flags, header/body lengths, row label, original stored owner, id tuples and every block boundary/type. No separate checksum directory needs trusting. A changed suffix fails the payload CRC check. CRC-32 covers accidental damage and incomplete writes, not adversarial changes that recompute all relevant checksums. No cryptographic guarantee is claimed.

A selected-block read validates the frame and directory, then reads exactly that payload plus its suffix. It does not verify the id piece, metadata or other blocks, or the whole-body CRC. Metadata reads verify ids and metadata. Rebuilds verify ids and the header without checking blocks. Full-row reads verify the whole-body CRC and all piece CRCs before returning their result. Whole-record copying and scanner hashing retain the existing streaming whole-body CRC check. The recording scanner also decodes and checks pieces using the same body splitter as full-row reads.

Unread damage remains undetected until a relevant read, full-row read, scan or full-record copy reaches it. A header prefetch may physically fetch some later bytes; that does not mean those bytes have been verified. There is no full-file or whole-ROW rescan for each selected block.

## Production wiring and ownership

`encodeContentRow` serializes each block once for the current row. `encodeRowDraft` supplies already serialized pieces to `rowPieceParts`, which computes each suffix as the existing frame writer consumes the pieces. The frame writer still folds its independent whole-body CRC while writing. There is no whole-body concatenation or history-sized retained structure. This change does not eliminate the existing one-row serialization allocation.

Clone and compaction use `appendSourceRecord`: they preserve the ROW header and streamed body, checking the whole-body CRC during copying. Owner changes live in row entries, so an entry's current owner may legitimately differ from the immutable stored ROW owner. Comparing those owners would reject valid owner edits and transfers. The frame CRC protects the original stored owner; existing source-owner dictionary validation remains responsible for live owner identity.

Reached CRC failures retain the journal path, ROW offset, pinned trailer offset and original cause via `RecordAccess.recordError`. A physical short read has a distinct error class so committed record access can wrap truncation with the same context without treating unrelated I/O errors as checksum failures. Pin leases forward this operation and preserve their existing release rules. No CRC failure falls back to full rows, an old normalizer or an older trailer.

## Evidence boundaries

The root RED is the independent public `VersionSnapshot.readBlock` test on version 7: selected corruption was returned successfully, both with and without repairing the outer body CRC. A multiblock case showed the untouched block still readable but the damaged block incorrectly returned. The truncated-range RED separately lacked committed-record context.

Final source commit `e674f3c5fac34003daa2c38506ceced04ba7a175` follows the core implementation `bc57523d0`. The remaining reader changes supply wrong-reference locations; metadata reading semantics already satisfy the piece-check contract. Finalization compared all 19 scoped hashes with committed blobs and all 1569 inventory paths with disk. Completed tests and gates are reused because their sources and evidence hashes match. Raw CRC evidence lives at `tmp/p5/crc-run-1`; the older Kimi directory supplies only the unrelated-file preservation baseline.

The source-bound receipt records 603 passing tests, zero failures/skips and 625,252 assertions across 84 serial processes over 44 files. Forty files run on both backends; four additional format/framing/group-write/crash files run once. Nine gates pass, with no prohibited touched audit findings. The receipt binds exact source/log hashes and restored negative controls; its 1569-path source inventory is unchanged during acceptance. All 184 recorded driver/child PIDs are absent. Historical metadata/occurrence/converter input data, all 5000 frozen inputs, provider routing and the backend default are unchanged. Access-counting wrappers only forward the new error-context operation; their assertions and budgets are unchanged.

Full format/settings generations, summary/LENS, holder remeasurement, request-only digit summaries, retained heap at 10k/100k/1M, 100000-call construction, W26 and remaining Stage A/W23/W25/provider cutover are outside this slice. The separate own-`__proto__` codec failure #3917 remains RED and is not retried or suppressed. Review skipped per Andrew 2026-10-09.
