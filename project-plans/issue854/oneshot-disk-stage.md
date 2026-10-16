# Primary one-shot now uses pinned disk history; the structural scanner remains RED

Primary `one-shot` dispatch and its eligible summary-failure fallback now use the
same pinned disk runner as middle-out. They do not call the eager context builder.
This stage does not remove `HistoryService.getCurated(): IContent[]` or establish
whole-session retained-heap acceptance.

Evidence is under `tmp/verify854/p05d/oneshot-disk-20261001T1835-sol/`.
Starting sources, the initial dirty diff, stage-only changes, command arguments,
exit statuses, actual/expected bodies and source hashes distinguish this work
from the pre-existing workspace. Earlier evidence directories were not edited.

## Dispatch and publication

`CompressionHandler.runCompressionWithRetryAndFallback` dispatches one-shot,
middle-out and top-down truncation before the array context is built.
`runDiskOneShot` selects `OneShotStrategy.compressDisk` through the shared
`runDiskSummary` runner in `diskMiddleOut.ts`. The runner prepares scalar metadata,
opens a dump snapshot, and spools its curated journal rows into indexed disk
storage. It does not wrap an eager array in an iterator.

The split retains the existing fractional tail, minimum compressible count and
tool-boundary recovery. One-shot ignores the cache-anchor head floor, as its
legacy strategy does. Summary requests retain the existing security preamble,
prompt, sanitizer, todo and transcript injections, prior-snapshot trigger,
provider diagnostics and usage aggregation. Optional verification retains its
best-effort semantics.

Transient summary failures retry against the same pinned source. Empty summaries
and exhausted eligible failures enter disk top-down truncation against that
source. Noneligible model/cancellation failures propagate. Primary publication
is outside the summary retry/fallback catch, so a publication fault compensates
rather than initiating a second summary attempt. Failed fallback publication
compensates and returns the existing failed outcome for failure bookkeeping.
A one-shot structural no-op returns without summary generation or publication;
only middle-out structural no-op substitutes disk one-shot.

The existing `publishCandidate` transaction computes destroyed chronology
membership with the disk span index, preserves existing summary spans and a
surviving semantic-media frontier, strips Responses stored-chain state, and
publishes detached candidate rows. The cache anchor is reset only after
successful publication. Summary recording selects the first explicitly marked
snapshot, with legacy summary detection as the secondary rule. Queued appends
remain outside pinned membership and flush after compression unlocks.

## Request ownership and limits

`OneShotStrategy.compressDisk` keeps empty-summary validation and optional
verification inside `withDiskSummaryRequest`. Every full model-facing request
row is charged before options construction and provider invocation, and remains
charged until verification completes or the attempt exits. Cancellation,
transport failure, empty summary and success release the owner. The request is
proportional to the compressed range; its charge is not an exemption or evidence
that the request is bounded.

An independent legacy one-shot request supplies exact expected row and UTF-8 JSON
byte charges at 512 and 8192 rows. Separate tests pause verification and verify
that the original request remains owned on both verification success and failure.
The verification request itself, the returned summary string, provider-converted
bodies, model hooks and transport retry references still need a separate owner
census. These tests do not enumerate all JavaScript references.

Settled source and publication transaction owners use the unchanged 440-row and
eight-MiB controlled-fixture limits, including paused publication with live decoded
rows. Borrowed-row and distinct-copy retaining controls must fail those same
limits. An individual valid row may exceed eight MiB; nine-MiB rows are exercised
in both the summary input and surviving tail. The fixture budget is not an
accepted-row size cap. Pending writer identity pins and caller-owned rows remain
owners under their existing contracts.

## Behavior and BODY bytes

Real 512/8192 mixed journals are compared with independently generated fixtures
run through the retained legacy array strategy. Cases cover old tool pairs,
split-crossing pairs, protected tail pairs, historical summaries, existing cache
anchors, semantic-media frontier precedence, summary recording, successful retry,
empty summary and exhausted transient fallback. Other cases exercise fail-open
hooks, queued appends, source error/cancellation and closure, model
error/cancellation, partial primary and fallback journal admission, complete
chronology compensation, caller marker identity after forced GC, valid large
rows, and structural no-op.

