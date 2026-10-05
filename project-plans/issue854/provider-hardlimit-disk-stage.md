# Provider hard-limit fallback uses disk rows; public history remains RED

The invoked provider hard-limit fallback now prepares and installs disk candidates.
It no longer calls the eager compression context builder or `replaceAll`.
Pending-window enforcement and the public eager builder remain unchanged.
This stage does not establish Issue 854 whole-session memory acceptance.

Evidence is under
`tmp/verify854/p05d/provider-hardlimit-disk-20261001-sol/`. The starting dirty
workspace, earlier evidence and protected sources were preserved. No GitHub,
commit, push, OCR, PR or merge action was performed.

## Actual route and publication

`CompressionHandler.createProviderContentEnforcer` delegates its callback to
`performProviderDiskFallback`, which calls `runDiskProviderFallback`. The runner
builds scalar compression metadata, captures pinned raw journal membership and
spools curated rows into `HistoryDensityRows`. Durable rows are serialized
individually. Pending caller rows retain their existing identity and ownership.
`TopDownTruncationStrategy.compressDisk` applies the existing target, minimum
retained history and tool-pair boundary rules.

The callback receives `ProviderFallbackCandidate`, carrying indexed disk rows,
a start position and the source pending-membership flag. Disk storage stays open
through the awaited callback and closes on no-op, success or failure. There is
no production eager candidate adapter. The array-to-disk helper used by old
regression fixtures is confined to tests.

`publishProviderFallbackCandidate` validates the range before mutation, reads
survivors individually, filters zero-block rows, invalidates Responses stored
chain state and uses the existing row transaction. Durable candidates publish
with journal backpressure. A source containing pending caller rows uses the
existing non-streaming publication behavior, because awaiting a writer paused
by the same caller would deadlock. The shared row-transform option defaults to
streaming; no pending-window production caller was changed. That pending mode
can retain unacknowledged publication and identity owners. It is not presented
as bounded ownership for arbitrary pending work.

The enforcer retains its outer rollback snapshot and compensation protocol.
Installed callback rejection, false return, baseline-reset failure and later
callback failure restore raw membership, chronology, tokens, base offset, cache
anchor and prompt baseline. Partial transaction publication uses the existing
compensating journal protocol. Failed compensation retains both failures in an
AggregateError. Cache/baseline reset happens only after successful installation.
Invalid candidate ranges and missing or duplicate publication are explicit
callback-contract errors. After required compensation they propagate immediately,
without another projection or truncation attempt. There is no warning-only
success without history.

The handler selects the first explicit compression snapshot before considering
legacy summary markers, then updates compression summary, recency and failure
bookkeeping only after the installation callback completes. No-op preserves
bookkeeping. Provider fallback failures retain the existing primary/fallback
AggregateError diagnostics. The existing provider recomposition, finalized
projection and unified pending-tool trimming ladder remain in place.

## Behavioral evidence and scope

Real 512/8192 mixed journals cover the actual handler route and independent legacy
truncation parity. Disk-runner tests cover installed rejection, false return,
baseline failure, partial admission, cancellation, retry ladder order and token
accounting. Pending tests pause the caller writer, replace chronology markers,
force GC and require restoration of the original rows and marker objects.
Invalid candidate ranges, duplicate publication and missing publication fail
before acceptance. A valid surviving nine-MiB row is supported; the eight-MiB
fixture budget is not a row-size cap.

Paused transaction-owner tests require live decoded publication rows and the
unchanged 440-row/eight-MiB bound at both history sizes. Registered owners return
to zero. Borrowed and distinct-copy retaining controls exercise both fixture
sizes; their adverse lane must fail the same bounds. These counters observe
registered source/transaction owners, not every JavaScript reference, provider
request array or heap owner. Candidate disk storage avoids full durable-history
reference retention, but pending pins and model-facing request owners remain.

