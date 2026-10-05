# Curated-history migration: bounded callers implemented, Criterion 1 remains RED

## Implemented stage

`HistoryService.streamCuratedHistory(signal?)` is a cold async generator over
`journal.streamRows(undefined, signal)`. Curation uses the existing row-local
inclusion rule: human and tool rows always survive; AI rows need valid content.
The shared pending/durable fold uses disk-backed row indexes and pins membership
at the first `next()`. No new whole-history array adapter was added.

The generator releases its journal row and fold on exhaustion, return, throw,
consumer failure, and cancellation. Each active consumer owns at most one decoded
journal row. Separate consumers capture their own membership snapshots. As with
the existing raw stream, cancellation during initial folding is observed after
the fold finishes; folding itself does not take an AbortSignal.

Production reasoning accounting now consumes the generator. It accumulates total
thinking tokens and the last thinking-bearing row's token estimate as scalars,
then applies the existing `all`, `none`, and `allButLast` policies. A zero-token
last thinking block still designates the preserved row. Reasoning retained in
context returns the total token count without reading history. Compression
threshold and hard-limit projection callers await the new asynchronous result.

`ConversationManager.getHistory(true)` and `ChatSession.getHistory(true)` now
return curated generators. The only located production consumer of that branch,
`Turn.reportTurnError`, awaits `buildErrorReportContext`. That builder accepts
synchronous or asynchronous iterables and keeps an eight-row tail while counting
omitted rows. Request, endpoint, omission count, and recent-history values keep
their existing output shape. Default and false `getHistory` calls still return
uncurated readonly arrays.

## API changes

| API | New result |
| --- | --- |
| `HistoryService.streamCuratedHistory(signal?)` | Public `AsyncGenerator<IContent, void, unknown>`; replaces the private scalar-query stream helper |
| `computeEffectiveTokenCount` and `CompressionHandler.getEffectiveTokenCount` | `Promise<number>` |
| Compression handler and chat session `shouldCompress` | `Promise<boolean>` |
| Compression handler and chat session `getProjectedPromptBaseline` | `Promise<number>` |
| Curated conversation/chat `getHistory(true)` | `AsyncGenerator<IContent, void, unknown>` |
| `buildErrorReportContext` | `Promise<Record<string, unknown>>` |

Curated membership is observed at first iteration rather than at accessor call.
Durable rows are independently decoded; pending rows retain the existing pending
fold's content identity. Array indexing, array mutation, and synchronous iteration
are no longer supported by the curated conversation/chat branch. Tests collect
only where an array is needed to assert values; production callers do not.
The stream follows the previous scalar-query helper's logging behavior: it emits
the compression-state debug message, but not the eager accessor's detailed AI
analysis and aggregate curation summary. Those debug records remain available
from the unchanged eager accessor. Streamed curated facade reads do not reproduce
them in this stage.

## Unfinished target and actual dependency chain

`HistoryService.getCurated(): IContent[]` is unchanged. Its structural finding is
still present. This stage does not satisfy the requested one-finding decrease.
The remaining direct production callers are:

| Caller | Dependency preventing an isolated signature change |
| --- | --- |
| `buildCompressionContext` | `CompressionContext.history` is a readonly array. Middle-out and one-shot strategies split and slice it; high-density compression maps and slices it; top-down truncation slices it. Their result contracts return candidate arrays, and application/rollback operate on those arrays. |
| `CompressionHandler.performCompression` | The empty-history check still uses the array. It runs after building the array-based compression context and invoking PreCompress hooks. Migrating only this check would leave the whole-context read on the same path. |
| `ProviderContentEnforcer.recomposeProviderContents` | `buildProviderContent` is array-based, and the enforcer's projection, fallback, retry, and returned-content contracts keep full arrays. Fallback captures raw history for rollback. |
| `HistoryService.getCuratedForProvider` | The provider pipeline combines pending content, restores tool continuity/completeness/adjacency, sanitizes rows, and checks cache anchors using arrays. |

`getCuratedForProviderStream` independently materializes and curates the whole
history before yielding. Production sends still enter the array-based provider
seam through `buildRequestContentsResult` and media request preparation. CLI,
provider implementations, and the Gemini plugin have no direct `getCurated`
callers in the scanned source; their agent send/compression paths reach these
shared dependencies. `getAll` also remains eager for uncurated chat/client state,
including previous-history snapshots and semantic-media purge transactions.

