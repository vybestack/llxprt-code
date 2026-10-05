# Provider curation uses disk-backed rows; provider sends still retain arrays

This stage replaces the eager implementation of
`HistoryService.getCuratedForProviderStream` and calls it from normal request
preparation and provider-content recomposition. It does not remove the public
`getCuratedForProvider(): IContent[]` facade or complete Criterion 1. The enforcer
and request-preparation result still expose full arrays at their existing
boundaries. Those collections remain visible in the source.

Evidence is under
`tmp/verify854/p05d/provider-curated-stream-20260930T1742-sol/`.
Existing dirty work and earlier evidence were preserved.

## Production path

`StreamProcessor._buildAndSendStreamRequest` now awaits
`buildRequestContentsResult`. That helper assigns the same pending-content IDs
and prepares rows through `getCuratedForProviderStream`, including the existing
request-scoped history override. It passes the request AbortSignal to the
cursor. The helper then collects the provider-ready rows into the existing
array-valued request result for hooks, projection and dispatch.

`ProviderContentEnforcer.recomposeProviderContents` also consumes that cursor.
Its optimization, compression callback, fallback, projection and tool-response
truncation callers await recomposition. It no longer reads `getCurated` or calls
the eager provider pipeline. It still collects its final result because the
current enforcement result, estimator and fallback contracts require arrays.
The migrated helper is called by production enforcement, not an unused API.

## Cursor and disk normalization

The cursor is cold. Its journal source pins membership when iteration starts.
Default history comes from `streamCuratedHistory`; overrides are filtered one
row at a time without copying their containing array. Source rows and pending
rows are processed into private disk files. The normalization implementation
keeps scalar counts and disk-backed call, response, score and block-provenance
indexes, rather than context-sized arrays, Maps or Sets.

Global matching requires reading the captured input before the first output
row. Preparation is therefore a bounded-memory, multi-pass operation, not an
immediate first-row emitter. The passes preserve tool-message splitting,
continuity reconstruction, interrupted-call completion, first-call attachment,
response encounter order, duplicate preference and media assignment. Emission
reads the staged rows and assembles only the current output row's blocks.
An output row can itself be large, including when many results attach to one
assistant row. This is not a fixed-size limit on valid rows.

Scores are recorded before JSON staging. A failing test showed that serializing
`NaN` to `null` changed duplicate preference when scoring decoded rows; scalar
score sidecars preserve the old decision. Pending-block provenance is also kept
on disk. A separate failing case showed that an earlier pending row sharing the
adjacent result's block object lost its cache-anchor metadata after staging.
The implementation now compares borrowed pending block identities through disk
pointers. Equal but distinct blocks still produce the old synthetic metadata.
No strong-reference identity map was added.

Each input and indexing pass yields to the event loop and checks cancellation.
A timer-cancellation RED exposed preparation starvation before those scheduling
points were added. Output advances only when the consumer asks for another row.
Exhaustion, explicit return, throw, break, consumer failure, source failure and
abort close the private directory. Removing an active scratch snapshot fails
instead of returning stale rows. A valid row larger than 8 MiB is neither
truncated nor rejected.

The subsequent diagnostics stage restores the eager curation analysis, exclusion
messages, scalar summaries, unmatched-response warnings and aggregate
cache-anchor-removal warning. It preserves their order without retaining history
arrays in log details. Large anchor-index and block lists use bounded samples
with explicit truncation markers. See
[provider-stream-diagnostics-parity.md](provider-stream-diagnostics-parity.md)
for the original-route captures, intentional detail differences and checks.
Provider content and cache-control placement remain independent of those
diagnostics.

## Exact remaining seams

The source AST inventory scans package and plugin production TypeScript. It
finds two new provider-cursor callers and one remaining direct production
`getCuratedForProvider` caller:

| Seam | Remaining ownership |
| --- | --- |
| `turnMediaRequest.ts:32` | Calls the eager provider facade after materializing the semantic-purge request. This media-specific path is not migrated. |
| `HistoryService.ts:getCuratedForProvider` | Remains public and synchronous, calls `getCurated`, and returns the old full-array pipeline result. Existing facade consumers and tests retain that contract. |
| `compressionContextBuilder.ts:42` | Still reads `getCurated` for array-valued compression strategies. Candidate application, rollback and fallback need their own migration. |
| `providerContentEnforcement.ts:recomposeProviderContents` | Collects final rows into `IContent[]` for enforcement results and finalized-prompt estimation. Fallback snapshots also retain raw history arrays. |
| `streamRequestHelpers.ts:buildRequestContentsResult` | Collects final provider rows for the request envelope. Semantic-purge materialization, hooks, boundary recovery, logging and prompt envelopes remain array-based. |