The new transport matrix covers Anthropic, Responses and Gemini with caching
off/on at both sizes, after successful installation and after rejected installed
history is compensated. Expected request rows come from an independently built
fixture and the legacy array strategy. Real SDK/provider conversion runs with
only the network boundary replaced. Retry request bodies must match exactly.
SDK response content serialization is compared with the same transport fixture
run against the independent expected request; no property-order normalization
is applied to request or response bytes. Anthropic caching flags are checked.
This does not prove remote cache persistence or live-provider behavior.

## Remaining eager calls and ownership

The pending-window chain remains:
`CompressionHandler.ts:540/541` supplies the builder and lines 542/543 supply the
array fallback; `pendingContextWindowEnforcement.ts:409/417` consumes them.
The public builder remains at `CompressionHandler.ts:867/871`, forwarding to
`compressionContextBuilder.ts:42`, which calls `HistoryService.getCurated`.
Public array strategies remain callable. The provider hard-limit route no longer
reaches that builder. Line references describe this stage's closing source and
may move in later edits.

The structural scanner still reports `materializeHistory`, `captureChronology`,
`getAll` and `getCurated`. Provider recomposition and finalized prompt estimation
still collect request arrays. Provider conversion, hooks/envelopes, media
resolution, transfer/checkpoint/control restore and transport retry ownership
remain outside this migration. Pending identity pins can grow with unsettled
work. No eager facade was renamed or exempted.

## Verification record

The final deduplicated ordinary union has 412 passes, zero failures and zero
skips across 52 isolated invocations, including the unchanged original 31 cases.
All 144 saved byte pairs match exactly: 120 request-body pairs and 24 SDK
response-content pairs. The new 24-case matrix requires nonempty emitted text
at every point. Artifact counts include before/after request comparisons from
adjacent matrices and are not 144 distinct scenarios.

Agents production and Bun checks, explicit strict stage-test and BODY checks,
and core TypeScript pass. All 25 stage code files pass forced 800/80 ESLint with
zero warnings and Prettier. The audit retains all 2,117 finding identities,
including duplicates, with no additions or removals when line drift is ignored.
All 20 protected hashes match; all original assertions in eight migrated fixture
files are token-identical. `git diff --check` passes. The separate trap lane has
four required failures and zero passes. The unchanged structural suite has 18
passes and two production-surface failures; mutation controls pass.

The initial source capture omitted the pre-existing untracked shared
`historyRowTransform.ts`. Its stage-only diff is reconstructed by removing exactly
the two publication-option edits from the final file, with that limitation saved
in `shared-baseline-provenance.json`. It is not an independent starting-source
capture. The other stage source snapshots and final hashes distinguish this work
from earlier dirty edits.

The selected manifest, confirmation manifest, protected hash comparison,
assertion-preservation comparison, audit comparison, byte-pair receipt and final
summary hold exact commands and final results. Selected tests are isolated by
absolute path, and final counts must deduplicate confirmation invocations.
Structural and retaining-trap failures are reported separately from ordinary
regressions.

Adverse logs retain early fixture initialization failures, module-alias failures,
route deadline failures, obsolete fixture seam failures, missing-candidate RED,
static-gate failures and audit findings before corrections. The valid baseline
route RED reaches the captured eager provider path; earlier import failures do
not count as behavioral RED. A route projection fixture initially left a large
surviving suffix despite expecting the legacy two-row result. Its deficit was
corrected without changing production thresholds or the original deadline.
The retry accounting fixture initially omitted the existing 37-token base
offset; its final assertion includes that offset. Nonempty-response assertions
exposed incomplete network fixtures: Responses needed an output-text delta,
and the Gemini streaming route needed an SSE response. The final fixture uses
the actual SDK response shape and requires emitted text at every matrix point. Token rollback delta checks
preserve the original equality contract while avoiding audit self-confirmation.
Original regression assertions are compared token-for-token with stage baseline.

Host snapshots show concurrent unrelated workloads. Heavy lanes are serialized,
but no quiet-host statistical heap sweep, retained-growth acceptance or leak
result is claimed. The one-MiB retained-growth allowance and estimator are
unchanged. Repository-wide test/build/model-smoke lanes remain outside this
scoped result.
