# The eager provider facade is removed; full request boundedness remains RED

`HistoryService.getCuratedForProvider(): IContent[]` and
`materializeSemanticPurgeRequest` are deleted. The remaining production media
caller now passes semantic-purge rows into disk-backed provider curation.
Enforcement, hooks, telemetry and provider request conversion still retain full
request arrays. This stage removes one facade finding, not those downstream
owners or Criterion 1's remaining failures.

Evidence is under
`tmp/verify854/p05d/provider-facade-removal-20260930T2040-sol/`.
Earlier dirty work and evidence were preserved.

## Production and public callers

`getCuratedForProviderStream` now accepts an iterable or asynchronous iterable
request override. Its journal source, row-wise curation and disk normalization
remain cold. There is no replacement array-returning provider getter.
`HistoryService` no longer imports or invokes the eager provider pipeline.
The old array pipeline remains available to independent test oracles; no
production caller invokes it.

`streamSemanticPurgeRequest` returns a repeatable asynchronous row source.
It opens the transaction's request cursor on iteration, copies each row and
nested metadata, and preserves the exact semantic boundary identity. It does not
collect the purge request. `StreamProcessor` and `turnMediaRequest` pass this
source directly to provider curation. The turn path receives the request's
AbortSignal through `TurnProcessor`. Both paths still collect normalized output
at the existing request/enforcement boundary.

The AST inventory covers package, plugin and script TypeScript, including
identifier references, string lookups, method overrides and object properties.
Before migration it found 128 references and 27 files containing call sites.
After migration it finds zero callers and one reference: the negative assertion
that the removed member is absent. Structural-scanner fixture source and old
names in test titles, comments and a negative-control regular expression are not
callers. No source interface or implementation retains the synchronous contract.
Root declaration generation and typechecking verify the current exported class
surface. External consumers outside this checkout were not inspected; this is
an API removal, without a compatibility adapter.

All executable facade consumers now consume the disk-backed stream. Tests that
need arrays collect in their own callbacks. Diagnostics and transport oracles
invoke the old curation/normalization functions directly over independently built
fixtures, so expected output is not computed from the migrated cursor. Existing
assertions remain. An assertion ledger records no reductions among migrated
caller files. Fixture builders and same-file named callbacks satisfy the existing
800/80 limits; the audit resolves those callbacks and checks their assertions.

## Exact cache identity and stream lifecycle

The cache-commit regression initially failed because JSON staging replaced the
opaque boundary object with a decoded copy. Equal serialization cannot satisfy
`boundaryId` identity comparison. `ProviderNormalizationDisk` now pins one
request boundary identity and restores it while decoding staged rows. It clears
that pin on close. No context-sized identity map is retained. A request containing
two different boundary identities fails before any provider row is published.

The cache regression compares the prepared boundary, first normalized request
and repeated request by reference, then supplies matching cache-write evidence.
Successful completion commits the text-only history. Separate request-isolation
coverage mutates blocks and boundary metadata without changing the pinned
transaction or later preparation.

Lifecycle coverage checks cold construction, first-demand source effects,
source closure before normalized output, one-row semantic cursor demand,
suspended-reader ownership, return, break, consumer failure and abort. Provider
cursor controls also cover timer cancellation during capture, source and disk
faults, removed scratch snapshots, throw and exhaustion cleanup. A valid row
larger than 8 MiB still passes unchanged. The 440-owner and 8 MiB ownership traps,
and the 1 MiB retained-growth allowance and estimator, were not changed.

Global tool matching still consumes the captured input before the first
normalized output row. That preparation is disk-backed and yields to the event
loop, but it is not immediate first-row emission.

## Verification scope

