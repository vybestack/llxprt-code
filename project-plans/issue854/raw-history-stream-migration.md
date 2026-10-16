# Raw-history bounded-return migration

## Status: first stage implemented; Criterion 1 remains open

This change does not remove `HistoryService.getRawHistory`. Its array return
and the associated structural finding remain. Removing that finding requires
migrating the compression algorithms and their mutation/rollback contracts.
No new eager adapter or compatibility shim was added. The existing accessor
has not been renamed or redirected to another eager accessor.

The first stage supplies `streamRawHistory(signal?)`, a cold async generator
backed by the journal's pinned, disk-backed pending fold. It captures membership
on the first `next()`, yields raw rows without curation or sanitization, and
releases reader ownership and the fold on completion, early return, or errors.
Cancellation is checked before capture, after opening the fold, before and after
reading each row, and at completion. Folding itself does not yet accept the
signal; cancellation during that operation is observed after it finishes.

`getCurrentTurnMarker()` now folds the raw stream into a scalar. Send-seam
join-key recording and compression lifecycle recording use that query.
`/perf memory` consumes raw rows through the streaming byte-accounting path,
which uses weak identity tracking instead of retaining every measured object.
The existing size formulas, media-reference sizing, metadata/error attribution,
top-response ranking, and diagnostic text are preserved.

## Required signature changes in this stage

- `recordTurnJoinContext` now returns `Promise<void>`.
- `recordSendSeamTelemetry` now returns `Promise<void>`; both production send
  seams await it before invoking the provider. Its single failure-reporting
  boundary catches asynchronous marker-read failures too.
- The CLI `HistoryServiceView` consumes `streamRawHistory` instead of the eager
  raw accessor for diagnostics. `/perf memory` is asynchronous.
- `getRawHistory(): readonly IContent[]` is unchanged for the remaining callers.
  Its required future migration is an async row stream, without an array shim.

## Remaining production raw-history consumers

| Consumer | Shared dependency that must also change |
| --- | --- |
| `CompressionHandler.ensureDensityOptimized` | `HighDensityStrategy.optimize` runs read/write pruning, file deduplication, then recency pruning. It stores indexed replacements/removals and builds `historyForRecency`; `DensityResult` and `HistoryServiceCore.applyDensityResult` consume context-length collections. |
| `truncateLargestToolResponses` and `truncateOversizedToolResponsesUnified` | Ranking retains all response payloads and estimates concurrently with `Promise.all`. Largest-first, newest-first ties, pending offsets, and failure diagnostics must survive an external sort. Each replacement then invokes the eager mutation and token-recalculation path. |
| `createHistoryGuard` | Every length comparison materializes history. Replacing it with another eager length accessor would preserve the cost. A scalar membership/revision guard needs to preserve the add/clear concurrency behavior and allow the truncator's own replacements. |
| `applyCompressionWithAnchor` | `annotateCompressionSpan` builds old/new seq sets, calculates destroyed membership, and transfers the semantic-media frontier. The subsequent `replaceAll` owns whole input for chronology, media reconciliation, rollback, and token accounting. |
| `ProviderContentEnforcer.captureFallbackState` | A full raw snapshot is retained for rollback. `restoreFallbackState` feeds that snapshot into `replaceAll`; failed candidate installation must restore history, cache anchor and prompt-token baseline together, preserving aggregate errors on rollback failure. |
| `scripts/issue-3199-media-memory-target.ts` | The media probe supplies raw history to the array-based request media resolver. This script is not a production agent caller, but still depends on the old signature. |

Compression also obtains history through `compressionContextBuilder` and
`ProviderContentEnforcer.recomposeProviderContents`, both using `getCurated`.
`getCuratedForProviderStream` itself still materializes and then yields an array.
Changing only the raw accessor cannot establish bounded costs through those
compression/provider paths.

Semantic-media purge independently retains `getAll()` snapshots and candidate
histories. This change preserves its existing frontier-transfer behavior and
size accounting; it does not establish bounded ownership for purge transactions.

