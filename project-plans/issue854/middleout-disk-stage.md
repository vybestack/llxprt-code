# Middle-out now uses disk history; public getCurated remains RED

The invoked primary middle-out route now splits and publishes disk-backed rows.
Its structural no-op routes to disk one-shot, and eligible summary failures route
to disk top-down truncation over the same pinned membership. This stage does not
remove `HistoryService.getCurated(): IContent[]` or establish whole-session memory
acceptance.

Evidence is under `tmp/verify854/p05d/middleout-disk-20261001T1713-sol/`.
`stage-final.diff`, the captured starting source files, final source hashes and
selected-suite manifests separate these edits from the existing dirty workspace.
Earlier adverse logs remain available.

## Invoked route

`CompressionHandler.performCompression` retains its borrowed PreCompress hook,
compression lock, recording count and queued-append publication order. Its
`runCompressionWithRetryAndFallback` dispatches middle-out before constructing
an array context. `runDiskMiddleOut` builds scalar metadata, pins an actual dump
snapshot, and writes curated rows into `HistoryDensityRows`. Split calculations
use indexed disk reads, not an eager collection disguised as an iterable.

The disk planner preserves the fractional head and tail, exact cache-anchor floor,
tool-boundary adjustment, last-human lookup, short last-user relocation and large
last-user injection. Forward recovery never reduces the preserved-head floor.
The complete summary request uses the existing prompt, security instruction,
sanitizer, todo/transcript injections and trigger instruction. The same provider
response aggregation, usage, empty-summary diagnostics and verification semantics
remain in the strategies' shared execution methods.

Successful summary generation writes head rows, two synthetic rows and tail rows
to a detached disk candidate. Shared `publishCandidate` computes destroyed
chronology membership on disk, transfers semantic-media frontier metadata, strips
Responses stored-chain state and stamps the preserved-head cache anchor. It
publishes through the existing row transaction and changes the anchor only after
success. Recording summary selection retains its existing preference for the
first explicit snapshot, including an older snapshot surviving in the head.

Transient summary errors retry against the same pinned source. Structural no-op
uses disk one-shot, without rebuilding an eager context. Eligible summary errors
use disk truncation; noneligible model/cancel errors propagate. Publication errors
use disk transaction compensation and are not converted into a second summary
attempt. Failure bookkeeping and queued append release retain the handler's
existing order.

## Ownership is separated from model requests

The curated spool and candidate hold disk rows and scalar split positions. They
use detached writes, without growing identity maps. Source and transaction owner
checks cover real decoded rows at a paused publication boundary, not a zero-owner
sample after traversal. Both 512/8192 cases restore complete membership after
publication failure and subsequently compress successfully.

The summary request is a full model-facing array proportional to the compressed
range. `summaryRequestOwnership` charges every row before options construction
and transport. Cancellation releases this named owner, and no candidate is
published before a summary succeeds. These charges do not make the request
bounded and do not enumerate every reference held by a provider or hook.

The model's returned summary string, optional verification request, transport
conversion and retry bodies remain additional request owners. Verification still
uses its four-message request and best-effort result semantics. Its request is
not covered by a separate named-owner census in this stage. Pending writer and
caller-owned identity pins also remain outside any claim of bounded settled
history. No heap census, no-leak proof or whole-provider acceptance is claimed.

## Behavioral and transport evidence

The fail-first real 512/8192 tests reject the old eager preparation call. Final
coverage compares split/rejoin and summary contents against the retained legacy
array strategy over independently generated fixtures. Mixed histories contain
text, media, thinking, tool calls/results, errors and historical metadata.
Boundary cases include top/bottom tool pairs, existing anchors and summaries,
short last-user relocation and long-request injection. A structural no-op's
one-shot summary request also matches the legacy oracle exactly.

Lifecycle tests cover fail-open hooks, pinned membership during a paused summary,
queued appends, source failure/cancellation, model failure/cancellation, transient
retry, empty-summary truncation fallback, partial journal admission, caller marker
identity and complete chronology rollback. Valid nine-MiB rows survive both the
preserved tail and the compressed summary request.

Ordinary source/transaction controls pass the unchanged 440-row/eight-MiB fixture
bounds and return to zero. Borrowed-row and distinct-copy retaining controls at
both sizes exceed those same positive bounds. The separate adverse run records
zero passes and four required failures after cleanup checks. These measurements
cover registered owners and serialized JSON charge, not arbitrary heap owners.

