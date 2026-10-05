# Production purge now uses disk transactions; large-journal acceptance still fails

The chat session now invokes `SemanticMediaPurgeStreamCoordinator`. This is a
narrow production slice, not completion of the end-to-end migration. The real
512-row shared-journal commit and rollback pass. The equivalent 8192-row test
remains executable and RED because the durable fold rejects a purge event larger
than 8 MiB. Request preparation also still collects whole request arrays.

Evidence for this run is under
`tmp/verify854/p05d/media-purge-production-20260930T1345-branch3/`. The earlier
independent coordinator result is recorded in
`semantic-media-purge-stream-slice.md`; its acceptance scope has not been
expanded by this report.

## Invoked production paths

`chatSession.ts` constructs the semantic purge session through
`chatSessionMediaLifecycle.ts`. Both send factories forward their abort signal
into asynchronous purge preparation. `SemanticMediaPurgeSession` now constructs
the streaming coordinator and awaits `begin`. Its candidate and request fields
hold repeatable disk row sources, not histories. Explicit-cache requests reopen
the pinned base membership and preserve the transaction's boundary identity.

Commit and rollback run through the coordinator's existing `transformRows`
implementation. No production chat purge call reaches the legacy coordinator's
`getAll` or `transformAll`. Failed or noncommitted completion closes the disk
transaction and releases the lease. Successful completion retains the lease
until finalization or successful rollback. A failed rollback retains the lease,
as before. The no-prefix explicit-cache case now closes its unused transaction.

The persistence callback calls `recordSemanticMediaPurgeRows`. The recorder
stages row JSON on disk, queues scalar envelope metadata and the staging handle,
and writes a single JSONL event in bounded chunks. The v2 event type, envelope,
`payload.history` array representation, frontier, and sequence semantics remain
unchanged. An acknowledgment is issued only after the suffix append resolves.
Partially read sources are not admitted. Physical append failure poisons the
recorder and preserves its error. Disposal before or during staging prevents
admission; cleanup closes the staging handles. The existing eager recording API
is retained for other callers and is not the chat purge callback.

## Large-event blocker and fail-fast preflight

The actual shared-journal 8192-row test initially failed after persistence:
`durableRowFold.ts:224-225` rejects `oversized_semantic_media_purge`. The existing
`durableRowFold.test.ts` requires that behavior. Neither the production fold nor
that assertion was changed.

The chat recording callback now requests live-fold preflight. Before admission,
the staged event is passed through the real durable fold using another disk file.
An unsupported replacement rejects before journal bytes change. Admission checks
sequence, lifecycle and queue room again after the asynchronous preflight, so
interleaving enqueues cannot publish a stale envelope. There is no eager recovery
path.

The new preflight test proves byte-for-byte journal preservation and unchanged
live-fold membership after an unsupported replacement. This protects the narrower
slice. It does not make the 8192-row production requirement pass. The test that
requires successful commit and rollback at that size was not changed to expect
rejection, skipped, or relaxed.

The standalone recorder and streaming transaction accept a valid individual row
larger than 8 MiB without truncation. That is separate from live-fold acceptance.
Per-row `JSON.stringify` remains a row-sized allocation. The fixed 1 MiB retained
growth allowance, 8 MiB fixture allocation bound, 440-owner assertion and eager
trap controls remain unchanged. The durable event-size rejection is a different
existing constraint.

## Remaining request boundary

`materializeSemanticPurgeRequest` explicitly collects a fresh request array from
the attempt's pinned row source. `StreamProcessor` and `turnMediaRequest` invoke
it before provider curation. It sanitizes row blocks and separately clones nested
metadata while preserving the exact boundary identity object. Hook mutations
cannot alter the pinned candidate or a later preparation pass.

This is a tested eager boundary, not a streaming provider-body implementation.
`buildRequestContentsResult`, `getCuratedForProvider`, BeforeModel and AfterModel
hook payloads, `enforceProviderContents`, prompt-envelope preparation, logging,
and send telemetry still use arrays. The existing `getCuratedForProviderStream`
is also internally eager. Provider normalizers and SDK request representations
retain their existing request-scoped arrays. Removing these requires migration
of their consumer contracts and tool-pairing behavior; replacing only the input
field with an iterable would not remove those owners.

