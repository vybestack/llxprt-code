# Tool truncation streams raw history; two compression raw calls remain

This stage removes four of the six requested production `getRawHistory` calls.
Both invoked tool-truncation paths now rank history on disk and replace an
addressed result through a disk-backed row transaction. Density optimization
and provider fallback rollback retain their raw-array contracts. The raw facade
and Criterion 1 remain RED.

Evidence is under
`tmp/verify854/p05d/raw-compression-callers-20261001-sol/`. Existing dirty work,
protected files and earlier evidence were preserved. This is a coherent
history-ranking and addressed-replacement slice, not complete compression,
pending-request or provider ownership acceptance.

## Invoked production routes

`PendingContextWindowEnforcer.truncateToolResponsesIfStillOverLimit` invokes
`truncateLargestToolResponses`. `ProviderContentEnforcer` invokes
`truncateOversizedToolResponsesUnified` for its last-resort tool-result route.
Both now use `withToolResponseRanking` and `replaceRankedToolResponse`.
Neither route calls `getRawHistory`, `length`, `replaceToolResponseBlock`,
`replaceAll` or an eager history adapter during ranking and replacement.
Downstream projection callbacks keep their existing ownership contracts.

The pinned raw journal cursor writes each row to `HistoryDensityRows`. Score
records store only entry index, block index, estimated tokens and a selected
flag in a private file. The candidate iterator scans score records and holds
one best pointer, then decodes the selected row. It keeps no history-sized
candidate array, reference Map, Set or promise fan-out. The spool's identity
writer is not used, so its strong-reference identity Maps remain empty.
Disk usage grows with history. Selecting many responses requires repeated
score-file scans; this stage does not promise constant-time ranking.

Ranking retains largest-token-first order, newer entry/block tie-breaking,
pending offsets and already-stubbed exclusion. Estimation is sequential rather
than a history-sized `Promise.all`. The exported array-valued
`rankToolResponses` remains for its separate input-array contract. The source
inventory finds its executable repository callers only in tests and independent
oracles; it is not called by the migrated production entry points.

The unified path captures pending entries and block arrays before estimator
suspension and shares that captured working copy with ranking. Selection still
compares the exact pending block identity. Caller pending rows are never
mutated. The existing array-valued pending input, working copy and result remain
proportional to pending request size. They are not claimed bounded by this
history migration or hidden in an iterator.

The concurrency guard counts a fresh pinned raw cursor with scalar state.
An additional source-length check runs inside the serialized replacement
transaction, preventing an append between asynchronous guarding and publication
from corrupting an addressed target. Target mismatch aborts before publication
and returns false. The existing length-based contract still does not reject
every possible same-length rewrite.

The replacement probes a repeatable disk source before writing. It preserves
call ID, tool name, row order and chronology identities. If any AI row at or
after the target has `responsesStored: true`, all AI rows lose that marker,
including prefix rows, matching the old retained-rewrite rule. Otherwise prefix
markers remain untouched. Projection and baseline reset happen after each
accepted replacement and stop immediately when the budget is satisfied.

`HistoryTransformSink.appendRetained` permits raw source rows, including empty
AI rows, to survive an addressed rewrite. It validates source index, unchanged
speaker and deep-equal blocks against the pinned source before retaining only
metadata changes. General detached/borrowed candidate validation remains
strict. Durable rows serialize to disk; pending caller rows keep the existing
identity and ownership charge. Arbitrarily many unsettled caller-owned pending
journal rows are not claimed bounded.

Optional cancellation is forwarded through ranking, counting and replacement.
Scheduling points during scoring permit timer aborts with immediately resolved
estimators. Source failure, abort, consumer throw and ordinary completion close
ranking files. Pinned iteration survives clearing live history. Returning a
candidate iterator early releases its local candidate; the enclosing scoped
helper owns scratch until its action settles. Production enforcement callers
currently supply no AbortSignal, so this stage does not claim upstream request
cancellation coverage.

## Remaining exact raw caller graph

The complete package/plugin/script AST inventory has four direct non-test raw
calls, down from eight. There are no direct plugin calls.

| Remaining call | Executable route and ownership |
| --- | --- |
| `CompressionHandler.ts:201` | `ensureCompressionBeforeSend` and pending/provider enforcement call `ensureDensityOptimized`, which passes the full raw array to synchronous `strategy.optimize`. High-density optimization retains path/call/inclusion indexes and returns removal/replacement collections for `applyDensityResult`. Those decisions and application must migrate together. |
| `providerContentEnforcement.ts:651` | Hard-limit enforcement and callback escalation reach `forceTruncation`, `executeFallbackTruncation` and `captureFallbackState`. The snapshot copies raw history. A rejected installed candidate reaches `restoreRejectedFallback` and `restoreFallbackState`, which copies the snapshot again into `replaceAll`. This needs a reusable owned disk snapshot with identity and cleanup semantics across success, rejection and rollback. |
| `packages/core/src/storage/media-lifecycle-metrics.ts:189` | `MediaLifecycleMetrics.snapshot` consumes the synchronous `HistoryMetricSource.getRawHistory` contract and retains a reference-byte Map. Both measurement input and that index remain unfinished. |
| `scripts/issue-3199-media-memory-target.ts:205` | The admitted-row memory probe passes `runtime.history.getRawHistory()` to the array-valued media resolver. Its one-row fixture does not remove the public array contract. |

