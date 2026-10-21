# Phase 5 request-only Kimi mappings, 2026-10-20

Request-only Kimi last-eligible mapping continuation is committed as `2c421e8605379403b5a4eb6d87a38d4b22189411`, starting at `c96764e45`. It reuses `IndexedJournalRequestSnapshot`'s held pin, source and affected-row view. Provider sends and the backend default are unchanged. `PHASE5-KIMI-TAIL-PROOF.json` records the separate source boundary and serial verification receipts.

## Implemented boundary

The request snapshot exposes `kimiMappedId(rawId)`, `kimiName(rawId)`, `kimiOrdinal(rawId)` and `kimiEligibleCount()`, plus `withKimi` for callback use under one query hold. Ordinals are zero-based. An unnamed pending call cannot steal an eligible mapping. Named pending duplicates, including non-AI calls, override earlier journal uses without rewriting their rows or storing a mapped ID in history.

`JournalRequestKimi` consumes the existing affected/tail rows, not another normalization adapter. The persisted writer and request queries share `RowOccurrences`. Final emitted calls, including R1 reconstructed duplicates and split parts, determine eligibility and row-local rank. A request retains only the last eligible occurrence per ID appearing in affected units and a scalar eligible-count delta per affected row. Untouched IDs use the native pinned last-eligible fact. Native tree prefixes plus preceding affected-row deltas produce the global ordinal; no query walks all calls or IDs. Name lookup reads one selected source block and copies only its name through UTF-16LE, preserving lone surrogates without retaining unrelated text.

Pending input is never appended, popped or filled into persistent state. Its source owns the existing pending view. A request based on an older pin remains isolated from later appends. Callback preparation, abort and consumer failures retain their original identity even if final release fails. The normalized occurrence callback and iterator APIs continue to use the same pin discipline.

## Verification boundary

Final acceptance on the committed source passes **98 tests, zero failures, zero skips and 3,083,710 assertions**, across 15 files and 30 isolated serial Bun processes over both outer backends. Both the Kimi and normalized-tail 5000-case differentials ran on each backend. Seven scoped gates pass: core declarations, strict core types, provider types, zero-warning ESLint, Prettier, affected-shard graph and AST audit. Graph validation does not establish that all affected shard tests ran. Touched audit findings are three `DUP_ASSERT` reports across separate pin, counter and input-immutability boundaries; none of the prohibited categories is accepted.

| Journal rows | Calls | Preparation | Count | Ordinal | Tail mapping | Native mapping/name |
|---|---:|---:|---:|---:|---:|---:|
| 40 | 40 | 18 | 3 | 6 | 1 | 10 |
| 4000 | 4000 | 30 | 3 | 9 | 1 | 21 |
| 100000 | 4000 | 40 | 3 | 9 | 1 | 27 |

Both backend runs produced these metadata-head counts. Preparation and mapping count/ordinal/tail queries read zero journal blocks and whole bodies. Selecting a native name reads exactly one block and no whole body. The unchanged bounds are `<120` preparation and `<150` per query. The history-walk mutation took 4575 reads against `<150`; the wrong precedence, ordinal and non-AI eligibility mutations also fail their behavioral assertions. Every target restores with cmp and SHA-256.

The source-bound proof covers 12 committed paths, the 8870-entry source inventory, 1206 preservation hashes and 188 raw receipts. All 131 recorded child/driver PIDs are absent. The 293 unrelated declarations, raw recovery material, frozen corpus, goldens and `.llxprt` match their preservation hashes.

The independent oracle recomputes old-normalizer output and uses the actual tools mapper. All 5000 frozen inputs retain their input/output hashes; the test also checks input hashes after queries. Named cases cover renamed/unnamed duplicates, all-speaker eligibility, reconstructed/default names, best-response relocation, raw empty/prefix collisions and older roots. Append, native removal rebuild and prefix-pop compare both no-tail and pending-tail queries with independently normalized units. The provider test compares actual `streamChatMessages` output using request-derived mappings with independent full conversion, including fallback consumption, dropped non-AI outputs and ordinal boundaries 9/10/99/100. Its test-only ID map is not production request state.

The broader matrix remains **not green** because of the unchanged codec sanitizer failure [#3917](https://github.com/vybestack/llxprt-code/issues/3917). This run reproduced seed `609796497` on the complete unchanged codec file: **39 passes, one failure, zero skips and 536 assertions**. An own `__proto__` JSON key is lost through assignment into `{}`. Codec, sanitizer and test hashes match starting HEAD. It was not retried for green or skipped. Earlier matrix receipts remain in `PHASE5-TAIL-QUERIES-PROOF.json`.

The original 100000-call fixture exceeded its unchanged 120000 ms test deadline while constructing native facts, before request preparation. The final scaling fixture uses 40/4000/100000 rows with 40/4000/4000 calls; text rows supply the last case's remaining rows, and the last call stays at the last journal row. This establishes query cost at 100000 rows, not 100000-call construction capacity. The construction stress remains unproved and its failure receipt is retained. No timeout, read bound or existing resource test was changed.

The first implementation of the shared native prefix added a second tree descent to ordinal queries. The unchanged dense-correction read bound rejected 3185 reads against `<2500`. Prefix and ordinal selection now share a single descent; the bound was not weakened. Initial missing-API RED, a name-helper insertion syntax error, lint failures, the wrong provider typecheck configuration and fixture authoring failures remain under `tmp/854-notes/p5/kimi-tail-run-j/`. The provider baseline needed its real tool store; media comparison then needed to consume yielded parts rather than compare function identity. The acceptance driver's preservation check also compared compact JSON with an indented JSON file. All 1206 content hashes matched after parsing, and that harness check was repaired without rerunning tests. Early formatter logs reused one name; the proof records those missing earlier log bodies and the three initial shell-only wrapper PID receipts. Final acceptance, controls and gate receipts have unique names and exact child/driver PIDs.

## Remaining work

This is the last-eligible/name/ordinal group, not complete provider integration. A stateful per-request fallback mapper must start at the request eligible count and consume IDs in actual conversion order, including uses whose messages are later dropped. Consumed and written uses must remain distinct. Complete fallback digit/rank arithmetic, unmapped row-prefix aggregates, dropped-use subtraction and affected-holder name/token/byte remeasurement remain open.

Mistral tail used-ID continuation, format/settings keys and generations, summary/LENS, full 10k/100k/1M retained-heap acceptance and whole-record range CRC closure remain open. No zero or placeholder length is claimed. Stage A completion, W26 scratch, W23's eight planning/header cases and W25/default dependencies remain open. Sends still use the old normalizer. Read-budget controls do not establish retained heap.

Review skipped per Andrew 2026-10-09. No cleanup, generated-obstruction move, .llxprt edit/staging, unrelated declaration/recovery staging, OCR, push or merge belongs to this slice. The 293 pre-existing untracked agent declarations and raw recovery material remain excluded.
