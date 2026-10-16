# Pending-window fallback uses disk rows; three eager history surfaces remain

Pending-window enforcement now prepares and publishes disk candidates. No
executable production consumer of `HistoryService.getCurated` or the public
`CompressionHandler.buildCompressionContext` array builder remains in packages,
plugins or scripts, so both facades and the standalone eager builder were
removed. This stage does not establish whole-session memory acceptance.

Evidence is under
`tmp/verify854/p05d/pending-window-disk-20261001-sol/`. Source snapshots capture
the starting dirty workspace. Earlier evidence and protected sources were
preserved. No GitHub, commit, push, OCR, PR or merge action was performed.

## Route and semantics

`PendingContextWindowEnforcer.forceTruncationIfStillOverLimit` computes the
same request-aware history target and calls `applyPendingWindowFallback`.
`CompressionHandler` supplies `runDiskFallback`, which shares the disk runner
with the provider hard-limit route. The provider route retains its existing
AggregateError wrapper. Pending failures retain their original diagnostic,
without the provider wrapper. An unchanged hard-limit regression exposed that
difference before the shared runner was separated from the wrapper.

The disk runner captures raw membership, filters curated rows individually,
serializes durable rows and preserves pending caller rows as identities.
`TopDownTruncationStrategy.compressDisk` uses the existing reduction target,
minimum retained history and tool-pair boundaries. The density, full-compression,
ineffective-compression retry and last-resort tool-response ladder is unchanged.
Empty history and structural no-op do not publish a candidate or reset state.

Publication validates the candidate range, invalidates Responses stored-chain
state and uses the existing row transaction. Applied callbacks must install
exactly once. Missing installation, duplicate installation and false return
after installation are errors. An outer disk snapshot restores rejected
installation, original pending chronology references, tokens, base offset,
cache anchor and prompt baseline. Partial admission relies on the row
transaction's compensation protocol. If outer compensation also fails, both
failures remain in an AggregateError.

Durable publication uses journal backpressure. When the source contains caller
pending rows, publication retains the existing non-streaming mode. Waiting for
the writer paused by that same caller would deadlock. The tests finish
window enforcement before releasing that writer; they also require positive
registered publication owners and the unchanged owner bound at the controlled
pauses. No ownership check was disabled to make the route finish.

## Behavioral and transport evidence

Actual 512/8192-row histories are compared with independently constructed
legacy array selection. Separate ordinary pending adds and compression-queued
adds exercise membership before preparation, during publication, after
installation and after writer acknowledgement. Exact pending row and chronology
reference identities are checked. Rejection, false return, cancellation,
partial admission, duplicate publication and missing publication restore the
original state. Rejection and cancellation replace caller chronology markers
and force GC before compensation. A surviving valid nine-MiB record is supported;
the eight-MiB fixture gate is not a maximum record size.

The pending transport matrix contains 24 cases: both history sizes, Responses,
Anthropic and Gemini, caching off/on, and accepted/rejected installation.
It uses real provider conversion and SDK request construction with only the
network boundary replaced. Request BODY strings and SDK response-content JSON
are compared directly, without property-order normalization. Retry request
bodies must be identical, emitted text must be nonempty, and Anthropic caching
markers are asserted. The existing provider fallback, provider hard-limit,
curated recomposition and tool-truncation byte suites are also run. This does
not prove remote cache persistence or live-provider behavior.

The facade migration uses a test-only independent curated array oracle where
old assertions require arrays. It does not add an eager production adapter.
Legacy strategy doubles are adapted only in the hard-limit test fixture. The
actual pending disk route and transport matrix do not use that adapter.
Original assertions are preserved as token multisets, allowing renamed local
variables, the removed-facade fixture substitution and formatting-only commas.
Six legacy fixture files required registration extraction for the unchanged
800/80 lint limits. Their original labels, test counts and inherited hook bodies
are independently compared with the starting snapshots.

## Ownership limits

Successful installation over settled durable history plus the tested ordinary
caller adds stays within 440 registered rows and eight MiB at both sizes.
Borrowed-reference and distinct-copy retaining controls must fail that same
gate in their adverse lane. Registered owners settle to zero after writer
acknowledgement. These counters cover registered source and transaction owners,
not every JavaScript reference, request array or heap owner.

The non-streaming pending mode can retain unacknowledged publication rows.
Rejected-history compensation can queue restored durable rows until the paused
writer resumes. Neither arbitrary unsettled work nor every compensation phase
has a context-independent owner bound. Pending identity pins and queued caller
work can grow. The existing `addBatch` route also materializes and republishes
history: a fixture probe reached 899 registered rows at size 512 before fallback.
The pending route tests use separate ordinary `add` operations, which are the
caller path under test; this does not repair or certify `addBatch` ownership.

Public array-based strategy APIs remain callable; their caller-supplied arrays
are outside the disk route. Provider request assembly, conversion,
hooks/envelopes, media resolution, transport retry and other control/checkpoint
owners remain outside this stage. The structural scanner still reports `materializeHistory`, `captureChronology`
and `getAll`; no eager surface was renamed or exempted. Removing `getCurated`
reduces that list from four to three.

## Verification record

The final deduplicated ordinary union has 626 passes and zero failures across
80 scoped invocations, including the original 31 cases. The 24 pending BODY
cases and all five existing BODY lanes pass. All 120 saved pairs match:
72 request BODY pairs and 48 SDK response-content pairs. The three other BODY
lanes assert exact equality but did not save their optional wire artifacts,
because the runner supplied different output environment names. Their logs
remain; saved-pair counts do not include them.

Both adverse retaining lanes have four required failures and zero passes.
The unchanged structural suite has 18 passes and two production-surface failures;
its finding list shrinks from four surfaces to three. All 18 protected hashes
match. All 806 starting assertions in 42 changed files survive the preservation
comparison, and all 67 original test labels and inherited hook bodies in six
registration-extracted fixture files match. The audit adds zero findings.

The selected and confirmation manifests contain commands, subprocess statuses,
pass/fail counts and per-lane host snapshots. `final-summary.json` holds the
closing receipts. Confirmation runs replace rather than add to earlier
invocations of the same ordinary suite. Retaining trap failures and structural
production-surface failures are separate from ordinary regressions. Early
initialization, fixture, diagnostic and gate failures remain in the evidence
directory. An added no-op fixture initially treated minimum-retained selection
as a no-op, although the existing strategy reports it as applied. The corrected
fixture tests empty membership and history accounting already at the explicit
zero target. No strategy threshold or original assertion was changed.

Agents production and Bun checks, core production checks, explicit strict
pending-route/BODY checks, forced 800/80 ESLint with zero warnings, Prettier,
audit and `git diff --check` run on the final stage sources. Legacy test typing
is separately compared with captured source because the broad test configuration
already had diagnostics. The protected hash and assertion-preservation receipts
identify the unchanged sources and surviving original assertions.

The audit requires zero new findings. Two prior fixture classifications disappear
because the lifted test registrations now explicitly assert that their bodies
finish without throwing; their original assertions remain. No audit or lint
rule was changed.

Host snapshots show unrelated concurrent workloads. Heavy test lanes are
serialized. No full suite, statistical heap sweep, retained-growth acceptance
or leak result is claimed. The one-MiB retained-growth allowance is unchanged.