## Coherent remaining stages

1. Introduce scoped disk-backed raw snapshots with addressed row reads and
   streaming replacement/restore transactions. Preserve atomic publication,
   writer ordering, media ownership, chronology rollback, and token errors.
   Token recalculation must walk rows without a full projection.
2. Move truncation candidate records and density indexes/results onto disk.
   Externally order candidates by estimated tokens, entry recency, and block
   recency. Estimate without retaining all blocks. Preserve the existing
   read/write, deduplication, recency phase ordering and their precedence.
3. Migrate compression annotation, fallback rollback, curated compression
   input, and provider recomposition to those scoped snapshots. Pin/replay
   provider request bodies across retries and release every owner on abort.
4. Change `getRawHistory` to the row-stream signature, migrate all tests and the
   media probe, and remove the eager implementation. The exact AST expectation
   is the disappearance of only `HistoryService.getRawHistory`; the other
   outstanding return findings must remain visible.

These stages are unfinished. The synchronous accessor contract is not the
reason to stop; the shared mutation, result, curation, and provider paths are
the specific remaining implementation work.

## Evidence and limits

Logs are under
`tmp/verify854/p05d/raw-history-stream-20260929-branch3/`.

New RED tests exercise 512/8192 real journal rows, uncompressed reads and
journal compression rewrites, media/error preservation, pinned membership,
pre-aborted and mid-read cancellation, marker lookup, real token-log output,
and real `/perf memory` output. Byte accounting also covers aliased streaming
inputs and failing iterators. Compression-rewrite tests use the real history
mutation/journal path; they do not prove bounded costs through a complete
compression-handler/provider turn.

Reader counters and explicit row ownership show one reader-owned yielded row.
They do not discover unregistered references or prove retained heap behavior.
No new statistical retained-heap acceptance test was completed for this slice.

Uncovered costs include O(N) marker scans and journal-fold work, cancellation
latency while folding, diagnostic buckets proportional to distinct tool names,
and the final diagnostic string. The byte-accounting stream does not retain
row payloads, but its entire diagnostic output is not constant-sized.

The full root typecheck was attempted. Its declaration-build prerequisite
failed on the existing CLI `dumpcontext-test-stream.ts` import of provider
source outside the CLI rootDir. Workspace typechecks were also attempted;
the agents Bun-test tsconfig reports an existing `Array.fromAsync` library
error in `pendingContextWindowEnforcement.toolTruncation.test.ts`. Scripts and
evals official tsconfigs passed. Neither config nor enforcement was weakened.
Two provider declarations emitted into source by the failed build were removed;
they were absent from the starting dirty-tree snapshot.

Initial adjacent-suite commands without `./` were interpreted as Bun filters
and ran archived test copies. Those runs are not evidence. Explicit single-file
reruns are recorded separately as `explicit-*.log` and `explicit-results.tsv`.

Final explicit-path verification passed 347 tests across 37 isolated suites,
including independent Anthropic/OpenAI Responses body-byte comparisons and
Responses retry-body stability. This is adjacent behavior evidence, not a
512/8192 end-to-end bounded compression/provider proof.

The full dirty TypeScript tree passes forced 800/80 ceilings with zero warnings;
normal repository lint, touched-file strict lint, dirty-file Prettier checks,
and `git diff --check` pass. Repository-wide Prettier reports two unchanged
files: `historySpanWindow.ts` and `semantic-media-purge.ts`. They were not
modified to satisfy this stage's gate.

The final test-audit findings TSV is identical to the starting baseline, with
no new findings. The exact structural finding list is also unchanged: eight
findings remain, including `HistoryService.getRawHistory`. The structural
suite consequently remains RED (17 passing controls/tests, three failing
production surface assertions). See `ast-progression.json` for the full list.
The starting `.llxprt` diff is unchanged (`protected-paths.json`).

No commit, push, OCR review, merge, upstream-main integration, or project-memory
edit was performed.
