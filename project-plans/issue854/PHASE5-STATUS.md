# Phase 5 reconstruction and tail increment, 2026-10-20

R1 and tail emission now match all 5000 immutable cases, including output hashes, unit counts, pending membership and the first pending ordinal. Phase 5 remains partial. Starting HEAD was verified as `29bcdd89f9ef7e029f25d0d7334392ded0b1565d` on `issue854`. The first green R1 group is `57d30e894`. Production sends still use the old normalizer; no default changed.

## Implemented boundary

`streamJournalResponsePlans` yields provider-independent unit headers and block references. `openBlocks()` resolves one referenced block at a time. Plans retain the current/next part descriptors, current-unit slot/media references and pending-input facts. The compatibility `streamJournalResponseUnitRecords` materializes one emitted `IContent` and supplies its pending flag; `streamJournalResponseUnits` yields its content. Both hold the native snapshot through asynchronous consumption and release it on return or failure. Cached tail facts reject reads after pin release.

R1 reconstructs a single AI unit per tool part from the qualifying response blocks in original block order, including duplicate unseen IDs. Names come from those response blocks, with the old fallback, description, parameters and synthetic metadata. The target distinguishes reconstructed units from real calls at the same source part. Earlier non-tool responses can supply the selected response while the later first tool response determines reconstruction. Empty IDs use the stored empty-call fact and one scalar recording prior empty reconstruction; no history-sized unmatched-call set is retained.

`JournalTailSource` assigns virtual positions after journal labels, copies only pending payloads into owned encoded blocks, and builds an overlay containing only pending IDs. It merges journal facts with tail occurrences using the existing update rule, including strictly-better selection and earliest equal-score ties. A tail result can replace a response beside the first journal call without visiting the intervening journal prefix. Split coordinates and shared-tail-block identity preserve the old metadata decision. No per-operation file or whole-history clone is used.

## Bounded reads and wired fields

Native `readBlock` uses the ROW directory to read only that block's range. `readMetadata` reads header/id/metadata pieces without decoding row blocks. Lazy self plans omit stripped responses/media before fetching bodies; reconstructed plans refer back to their response blocks. The range test has more than 2 MiB of unrelated source text. A lazy adjacent unit with three large relocated responses and stored image references performs no payload-sized reads until its first block is consumed. The compatibility collector intentionally materializes its current output unit.

Range reads validate the frame, row label, directory and requested range. They do **not** recompute a whole-body CRC from unselected bytes. The existing full-row reader retains its body-CRC check. This distinction is explicit in the range API and is not whole-record corruption coverage.

| Field or API | Status |
| --- | --- |
| R1 through R8 unit order, targets, slots, media and metadata | Implemented and exercised by frozen and named native differentials. |
| Native source `C`, `Ca`, `R`, `Rt`, `best` | Queried from the pinned trie; tail facts merged only for pending IDs. Missing real-response `best` fails instead of falling back to a call. |
| Pending membership | Supplied per emitted unit, including relocated journal-adjacent units and synthetic tail orphan results. |
| Indexed `count`, `readAt`, `pending.firstOutputIndex` prelude | **Not implemented.** Test collectors count emitted units and locate the first true pending flag. No indexed-prefix-rank claim. |
| Persistent normalized occurrences and counts | **Not implemented.** Namespaces 1/2 on source views still reject. Pure normalizer injection is unchanged. |
| `reconBlocks`, `answered`, contribution flags, unit aggregates | Still not maintained by normalization; native source-field wiring from the earlier increment remains. |
| Format/settings keys, `mappedRef`, mapping exceptions, `LENS`, transfer summaries | Not wired by this increment. |
| Production provider conversion and routing | Unchanged. |

## Verification

Final implementation is `abfd39888d71a069f8dbc89182e833138328b028`. Acceptance is **80 isolated serial processes over 40 files, 588 passes, 205292 assertions, zero failures/skips**. Six scoped gates pass: declaration-only build, strict test-inclusive core types, zero-warning touched ESLint, Prettier, affected-shard graph and AST test audit. All 22 source paths match committed blobs; touched audit findings are empty. The 189 recorded job PIDs are absent. The matrix and gates are bound to source hashes in [PHASE5-TAIL-PROOF.json](PHASE5-TAIL-PROOF.json). Each test file runs alone from `packages/core`, under both outer `LLXPRT_HISTORY_BACKEND=old` and `journal`. Native suites select native internally; this does not turn explicit-old regressions into native normalization proof. Graph validation is separate from executing affected shards. The earlier response-only receipts remain in [PHASE5-RESPONSES-PROOF.json](PHASE5-RESPONSES-PROOF.json).

Three controls fail and restore with `cmp`: reconstructed target assigned to the wrong unit, whole-history copying during tail preparation, and dropping selected responses. Additional tests reject invalid block coordinates, wrong response identities and missing best pointers. The frozen fixture, old normalizer and provider wire fixtures remain byte-identical to starting HEAD. Raw logs, JUnit, initial REDs, gate failures and source manifests remain in `tmp/854-notes/p5/tail-run-c/`.

An initial related compaction execution hit its unchanged 5000 ms deadline while cloning the sixth separate version. Its post-timeout cleanup caused an ENOENT. The seeded inputs and helper source match the passing first-R1 execution; later final-source acceptance is recorded separately. This increment does not claim a compaction fix or a proven cause of the wall-clock variance. No timeout, fixture, assertion or check was weakened.

## Remaining work before routing sends

Maintain normalized occurrence/contribution facts and unit aggregates through native mutation paths, then derive count/rank/first pending output from indexed prefixes without another whole-history pass. Complete the native mutation/compaction matrix, Stage A claims and 10k/100k/1M retained-heap proof with controls. Range APIs and lazy block-reference behavior are now tested, but full generator heap flatness and provider-native conversion are not proved. Format/settings integration, W26 scratch/ranking/chronology removal, phase 6/8 provider spools, W23 planning/header checks and W25/default requirements remain open.

No cleanup, deletion, obstruction move, `.llxprt` edit/staging, generated-declaration staging, raw-recovery bulk staging, OCR, push or merge. The 293 pre-existing untracked agent declarations remain excluded. Review skipped per Andrew 2026-10-09.
