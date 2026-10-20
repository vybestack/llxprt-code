# W23 suffix, curation and borrowed-snapshot closure, 2026-10-20

The two remaining green tests are committed at `2d1514862`. This closes the bounded twelve-path candidate queue at the coverage boundaries below. W23 remains partial. Production fixes `9341be42c` and `ef6930515` are preserved; this finalization changes no production code or default.

Machine-readable case identities, complete tested source hashes, commands, receipt hashes, controls and PID checks are in `W23-CURATION-PROOF.json`. Raw authority is `tmp/854-notes/p4/w23/curation-run-g/`. This is new evidence, not recovered historical output.

## Executed cases and backend reachability

The effective matrix selects one matching green receipt per path and outer environment. It contains fourteen paths, twenty-eight isolated file executions, **260 passes, zero failures and zero skips**. The original twelve paths supply 238 passes; scalar and provider-caller supplements add 22. Of those case executions, 122 are native-only, four run both native and old internally, 96 are old-only, and 38 cover shared pipeline/static controls. These are execution counts, including repeated explicit-native cases under the old outer environment. Outer environment does not override an explicitly selected backend, and shared pipeline/static cases are not promoted to native-history claims.

| Original candidate or supplement | Passes per outer environment | Actual coverage and accepted lane |
| --- | ---: | --- |
| `history-suffix-stream.test.ts` | 10 | Real selected recorder/HistoryService at 512/8192 rows; slice numeric domains, reverse contiguous token oracle, first-next pinning, zero-weight rows, overflow and empty history. `closure-dependencies-h`. |
| `history-suffix-lifecycle.test.ts` | 15 | Selected real service, return/break/throw/abort and pre-cancel; reverse callback owns its decoded row; one-owner traversal, no eager/whole-file read, retaining-consumer rejection. Old scratch creation remains checked; native creates no suffix scratch and pinned reads survive public clear. `closure-dependencies-h`. |
| `history-suffix-memory.test.ts` | 4 | Real service/recorder child workers at 512/8192 rows, five paired measurements for recent/tokens, unchanged 1 MiB heap/external limits. Each eager full-suffix trap must reject the same estimator. `closure-dependencies-h`. |
| `provider-curated-stream.test.ts` | 14 | Committed selected service, 512/8192 mixed rows, independent eager oracle, all R1-R8 input rules and repeatable snapshot readers/readAt/pending facts. One explicit-old materialization guard remains; two pending-input cases preserve their existing input boundary. `public-b`. |
| `provider-curated-lifecycle.test.ts` | 17 | Public committed snapshot counterparts cover return/throw/break/consumer-throw, close/reopen, preparation cancellation and active/unopened abort identity; the original large-row service case remains. Shared normalization-generator cases retain staging, backpressure, source/scratch failure, retention and pre-serialization scoring checks. Eleven shared cases are not eleven native disk-source tests. `public-b`. |
| `provider-curated-faults.test.ts` | 4 | Actual selected service tests cursor membership; explicit journal service injects real row-read failure and proves fresh preparation, released owners and one decoded row. Original missing-root/staged-write scratch faults remain shared pipeline contracts, not distinct native storage faults. `public-b`. |
| `provider-curated-structure.test.ts` | 2 | Shared static source rule and rejecting eager/caching examples. No runtime native claim. Unchanged `baseline` receipts. |
| `borrowed-snapshot-lifecycle.test.ts` | 18 | Explicit old store/recorder internals, regardless of outer environment. Complete values, callback failure/stop, nested readers, abort identity, idempotent close, census and descriptor release. Unchanged `baseline` receipts; native counterparts are the next row. |
| `borrowed-snapshot-controls.test.ts` | 4 | Explicit old store, 512/8192 retained-object rejection and simultaneous/unstarted reader scope. Unchanged `baseline`; native equivalents are in the native controls suite. |
| `borrowed-snapshot-lifecycle.journal.test.ts` | 20 | Explicit journal HistoryService and real recorder at 512/8192 rows and one 9 MiB row. Six lifecycle behaviors at each size, plus in-scope row-fact abort and callback-plus-cleanup ordered aggregation. Helper checks complete decoded/released census, acquisitions/releases, zero live ownership and peak two. `public-b`. |
| `borrowed-snapshot-controls.journal.test.ts` | 8 | Explicit journal, pinned clear at both scales, escaped-reader liveness, simultaneous/unstarted readers, real retained-object rejection, plus source ordinals/owners/chronology across append and public clear with no metadata row decode. `facts-a`. |
| agents `provider-curated-recomposition.test.ts` | 3 | Each scale executes both old and journal through the real handler source ladder and density-driven reopening; independent old-format bytes, pending input and materialization trap remain. No replacement adapter or array-backed actual source. `closure-dependencies-h`. |
| Supplement: `journalHistoryStore.scalars.test.ts` | 7 | Explicit native store. At 8192 rows, aggregate statistics/context use zero row reads; newest and each speaker use four total row reads, with whole-history entries forbidden. Also retains original marker, rewind, rollback and empty cases. `facts-a`. |
| Supplement: providers `journal-curated-source-failure.test.ts` | 4 | Committed selected HistoryService snapshot reaches the existing requestRows seam and actual Chat, both Responses and Anthropic provider callers. Producer failure retains exact identity, releases source ownership, enters no HTTP transport and leaves the independently owned snapshot repeatable. `public-b`. |