Streaming request materialization receives the request abort signal. The
non-streaming request materializer does not yet receive an additional signal;
its purge construction is cancellable, and the subsequent provider call has its
existing cancellation contract. Cancellation while awaiting another attempt's
lease is observed after that lease is released, not immediately.

## Behavioral evidence

The production session tests first failed at the old constructor's `getAll`.
The recording tests first failed because the row API was absent. The request
boundary tests first failed because the materializer was absent. A stronger
nested-metadata mutation test then failed on a frozen boundary object; independent
metadata cloning fixed that without changing the stored transaction.

The final production session fixture uses the same real recorder as its history
journal. The 512-row case commits, holds the next lease, rolls back every original
row, and releases the next attempt. The 8192-row case fails at live-fold preflight.
Earlier 512/8192 session GREEN evidence used a persistence callback that traversed
rows but did not write the event into that same live journal. It is not large
shared-journal acceptance.

The new real-transport byte matrix covers Responses, Anthropic and the actual
Gemini plugin's AI SDK transport. It compares 512/8192-row candidate and
pre-image requests with separately assembled legacy request oracles, including
repeated preparation. These are twelve byte comparisons, with matching complete
bodies saved under the evidence directory. Prompt caching is off in that matrix;
it is not proof of an Anthropic cache write. Separate session and provider cache
suites cover boundary identity and cache evidence. The earlier four independent
Responses wire-oracle comparisons remain unchanged and are rerun.

The original 31 atomicity/density cases and the independently verified 18 semantic
stream cases remain unchanged and are rerun. Recording fault tests also cover
source rejection, disposal, oversized individual rows and physical append
failure. Adjacent chat, admission, cache, provider retry, recording and media
ownership suites are run separately with absolute test paths to avoid matching
baseline copies under `tmp/`.

## Verification and ownership limits

Final command status is in `settled/manifest.json`; `final-summary.json` records
the settled result and protected hashes. Official root typecheck and root lint
pass. All 516 dirty code files pass forced 800/80 ESLint with zero warnings and
Prettier checks. The original 31 cases, 18 semantic stream cases, four Responses
byte cases, twelve production-boundary byte cases and all twenty adjacent suites
pass. The seven streamed recording cases, seventeen unchanged durable-fold cases,
one preflight preservation case and two request-isolation cases also pass.

The production session suite has three passes and one failure at 8192 rows.
Its post-gate confirmation preserves the same result. The two legacy coordinator
no-array tests still fail at construction. Structural acceptance is not claimed:
the suite has eighteen passes and two failures with the same six facade findings.
The final audit has the same 2,102 stable file/test/flag/detail/area identities
as the initial scan, with no additions or removals. Protected hashes match,
including the fold, its size-rejection test, memory children and estimator,
scanner, lint configuration and already-dirty `.llxprt` files. `git diff --check`
and the production report's formatting check pass. These are selected test and
root static gates, not full-repository test/build/smoke acceptance.

No quiet-host memory sweep was run. Sibling ESLint jobs, active CLI sessions and
unrelated CPU-bound workers were observed. Instrumented transaction owner bounds
are not a retained-heap or all-references proof. Pending-fold snapshots, explicit
identity pins, request arrays, provider conversions, queued ordinary records and
row-sized JSON strings remain separate owners. Abandoned attempts still depend
on their caller's completion/finalization contract; no new session-wide disposal
API was added.

No protected `.llxprt` content, fold enforcement, memory estimator, scanner,
threshold or required assertion was changed. Test registration and fixture
construction were split to satisfy existing line limits, without changing their
behavior assertions. No commit, push, OCR, PR or merge was performed. The
large-event blocker was posted on issue #854:
https://github.com/vybestack/llxprt-code/issues/854#issuecomment-5916478194.