Responses still constructs array-valued request input and projection contents;
stateful request selection and media resolution also retain request arrays.
Its lazy HTTP body defers preparation and chunks serialization, but does not
make those conversions bounded. Anthropic still converts to an array-valued
message body before its SDK transport and retry handling. Gemini still passes
materialized media contents into generation setup and provider conversion.
No context-sized array was moved into a new cursor or provider object in this
stage. Existing downstream arrays were not removed or disguised.

Completing the provider migration requires replacing the enforcement result and
projection contracts, hook/request envelopes, media request ownership and each
provider's request conversion together. The synchronous facade can only be
removed after its remaining callers adopt those contracts. Renaming the facade
or returning a generator that caches its result would not remove the finding.

## Verification

The isolated regression run has 1,308 passes and no failures across 131
invocations in `accepted/manifest.json`. That includes 128 targeted suites,
the original 31 atomicity/density cases, four existing Responses body comparisons
and twelve existing Responses/Anthropic/Gemini body comparisons. Hook, previous
history, retry, tool pairing and cache-write reporting suites pass. The seven
focused current-source suites in `confirmation-final/manifest.json` have 38
passes and no failures. The final faults and transport-matrix rerun in
`accepted-last/manifest.json` has another 15 passes and no failures, preserving
the final assertion layout. Four existing real child-transport tests also pass.

The new transport matrix checks both 512 and 8192 rows, three providers and
caching enabled/disabled. Anthropic enabled cases explicitly require
`cache_control` on the wire. Responses cases force a transport retry and require
identical bodies across attempts. The expected bodies use the old normalization
path over input fixtures; they are not derived from streamed output. All 64 saved
actual/expected pairs across the initial and confirmation runs match
byte-for-byte. This count includes repeated runs and the sixteen pre-existing
provider-body cases, rather than 64 distinct scenarios. The tests replace the
network boundary and do not verify writes to a remote provider cache.

Final official root typecheck and root lint pass in `accepted-last/manifest.json`.
All 548 dirty code files pass normal and forced 800/80 ESLint with zero warnings,
and Prettier checks pass in `final-gates/manifest.json`. The final audit retains
2,126 baseline findings with zero added or removed identities. Its comparison
ignores line numbers only and uses a multiset; no finding whitelist or assertion
scope normalization was added. The report's formatting and `git diff --check`
also pass. Protected-path hashes match.

The unchanged structural suite has 18 passes and two failed production-surface
assertions. Its exact six findings remain `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll`, `getCurated` and
`getCuratedForProvider`, with no additions or removals. Its mutation controls
pass, as do the two new eager-cursor source controls. The two existing semantic
purge no-array assertions remain RED. None of those failures was suppressed.

The standard 512/8192-row fixtures exercise mixed tools, media, signed thinking,
invalid AI rows, interrupted calls, reconstructed calls, duplicates, cache
anchors and pending ordering. The transport matrix also answers an early call
from pending content after all history segments. Its expected rows come from
the unchanged old array normalization path over independently generated input,
not from the new cursor. Actual requests pass through the real enforcer and
Responses, Anthropic or Gemini conversion and transport preparation; only the
network boundary is replaced.

The 440-row and 8 MiB controlled-fixture bounds remain unchanged. Explicit
output and journal ownership counters release to zero, and deliberate retaining
consumers exceed both limits. Counters measure registered owners, not every
JavaScript reference. The unchanged 1 MiB retained-growth allowance and estimator
were not modified. No statistical heap sweep was run because unrelated
CPU-bound processes and active CLI sessions were present. This stage makes no
retained-heap acceptance claim.

Adverse logs include the eager-cursor RED, enforcer recomposition RED, response
score RED, timer-cancellation RED, request-cancellation RED and shared-block
cache-anchor RED. The first request guard failed during fixture admission;
its corrected RED targets the actual request builder. A test insertion briefly
registered the cancellation case inside a loop; its corrected registration is
retained. Initial lint failures and the root typecheck failure are also retained.
The typecheck caught a child transport helper whose inferred default parameter
narrowed to `AsyncGenerator`; its explicit `AsyncIterable` annotation preserves
the helper's previous accepted input contract. Its four unchanged real child
transport, resume and retry tests pass. Forced lint required splitting test
registration bodies and extracting a text-label reader. Nested registration
loops became an equivalent twelve-case `it.each` matrix. The audit initially
reported duplicate lifecycle assertions, a suspended-counter comparison and
assertions hidden behind a test helper. Lifecycle file counts now form a single
before/during/after ledger, the suspended interval asserts an acquisition delta
of zero, and body assertions live in each test callback. Every prior condition
is still checked. The final scanner reports zero new findings. A summary-driver
shape error is retained; its corrected run reads the prior inventory's
`findings` field.

No protected `.llxprt` content, immutable evidence, structural scanner, raw
history enforcement, memory estimator, threshold or required check was changed.
No GitHub, commit, push, OCR, PR or merge action was performed. Full repository
build/test/smoke acceptance is outside this provider-preparation result.
