# Provider streaming restores curation and normalization diagnostics

This stage closes the successful-request diagnostics gap in the provider cursor.
The stream now emits the eager route's AI analysis, excluded-message notices,
curation summary, reconstructed-call warnings, unmatched-response warnings and
aggregate cache-anchor-removal warning. Event names, levels, counts and order
match the original eager captures. Large detail lists are sampled rather than
retained in full. Provider normalization decisions and wire bodies are unchanged.

Evidence is in
`tmp/verify854/p05d/provider-stream-diagnostics-20260930-sol/`.
The directory is gitignored. Existing dirty work and earlier evidence were
preserved.

## Original-route evidence

The tests were added before production changes. The first run had one pass and
nine failures. It captured the real eager facade and real journal-backed cursor
for 512 and 8192 mixed rows, including invalid AI rows, signed thinking, split
tool calls, duplicates, reconstructed calls, media and lost cache anchors. A
human-speaker response without a matching call exercises the previously omitted
adjacency warning. The logger is real; only its file-output sink is replaced to
capture serialized events without writing workstation logs.

The original captures have 323 events for 512 rows and 5,123 events for 8192
rows. `diagnostics-vs-original.json` compares the final cursor events and output
hashes against those pre-change captures. Its only permitted detail adjustment
is the documented anchor-index sample. Every other event detail and the complete
event sequence match. Independent fixture-derived assertions also check the
summary fields, warning counts and positions, input/output counts and sample
indexes. Expected rows come from the old eager normalization, not the cursor.

## Bounded diagnostics and ordering

Provider curation uses scalar counters for total and included rows, speaker
counts, tool activity and exclusions. Its summary has the same fields and values
as the eager summary. The compression notice is emitted once for both journal
and request-override sources. Pending rows remain outside curation statistics,
and remain inside normalization and anchor counts.

Reconstruction warnings are deferred through disk markers until curation has
finished. They precede adjacency warnings, as in the eager pipeline. Ordered
output is staged on disk one row at a time to compute final output counts and
anchor survival before emitting the aggregate warning. The warning is therefore
visible before the consumer receives its first row, including a consumer that
stops after that row. This adds a disk output pass; it adds no eager row array,
context-sized in-memory warning list, identity map or logging closure.

The normalization disk still stores pre-serialization response scores and pending
block provenance. NaN/null score behavior, shared versus distinct pending block
identity, cache-anchor metadata and output ownership remain covered by the
existing cursor tests. Output backpressure, cancellation and scratch cleanup
continue to use the existing cursor contract. A valid row larger than 8 MiB
remains accepted.

## Intentional detail differences

The inspected eager summary already emitted scalar fields. It did not emit a
full history array. Its per-AI-message block list, reconstructed-call lists and
aggregate anchor-index list could grow without a bound. Both routes now apply
the same limits:

| Detail | Preserved behavior | Large-detail behavior |
| --- | --- | --- |
| AI analysis blocks | First 32 block summaries use the original fields and 50-character text previews; `blockCount` remains exact. | Additional blocks are omitted with `blocksTruncated: true`. |
| Reconstructed calls | First 32 call IDs and tool names are emitted. | `callCount` is exact and `callsTruncated: true` marks omitted calls. |
| Tool identifier strings | Strings up to 256 characters remain unchanged. | Strings are truncated to 256 characters with `callDetailsTruncated: true`. |
| Lost-anchor indexes | Up to 32 input indexes retain the original detail shape. | First 32 indexes, exact `inputAnchorCount`, and `inputAnchorIndexesTruncated: true` replace the unbounded index array. |

Events are not sampled or dropped. Per-event payloads are bounded, while the
number of events still follows the number of AI rows and reconstructed calls.
The summary itself has only scalar fields. Tests use an 8,192-block AI row,
8,192 reconstructed calls and oversized identifiers to check the limits and
absence of complete row payloads. Small-anchor and surviving-anchor tests check
that the aggregate warning remains conditional and that small details are
unchanged. Disabled logging emits no events, and unopened cursors remain cold.