The original 31 atomicity/density cases pass. The twelve curated provider-body
cases cover 512/8192 rows, Responses/Anthropic/Gemini, cache enabled/disabled,
far-separated tool responses, media, duplicate preference and signed thinking.
The twenty-four semantic production-body cases use the actual turn enforcement
route at both scales, candidate and explicit-cache pre-image requests, all three
providers and both cache settings. First and repeated request bodies must match
independent eager oracles byte-for-byte. Responses also forces a transport retry
and checks identical bodies across attempts. Cached Anthropic cases require
`cache_control` on the wire. Network boundaries are replaced; these tests do not
claim remote cache writes.

The four existing Responses body comparisons pass. The unchanged semantic
production session suite passes all four cases, including real 8192-row shared
journal commit and rollback. The earlier whole-event blocker had already been
fixed by the durable-fold stage; this run makes no fold/enforcement changes.

The unchanged structural suite has **18 passes and 2 failures**, not 19/2.
It now reports **five findings**, down from six. The removed finding is
`HistoryService.getCuratedForProvider`. The remaining findings are
`HistoryServiceCore.materializeHistory`, `HistoryServiceCore.captureChronology`,
`HistoryService.getRawHistory`, `HistoryService.getAll` and
`HistoryService.getCurated`. Structural mutation controls pass. Overall
structural acceptance remains RED. The two legacy semantic-coordinator no-array
assertions also remain RED and are not suppressed.

Final command manifests, audit identities, byte-pair digests, protected hashes
and regression counts are recorded in `final-summary.json`. The isolated union
has 1,339 passes across 143 suite invocations after replacing one stale cache
fixture failure with its 19-pass final-source confirmation. The four dedicated
original/byte runs have 71 passes. Counts include overlapping regression coverage.
The 35 touched-suite confirmation invocations have 288 passes, and the final
confirmation has another 59 passes across ten test invocations. Its root typecheck,
root lint, audit and diff commands pass. The earlier touched-suite typecheck
failure remains in its own manifest and is superseded by the final root checks.

All 40 saved actual/expected provider body pairs match byte-for-byte. Official
root typecheck and lint pass, and all 593 dirty code files pass forced 800/80
ESLint with zero warnings and Prettier checks. The final audit retains 2,126
baseline identities with zero additions or removals; comparison ignores only
line numbers and retains multiplicity. The protected hashes for 20 files match,
and the report formatting and `git diff --check` pass.

Earlier logs retain facade and media-route REDs, cache-identity RED, async propagation/type failures,
fixture extraction failures and lint/audit failures. Registration-splitting
experiments were replaced with fixture extraction and same-file named callbacks.
The async no-throw assertion now awaits the collector, rather than passing
because an asynchronous function did not throw synchronously.

## Remaining owners and acceptance limits

`turnMediaRequest`, `buildRequestContentsResult` and
`ProviderContentEnforcer.recomposeProviderContents` collect complete normalized
requests. The enforcer's estimator, fallback snapshots and compression contracts
remain array-valued. BeforeModel/AfterModel hook payloads, prompt envelopes,
boundary recovery and request telemetry also retain or serialize those arrays.

Responses still materializes request contents in `openAIResponsesExecutor`,
constructs the input array in `OpenAIResponsesInputBuilder`, and retains stateful
selection and estimation arrays. Its lazy body defers preparation and chunks
serialization; that does not bound the conversions. Anthropic request preparation
still constructs `AnthropicMessage[]` for its SDK and retry machinery. Gemini
still passes materialized media contents into `buildGenerationSetup` and provider
conversion. Compression's separate eager curated facade remains visible.

No statistical retained-memory sweep ran while sibling workers and active CLI
sessions were present. Explicit ownership controls cover registered owners,
not every JavaScript reference. This stage therefore makes no all-reference,
retained-heap or full-provider-boundedness acceptance claim. Full repository
unit-test/build/smoke acceptance is not asserted by these selected regressions
and root static gates.

Protected `.llxprt` content, raw-history enforcement, structural scanner,
thresholds and memory controls were not modified. No GitHub, commit, push, OCR,
PR or merge action was performed.