The BODY matrix covers Responses, Anthropic and Gemini, caching off/on, at both
sizes. It checks before-compression bodies, summary contents, summary bodies and
after-compression bodies. An additional matrix invokes the real summary providers
through production compression and checks summary and subsequent publication
bodies against the independent legacy array oracle. Only network boundaries are
replaced. First-attempt failures exercise retry, and captured retry bodies are
identical. All 72 distinct saved actual/expected pairs match byte-for-byte.

The early transport harness incorrectly serialized an async iterable as `{}`;
those RED logs are not final request evidence. The corrected transport drains the
actual iterable. The real Gemini invocation required an SSE response for its
streaming summary endpoint; returning ordinary JSON produced empty-summary
failures. Corrected network responses preserve the real parsing path. Prompt
initialization is warmed in byte-comparison fixtures so an unrelated first-use
prompt-loader transition does not change an oracle/actual pair between calls.
No production prompt behavior was changed to make comparisons pass.

## Verification

The selected deduplicated suite union has 923 passes and zero failures across
102 invocations, including the original 31 atomicity/density cases. All compression
suites were run separately, followed by confirmations of changed fixtures and
four adjacent ChatSession compression callers. Final manifests and exact command
arguments remain in the evidence directory.

Legacy tests spying on the array strategy factory explicitly select one-shot,
matching their injected collaborator. Their original assertions remain. Chronology
and transcript fixture helpers were extracted to satisfy the existing function
line limit. Real middle-out coverage uses the invoked disk route independently of
those mocks.

The adjacent provider-fallback disk suite initially exceeded Bun's default
five-second deadline at 8192 rows. That interrupted run remains in the evidence.
A serialized rerun with the CLI test-runtime override, without changing source
assertions or enforcement, passes all 13 cases. Its runtime is recorded separately.

Agents production and Bun-test no-emit TypeScript checks pass, as does the scoped
BODY test configuration. All 24 changed/new code files pass forced 800 effective
lines per file and 80 per function, with zero warnings; formatting and diff-check
pass. The final test audit retains 2,117 duplicate-preserving identities with
zero additions or removals after excluding line drift. Captured versus final
tracked diffs for `.llxprt` and protected enforcement/scanner paths are unchanged.
This comparison is not a new all-workspace SHA-256 preservation claim.

The structural suite remains at 18 passes and two production-surface failures.
Its four eager contracts are `materializeHistory`, `captureChronology`, `getAll`
and `getCurated`. Mutation controls pass. No scanner exemption, bound, threshold,
assertion or enforcement policy was relaxed.

## Remaining eager call chains

The public getter remains executable through these exact compression chains:

- `CompressionHandler.runCompressionWithRetryAndFallback` at line 811 constructs
  the old context for primary one-shot and high-density dispatch. The shared
  builder calls `HistoryService.getCurated` at `compressionContextBuilder.ts:42`.
- Those primary failures enter `performFallbackCompression` at line 987 and
  `compressWithFallbackStrategy`, retaining the array-valued top-down contract.
- `createProviderContentEnforcer` at line 474 builds an array context for
  provider hard-limit fallback and passes an array candidate into the enforcer's
  rollback/recomposition callback.
- `enforceContextWindow` at lines 541/543 supplies the old builder and fallback
  strategy to `PendingContextWindowEnforcer.forceTruncationIfStillOverLimit`
  at `pendingContextWindowEnforcement.ts:409/417`.
- Public builder and direct legacy strategy callers retain their array-valued
  `CompressionContext` and `StrategyCompressionResult` contracts. Public history
  forwarding, deferred transfer, checkpoint/control restore, provider conversion,
  model hooks and retry ownership remain as recorded in the prior stages.

`caller-inventory.json` records the executable compression statements. The old
private middle-out no-op handler still exists for the array contract, but configured
primary middle-out returns through disk dispatch before reaching it. Its invoked
no-op and eligible fallback lanes no longer call `getCurated`.

The host remains shared with other work. Full repository tests/build/model smoke,
statistical retained-heap acceptance and whole-session/provider acceptance were
not run or claimed. No `.llxprt` edits, GitHub actions, commits, pushes, OCR, PRs
or merges were performed.