Changing the target signature now and collecting it at these seams would preserve
the context-length arrays. Redirecting these callers to `getAll` or to an eager
provider accessor would have the same cost. Neither was done.

## Required next stages

1. Give compression input a scoped, pinned, disk-backed row view with indexed
   reads, range iteration, and scalar counts. Migrate strategy split decisions,
   last-user preservation, tool-boundary rules, and cache-anchor checks. Preserve
   prompt/provider bytes and strategy metadata with independent eager oracles.
2. Move candidate and rollback membership to scoped journal transactions. Migrate
   the existing array-valued compression results, annotation, token recalculation,
   media-frontier transfer, and atomic replacement/restore contracts together.
3. Implement provider preparation over disk-backed tool-pairing indexes and
   bounded row streams. Preserve global continuity, completeness, adjacency,
   sanitization, anchor selection, retries, and pending-content ordering. Update
   request projection and fallback contracts without collecting the stream.
4. Change `getCurated` itself to the async generator contract, remove its eager
   implementation, and migrate the remaining tests. Run the unchanged structural
   audit and require exactly `HistoryService.getCurated` to disappear, with no
   added findings. Do not rename or suppress that finding.

## Verification evidence

Raw logs, commands, exit codes, initial dirty-tree diff, caller AST inventory,
structural finding lists, and test-audit outputs live under:

`tmp/verify854/p05d/curated-stream-20260929-branch3-2158/`

The initial RED runs failed on missing public iteration, eager reasoning reads,
and the synchronous report builder's array operations. GREEN tests cover real
512/8192-row journals, empty human/tool rows, invalid AI rows, signed and unsigned
thinking, tool calls/responses/errors, media, compressed replacement membership,
independent consumers, row isolation, abandonment, read failures, and aborts.

Compressed-member tests compare provider projection serialization with an
independent input-membership oracle through the existing provider pipeline.
The replacement fixture supplies nonempty blocks because the existing
`replaceAll` API rejects empty-block entries before committing membership.
Empty human/tool retention is independently covered by direct durable journal
entries. An attempted replacement oracle that included rejected rows failed;
its raw log is retained as `green-curated-independent-final.log`. The corrected
input-based oracle passes in `green-curated-input-oracle.log` and the final
`accepted/focused-curated-history-stream.test.ts.log`.

The separate-process adjacent run passed 456 tests across 41 explicit files.
After the last fixture and lint refactors, five affected suites were run again
in separate processes: 48 tests passed, with no failures. Those five reruns are
under `accepted/focused-*.log`, with individual exit files. Adjacent transport
tests compare Anthropic and Responses body bytes and retry bodies. They do not
establish a 512/8192-row bounded compression/provider turn. Reader counters account
for registered journal owners, not every reference on the heap. No statistical
retained-heap acceptance claim is made for this slice.

Official core, agents, and CLI workspace typechecks pass. CLI needed a successful
core declaration-only build to refresh its imported API types; the build log is
`build-core-types.log`. Final gates under `accepted/` pass full dirty-tree forced
800/80 ESLint, normal dirty-tree ESLint, repository `npm run lint`, dirty-file
Prettier, and `git diff --check`. Earlier failed gate logs remain available.
The final test-audit contains the same 2126 findings as the starting baseline;
there are no added or removed assertions flagged. Two existing history-view
findings have moved line numbers and lost their removed outer describe label.
`accepted/final-summary.json` records that exact normalization, unchanged
assertion details, and the unchanged structural audit source.

The gate driver initially invoked the evidence auditor from its output
subdirectory, where `audit.ts` does not exist. That runner-path failure is
retained in `accepted/ast-after.log`. The explicit correct-path rerun is
`accepted/ast-after-corrected.log`, exit 0. `ast-progression.json` records the
same seven structural findings before and after, with none added or removed.
The unchanged structural suite reports 17 passes and three failing production
surface assertions in `accepted/structural-after.log`.

The unchanged structural audit remains RED with seven findings: `getAll`,
`getCurated`, `getCuratedForProvider`, `getRawHistory`, `materializeHistory`,
`stampHistory`, and `takePersistenceFailuresThrough`. The exact finding set is
unchanged. The generator/source guard still rejects an eager caching generator.

No threshold, lint suppression, audit whitelist, test exclusion, or enforcement
configuration was changed. Existing dirty work and protected `.llxprt` content
were preserved. No commit, push, OCR, merge, main integration, or full repository
test run was performed.
