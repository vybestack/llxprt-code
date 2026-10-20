# Phase 5 response increment, 2026-10-20

Phase 5 remains partial. This increment starts at verified `46b13bc9bf105d9df0d6e48fffbf5c78a43248f1` on `issue854`. The first green rule group was committed as `270ad3e81`; lifecycle accounting and native mutation tests are in `ad629b507a009f745e168081dd4e5947317b5e26`. Production sends still use the unchanged old normalizer. No backend default changes.

## Implemented boundary

`streamJournalResponseUnits` is a public typed `AsyncGenerator<IContent>` over a native `VersionSnapshot`. It reads the snapshot's own source-fact root, takes an additional pin hold through consumption, and releases it on completion, error or reader return. Closing the opener after the first yield does not invalidate that reader or admit later committed responses.

The generator walks curated rows once, splits tool-call rows, and retains current/next part descriptors containing native label, part, original block indices and header/id pieces. Per-part sets, slots and media references contain only the current conversion unit's IDs and selected blocks. `best` selects one response directly, including a future better duplicate, without collecting duplicate chains or scanning history per call. Equal scores keep the earliest response. Stored image references remain references; no blob resolver or provider conversion is invoked here.

| Rule or fact | Current state |
| --- | --- |
| R1 reconstruction | Unsupported. A source fact requiring a reconstructed target, including empty-ID tool continuity with no earlier empty call, throws `UnsupportedJournalNormalizationError`. No fallback or dropped case. |
| R2 targets | Existing real call targets of any speaker. Source coordinates use the native label and split-part block index, not owner or source ordinal. |
| R3 completion | Existing orphan rules remain, including cross-speaker C/Ca attachment and duplicate-orphan metadata behavior. |
| R4 selection/attachment | First-response slot order, best response content, stable equal-score duplicates, human-row results, raw prefix collisions and empty-response dropping with an existing empty call. |
| R5 media | References come from distinct first-response parts in source order. Each part's first newly attached response determines its media target. Duplicate-only response media is not moved. Media follows all response slots in block order. |
| R6 metadata | Retains metadata only for the exact completed successor, including own synthetic orphan successor. Pointer/index differences, interleaved media and better duplicates produce reordered metadata. |
| R7/R8 | Response/media stripping and curation remain active before emission. |
| Native source facts | Prior append/rebuild empty-ID, curation and split-coordinate production wiring remains. `VersionSnapshot.readIds` adds header/id-only look-ahead. |
| Normalized facts/contributions | Still not produced. Normalized namespaces 1/2 queries on production source views reject. No new namespace 3/5 mapping, `mappedRef`, entry `reconBlocks`/`answered`, contribution flags, unit-rank/count or readAt claim. |
| Tail/pending | Any nonempty tail throws explicitly before journal iteration. No pending-membership or first-output API is claimed. |
| Converter/settings keys | Not wired. Typed format settings, every-field key tests, LENS and transfer summaries remain required. |

Relocated block reads currently use the existing row-sized stored-row reader, decode the selected part, return one selected block and discard the other decoded content. They do not yet use range-only block reads. Multiple selected blocks in one source row can therefore reread that row. The stream does not retain prior self text while yielding its adjacent unit. Only selected output blocks accumulate in that unit. This is a scoped response implementation, not the completed I/O design of section 6.

## Differential and resources

All 5000 old-reference input/output/count/pending records still match the immutable fixture. Every seed also reaches the indexed response API: **3788 match frozen output hashes/counts, 497 reject reconstruction and 715 reject tails**, with zero unexplained refusals or differential failures. The refusal classifier independently names the fixture's structural families, including empty-ID continuity; it cannot silently reduce admitted coverage. The original 1436 orphan-only matches remain tested separately. These are twelve repeated structural families, not 5000 independent random structures. The fixture and the frozen provider files are unchanged against starting HEAD.

Twelve literal response differentials cover selection, media ordering, exact metadata, split coordinates, raw-ID collisions, empty IDs, mixed real/orphan slots and non-AI calls/results. A pin-lifetime case excludes later appends after opener close. Further native differentials cover density replacement/rebuild, swapped owner reuse, replace and reopen. Both 100- and 1000-response duplicate chains produce their best result within the unchanged fewer-than-100-read bound before their source prefixes are traversed. Existing compaction and owner regressions pass; those library regressions do not establish full response mutation/compaction parity.

The response resource test streams 2000 call/result pairs and 2000 media blocks without collecting output: zero creation attempts and the unchanged 65,536-byte id-node cache cap. The existing 4000-ID/8000-orphan-unit test and positive filesystem observer remain. Optional existing `JournalReadCounters`/`RowOwnership` charge each emitted unit's full JSON, including inline media, until its asynchronous yield ends. A greater-than-512-KiB response/media unit stays charged across suspension, preserves a stored reference and releases on cancellation. This measures explicit serialized output ownership, not retained JavaScript heap, referenced-row decode peaks or the required 10k/100k/1M generator flatness.

## Acceptance and remaining work

Final acceptance: **29 isolated serial Bun files, 227 passes, 43,495 assertions, zero failures/skips**. Six scoped gates pass: core declaration-only build, strict test-inclusive core noemit types, zero-warning touched ESLint, Prettier, affected-shard graph and AST test audit with zero touched findings. Graph validation is not shard execution; no whole-repository test/build claim is made.

Six final-source mutations reject and restore byte-identically: later-wins best tie, AI-only attachment, reversed media order, unbounded cache, operation file and early async row release. [PHASE5-RESPONSES-PROOF.json](PHASE5-RESPONSES-PROOF.json) binds eight implementation paths to their actual implementation-commit counterparts, 29 test/log/JUnit receipts, gates, controls, immutable files and **85 absent recorded PIDs**. Raw receipts are in `tmp/854-notes/p5/responses-run-b/`. The earlier source-fact proof remains in `PHASE5-PROOF.json`.

Still required before routing sends: full R1 and empty-response continuity, tail overlay/pending, range-only relocated reads, normalized occurrence/contribution maintenance, full 5000-case and mutation parity, Stage A claims and generator heap controls. W26 curated input/ranking/chronology scratch, phase 6/8 provider spools, W23 planning/header checks and W25/default remain open. This increment requests no deferral or approval gate.

Initial missing-module/behavior RED, the omitted-tail failure, an initial refusal-count error that omitted empty-ID reconstruction, resource-test registration, type/lint authoring failures and proof-launch buffer failure remain separate receipts. No assertions, bounds, timeouts or enforcement were loosened. No cleanup, obstruction move, `.llxprt` edit/staging, declaration/raw-recovery bulk staging, OCR, push or merge. The 293 pre-existing untracked agent declarations remain unstaged. Review skipped per Andrew 2026-10-09.