The JSON records every executed classname/name, rather than treating file membership as case coverage. Old borrowed synchronous iterator/descriptors and native asynchronous row-view/pins intentionally remain separate protocols. Their public value, failure, cancellation and ownership counterparts run through the existing service boundary. Native metadata reads are proved independently; no second production adapter was added.

## Root causes and RED evidence

`journalSuffix.ts:24-35` previously decoded reverse-selection candidates without `countDecodedRow`. The token callback therefore observed zero owners. The fix charges each candidate while the callback runs and releases in `finally`; `streamSnapshotRows` forwards the existing counter. The callback test requires one live row during counting, two acquisitions before its second-row failure, zero live rows afterward and the original callback error.

`journalScalars.ts:270-296` previously allowed `view.close()` in `finally` to replace the callback failure. It now preserves the primary alone when cleanup succeeds, or reports `[primary, cleanup]` in that order. `journalRowCounters.ts:34-44` now decrements decoded accounting even when ownership release throws. The test acquires two independent readers, fails one release, requires every reader to close, inspects the ordered nested errors and opens a fresh reader. The fixture independently balances decoded/released counts and ownership acquisitions/releases.

Original before-fix logs remain in `baseline/001.log`, `suffix-callback-red.log` and `borrowed-red.log`; intermediate fixture/format failures remain excluded from positive totals. Finalization also restores the actual parent-commit source for each production fix:

| Control | Observed result | Restoration |
| --- | --- | --- |
| `closure-h/original-suffix` | 0 pass/1 failure at the one-owner callback assertion, using `9341be42c^` suffix/scalar source | Accepted source copies restored in `finally`; both `cmp` calls return zero; restored callback passes. |
| `closure-h/original-callback` | 0 pass/1 failure at ordered primary-error identity, using `ef6930515^` scalar/counter source | Both files restored and byte-compared; restored two-reader aggregation passes. |
| `closure-h/facts-decode-trap` | 0 pass/1 failure at acquisitions conservation, expected 0/received 3 after real metadata row decoding | Scalar source restored and compared; restored pinned-facts case passes. |
| `closure-h/scalar-extra-read-trap` | 0 pass/1 failure at decoded row count, expected 4/received 5 | Scalar source restored and compared; restored scalar case passes. |

These are targeted controls, with other names filtered out rather than skipped tests. They are excluded from the twenty-eight-file positive matrix. Original retaining controls remain at 512/8192, 440 rows/8 MiB, one-owner/1 MiB traversal and the existing 1 MiB paired retained allowance; no bounds, assertions, seeds or timeouts were reduced.

## Source and gate boundary

The two WIP source hashes exactly match completed `facts-a` receipts:

- `borrowed-snapshot-controls.journal.test.ts`: `7f4d0bde70ccf54bca0012dd757dda56b19b061a1b2cb8cd4980fb5cde471e34`.
- `journalHistoryStore.scalars.test.ts`: `2251538d30c6d2d6b5a0f025a9e1ae5bb52fdd3482f5f33b286f93d975ffb3a1`.

Reuse `public-b` and `facts-a`, plus unchanged explicit-old/static baseline receipts. Only four suffix/recomposition dependency paths receive a final-source serial lane because their native production dependencies changed after the earlier receipts. No provider corpus, repeated-turn retention worker or whole-package sweep is repeated for handoff. The JSON verifies current test hashes against committed blobs and each accepted raw/JUnit summary; its package census records every baseline-to-final source difference.

All ten saved `public-gates-b` checks pass: core/agents/providers declaration builds, their established strict type checks, zero-warning touched lint, format, affected graph and audit. Finalization adds strict core noemit, lint/format for the two WIP files, full audit and final affected-graph validation. Declaration emission is not a full build; agents/providers test-bun projects are separate from their noemit roots. Graph validation is not affected-shard execution.

The audit's one new SELF_CONFIRMING notice is a before/after acquisition-conservation assertion around real append/clear/metadata operations. The metadata-decode trap fails that exact assertion at 0 versus 3, so it is not a configured expected-value echo. Keep the assertion and scanner policy unchanged. Duplicate notices compare pin length or zero ownership/scratch at distinct lifecycle points, or independently reopen the same snapshot. No new MOCK_MIRROR, ALWAYS_TRUE or NO_ASSERT finding is accepted. Original target assertions are retained by tokenized TypeScript AST comparison in the JSON; no original cases or failure domains are dropped.

## Remaining work and stop boundary

This closes the named twelve-path queue only with the explicit native/shared/old distinctions above. It does not establish every low-level scratch fault as a new native disk-source test or claim whole-package native parity. Full native 5000-seed corpora, randomized purge, wider frontend restoration/concurrency/cancellation variants and remaining wider trap mappings stay open. Eight before-row-decode planning/header RED cases remain on the phases 5/6 through 7 dependency. Phase-4 spools, W24 write amplification/topology, W25 selection, W26 scratch/seam removal and later phases remain unchanged.

All recorded run/control PIDs are checked absent in the JSON; no mutation or restoration remains active. No cleanup, obstruction move, `.llxprt/` edit/staging, raw recovery bulk staging, skip, weaker check, OCR, push, merge or default flip. Review skipped per Andrew 2026-10-09.
