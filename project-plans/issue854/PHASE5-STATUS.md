# Phase 5 normalized pending-input queries, 2026-10-20

The normalized request-tail query slice is committed as `92beb284e4d7f58aeaadf6b9b379c92ccf7446f5`, starting at `7ccd44b5b750048efc7ee98ec091ff1b055d9c4c`. Its query tests and six scoped gates pass. The broader verification matrix is **not green**: it retains one reproduced, pre-existing codec failure, [#3917](https://github.com/vybestack/llxprt-code/issues/3917). Provider sends and the backend default are unchanged.

## Implemented boundary

`IndexedJournalRequestSnapshot` now answers namespace 1/2 call/result counts, one-based occurrence selection, last-at-or-after, strict successor and streamed half-open unit ranges. `withNormalized` shares one selected-ID view across callback queries. The source, current pin, affected-row overlay, unit count, pending metadata and `readAt` selection remain the existing request view.

The persisted writer and request queries share `RowOccurrences`, with injected source-fact lookup and pure normalizers. An affected journal row's old occurrence interval is replaced by its emitted virtual contribution. Unaffected intervals remain in the persisted trie. Selected positions are projected through affected-row count deltas and part offsets, so a new earlier adjacent unit shifts later positions consistently with `readAt`. Empty IDs, raw-prefix collisions and duplicate block multiplicity remain distinct where required. Queries restricted to a stateful cursor exclude responses before it.

Only actual pending-input IDs enter the raw-fact overlay. Each selected-ID query processes affected/tail row ID metadata one row at a time and binary-searches persisted occurrence intervals. Selected untouched journal positions use tree rank. There is no journal-prefix enumeration, history-sized retained map, payload decode for queries, operation file or process-global state. Callback and occurrence-iterator holds survive opener close; preparation, callback and abort errors preserve their identity if final release also fails.

## Verification and known failure

The four new files pass **36 tests and 2,948,448 assertions** in eight isolated serial processes over both outer backends. The oracle recomputes the complete old-normalizer output for all 5000 unchanged inputs, comprising twelve structural families. It checks count, selection, last, strict successor and ranges at every unit boundary, with exact pending membership and first-output ordinals. Seven named differentials cover tail best/tie selection, cross-speaker shifts, R1 duplicates, split parts, empty/prefix collisions and stateful duplicate calls. Pin tests cover an old root predating append, asynchronous callback consumption, iterator close and primary-error identity.

The broader matrix completed **130 isolated serial processes over 65 files: 931 passes, one failure, zero skips and 3,888,934 assertions**. The unchanged codec property test failed on fast-check seed `609796497`: `sanitizeParams` drops an own `__proto__` JSON key by assigning it into `{}`. The codec, sanitizer and test hashes match starting HEAD, and the minimized input reproduces the loss deterministically. The failure was not retried, skipped, narrowed or fixed in this slice. Only previously unexecuted files ran after it.

Six scoped gates pass: core declarations, strict test-inclusive core types, changed-file zero-warning ESLint, Prettier, affected-shard graph and AST audit. Graph validation does not establish execution of every affected shard. Three `DUP_ASSERT` reports span different iterator or read-measurement boundaries; no prohibited touched audit finding is accepted. Review skipped per Andrew 2026-10-09.

## Read budgets and controls

| Journal rows | Preparation | Count | Successor | Last | Range |
|---|---:|---:|---:|---:|---:|
| 40 | 17 | 3 | 13 | 2 | 14 |
| 4000 | 27 | 3 | 25 | 2 | 26 |
| 100000 | 37 | 3 | 37 | 2 | 38 |

Both backend runs give these metadata-head counts with a fixed tail. Preparation and queries read zero blocks and zero whole bodies. Reading the selected call unit then reads exactly one block and no whole body. Existing `<120` preparation and `<150` query bounds remain unchanged.

Wrong tail precedence, omitted coordinate shifts and history copying each fail actual assertions. The copying control takes 4575/114292 reads at 4000/100000 rows against `<150`. All targets restore with cmp and SHA-256 before final verification. These are read-budget results, not retained-heap acceptance.

[PHASE5-TAIL-QUERIES-PROOF.json](PHASE5-TAIL-QUERIES-PROOF.json) binds 11 committed source/test paths, the 8863-entry source inventory and 316 raw receipt hashes. All 184 recorded child/driver PIDs are absent; none live. Logs, JUnit and inventories are under `tmp/854-notes/p5/tail-queries-run-i/`.

## Remaining work

This is **not full tail Kimi**. Native emitted Kimi mappings/corrections and Mistral persistent mappings remain implemented, but tail duplicates do not yet replace earlier Kimi mappings through this view. Mistral tail continuation must read native namespace 3 plus a tail-bounded used-ID overlay; it is not wired here.

Complete fallback digit/rank accounting, unmapped row-prefix aggregates, holder name/token/byte remeasurement, format/settings generations and summaries/LENS remain open. No placeholder lengths or completed LENS are claimed. Full 10k/100k/1M retained heap, whole-record range CRC, Stage A completion, W26 scratch, W23's eight planning/header cases and W25/default dependencies remain open. Sends still use the old normalizer.

No cleanup, obstruction move, .llxprt edit/staging, generated declaration/recovery staging, OCR, push or merge. The 293 pre-existing untracked agent declarations and raw recovery material remain excluded. See [PHASE5-PROOF-MAP.md](PHASE5-PROOF-MAP.md), [LOGDECISIONS.md](LOGDECISIONS.md) and the earlier Kimi/Mistral proof files for their separate boundaries.