The four truncator sites, previously at lines 194, 344, 345 and 636, are gone.
No raw facade, scanner exemption or enforcement threshold was removed or renamed.
The unchanged structural inventory remains `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll` and `getCurated`.

Array compression contexts, non-primary truncation fallback candidates,
summary-strategy requests, provider recomposition/projection results, request
hooks/envelopes and provider conversion/retry arrays retain the ownership
specified in the earlier migration reports. Provider fallback in particular is
exercised by the new hard-limit matrix but is not migrated by that coverage.

## Behavioral and byte evidence

New real 512/8192-row journals cover mixed tool/media rows, duplicate call IDs,
nested call/response blocks, pending recency ties and immutable pending caller
identity. Independent eager oracles compare exact streamed history digests and
provider body bytes. These histories use actual rows rather than inflated
length metadata. Normal registered reader/transaction owners satisfy the
unchanged 440-row and eight-MiB controlled-fixture bounds and release to zero.

Four deliberate retaining consumers keep every borrowed row or distinct copy.
Normal control tests establish the resulting excess and release. The separate
`TOOL_RETAINING_TRAP=1` run has four expected failures against the unchanged
bounds. These counters measure registered owners, not every JavaScript reference.

Additional cases cover estimator failure, timer/pre-abort, source pinning across
clear, iterator return and consumer throw, stale-target no-publication, and a
valid nine-MiB result replaced without imposing a row-size cap. Partial journal
admission restores exact membership and anchor, then permits retry at both
history sizes. Existing transaction tests retain strong marker identity and
rollback coverage.

The direct production tool matrix has twelve cases across both sizes,
Anthropic/Responses/Gemini and caching on/off. The additional twelve-case
hard-limit matrix invokes the real enforcer after a failed compression provider
and declined history fallback, reaching unified pending-result trimming. A
pending response answers a call far back in context. Both matrices compare
independent eager normalization with actual provider transport preparation;
only network boundaries are replaced. Anthropic cache flags and Responses retry
body identity are checked. Remote provider cache writes are not asserted.

## Verification result and adverse logs

The accepted selected regression union has 838 passes and zero ordinary
failures across 84 isolated invocations, including the original 31 cases,
compression/provider/strategy suites, the two twelve-case tool body matrices
and fourteen deterministic row-transform cases. The corrected atomicity log
supersedes the earlier failed fixture invocation; both remain available.
All 64 saved final actual/expected body pairs match byte-for-byte.

Official root typecheck and lint pass. All 627 dirty code files pass normal
and forced 800/80 ESLint with zero warnings and Prettier checks. The unchanged
audit has 2,126 identities before and after, with zero additions or removals,
ignoring line numbers only. All protected hashes match and `git diff --check`
passes. Exact arguments, codes and logs are in the accepted manifest and
supplemental receipts; the aggregate is `final-summary.json`.

The unchanged structural suite has eighteen passes and two failed production
surface assertions. Its mutation controls pass. Those failures and the raw
facade finding remain visible, rather than being waived by this slice.

Adverse logs retain the initial eager-ranking RED, Responses-prefix parity RED,
pending identity RED, stale-publication RED, missing cancellation RED,
empty-AI candidate-validation RED and transaction-length-guard RED. Initial
lint/audit failures were corrected without lowering limits or removing
assertions. Audit expectations now come from independently constructed pending
blocks and explicit scratch additions/removals. The first partial-admission
fixture selected the last tool row and generated only one journal op, so an
injection after two admissions could not fire. Its corrected model-aware score
selects an assistant response, invalidating multiple stored rows and reaching
the intended failure. A nonexistent recorder drain method was corrected to
its existing `flush` API. These fixture failures remain recorded.

A foreground deterministic transform run was terminated by the host watchdog.
Its background rerun passes. An accidentally included statistical test file was
removed from the run before execution reached those probes. No statistical heap
measurement was performed. Unrelated workers and CLI sessions are recorded in
the host snapshots. The one-MiB retained-growth allowance and estimator are
unchanged; there is no whole-session, all-reference or retained-heap acceptance
claim. Full repository build/test/smoke acceptance is not claimed.

No protected `.llxprt` content, raw facade implementation, enforcement rules,
scanner, earlier evidence, GitHub, commit, push, OCR, PR or merge was changed
or performed by this stage.