DebugLogger's redaction implementation is unchanged. Captures are taken after
that logger has constructed its output entry. Tests verify that response payloads,
base64 media and text beyond the original preview are absent. Existing text
previews and short IDs are still observable; this stage does not promise that
all sensitive text in those fields is redacted.

## Verification

The isolated provider-related regression run has 1,355 passes and no failures
across 136 invocations in `manifest.json`. The final current-source diagnostic,
fault and cursor-control run has 18 passes and no failures in
`focused-accepted-current.log`. It includes 13 diagnostic cases. The original 31
atomicity/density cases pass without changes.

All 64 saved actual/expected body pairs match byte-for-byte in `body-pairs.json`.
This includes four runs of the twelve-case 512/8192-row Responses, Anthropic and
Gemini matrix with caching enabled/disabled, plus sixteen existing body cases.
The 64 pairs are repeated-run evidence, not 64 distinct scenarios. Anthropic
cached cases require `cache_control` in the wire body, and Responses retries
require identical bodies across attempts. Only the network boundary is replaced;
these tests do not prove remote cache writes.

Official root `npm run typecheck` passes in
`official-root-typecheck-accepted.log`. Official root `npm run lint` passes in
`accepted-gates/official-root-lint.log`. All 555 dirty code files pass normal and
forced 800/80 ESLint with zero warnings and pass Prettier checks in
`accepted-gates/manifest.json`. Formatting of both reports and `git diff --check`
also pass. The audit keeps 2,126 baseline finding identities, with no additions
or removals; the comparison is a multiset and ignores line numbers only.
Protected-path hashes match both the stage-start snapshot and the preceding
stage's snapshot.

The unchanged structural suite has 18 passes and two failed production-surface
assertions. Its six finding identities remain `materializeHistory`,
`captureChronology`, `getRawHistory`, `getAll`, `getCurated` and
`getCuratedForProvider`. The two existing semantic-purge no-array assertions also
remain RED. Structural mutation controls, the cursor eager/retaining-generator
controls and retaining-consumer ownership controls pass. No failure was
suppressed, and no required check or protected file was changed.

Adverse logs retain the initial diagnostic failures, focused lint failures and
root typecheck failure. The typecheck caught a test-helper import of an
unexported telemetry subpath; it now uses the existing debug export. A further
root typecheck caught `Array.at` in tests under the existing ES2021 library
target; equivalent array indexing fixes that without changing compiler settings.
Forced lint required smaller test-registration bodies and strict equality
assertions. The
audit flagged repeated empty-event assertions and treated separate eager and
stream sink reads as same-source expectations. Cold/disabled events now form one
two-phase ledger, and a typed eager-route fixture makes expected-event provenance
explicit. Exact comparisons remain in the test callbacks. No scanner rule,
assertion condition or comparison scope was weakened. A preliminary summary
reader used escaped separator strings; its corrected reader compares the full
TSV multiset while ignoring line numbers only.

## Remaining ownership and scope

The public synchronous provider facade remains eager. Existing enforcement,
request-envelope, hook, projection, media and provider conversion arrays remain
as documented in the preceding migration report. Restoring diagnostics does not
remove those seams. No full retained-heap acceptance claim is made by this stage;
explicit cursor ownership and deliberate retaining-consumer controls are checked
without changing the estimator or its thresholds.

On source failure or cancellation during preparation, the stream may have emitted
row-local AI analysis before termination. The final curation summary and aggregate
normalization warning require successful preparation. The completed-request
parity claim does not cover failure timing against a synchronous facade that has
already materialized its source.

No `.llxprt`, protected raw-history files, enforcement code, structural scanner,
retained-growth estimator, thresholds or required checks were edited. No GitHub,
commit, push, OCR, PR or merge action was performed.