The BODY matrices cover Anthropic, Responses and Gemini with caching off/on at
both sizes. They compare before/after publication bodies and summary contents,
then invoke real summary providers through primary production compression.
Expected requests come from independently generated fixture history and the
legacy array strategy. Only network boundaries are replaced. Transport failures
exercise retries with identical actual bodies. Saved actual/expected files are
compared byte-for-byte and hashed in the run receipt.

## Remaining eager routes

The eager builder remains at `compressionContextBuilder.ts:42`. Its executable
compression callers are:

- Primary high-density dispatch at `CompressionHandler.ts:814`, followed by its
  array strategy and eligible array truncation fallback at lines 860 and 990.
- Provider hard-limit fallback at `CompressionHandler.ts:480/483`, entered by
  `providerContentEnforcement.ts:728`. Its callback applies array candidates
  under the enforcer's rollback and recomposition contract.
- Pending-window hard-limit truncation supplied at
  `CompressionHandler.ts:547/549`, consumed by
  `pendingContextWindowEnforcement.ts:409/417`.
- The public builder at `CompressionHandler.ts:1039`, public array strategy
  contracts and direct legacy callers. The old private middle-out no-op handler
  still exists for the array route, but configured primary middle-out returns
  through disk dispatch before it can reach that handler.

`HighDensityStrategy.compress` still owns full input, summarized-head,
preserved-tail, request and replacement arrays. Its continuous density optimizer
already uses disk rows; this stage does not migrate its summarization strategy.
Provider and pending hard-limit callback/candidate arrays remain. Public history
transfer, checkpoint/control restore, turn/media requests, model hooks, prompt
payloads, telemetry and provider conversion/retry ownership remain as recorded in
the preceding stages. No remaining array contract was renamed or exempted.

The scanner's four remaining contracts are `materializeHistory`,
`captureChronology`, `getAll` and `getCurated`. The production surface remains RED.
Registered disk-owner results do not establish bounded pending owners,
no context-length heap retention, no leaks or whole-provider acceptance.

## Verification notes

The final selected regression union has 1,082 passes and zero failures across
119 isolated suite invocations, including the original 31 atomicity/density
cases. Counts are by invocation, not a whole-repository acceptance claim. All
72 saved actual/expected BODY pairs match byte-for-byte. Agents production,
agents Bun-test and scoped BODY TypeScript checks pass. All 23 changed/new code
files pass forced 800/80 ESLint with zero warnings and Prettier checks.
`git diff --check` passes. The duplicate-preserving audit retains 2,117 identities
with zero additions or removals after excluding line drift.

The retaining controls have four required adverse failures and zero passes,
with cleanup assertions preserved. The unchanged structural suite has 18 passes
and two production-surface failures, matching the four remaining eager contracts.
Captured hashes for 17 protected files and six compression-enforcement sources
match their starting values. Final source and BODY hashes are saved in the run
receipt. This is not an all-workspace or all-earlier-evidence hash claim.

The run retains eager-dispatch RED and verification-owner RED before their
production changes. Generic legacy fixtures now select high-density so their
strategy-factory collaborator remains reachable. Their existing assertions are
preserved, and separate guarded production tests exercise the migrated one-shot
route. No assertion, scanner exemption, threshold or lint requirement was relaxed.

Earlier static logs retain a handler function-line failure, fixture lint failures,
and GC-import/placement errors. The GC tests use Bun's runtime GC API without
changing the production TypeScript configuration. A relative-path confirmation
invocation also matched copied baseline tests in ignored evidence. Subsequent
confirmation uses exact paths; those adverse logs remain available. First-use
prompt initialization is warmed in comparison fixtures, and rollback request
contents are compared structurally rather than treating object-property order as
provider BODY bytes.

Full repository tests/build/model smoke, statistical retained-heap acceptance and
whole-session/provider acceptance are deferred on the shared busy host. The
1,048,576-byte retained-growth allowance and estimator are unchanged. Protected
`.llxprt` and enforcement/scanner sources were not edited. No GitHub, commit,
push, OCR, PR or merge action was performed.
