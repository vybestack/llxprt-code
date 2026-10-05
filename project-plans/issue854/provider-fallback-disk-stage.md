# Provider fallback rollback uses disk rows; candidate installation still uses arrays

The provider hard-limit fallback no longer copies `getRawHistory` for rollback.
Its invoked capture and compensation path now uses a scoped pinned-journal
snapshot and a disk-backed restore candidate. The package/plugin/script direct
production raw-call inventory drops from two to one. The raw facade and
Criterion 1 remain RED.

Evidence is under
`tmp/verify854/p05d/provider-fallback-disk-20261001-sol/`. The pre-existing dirty
workspace, protected paths and prior evidence were preserved. No GitHub,
commit, push, OCR, PR or merge operation was performed.

## Capture, installation and compensation contracts

`ProviderContentEnforcer.executeFallbackTruncation` captures the cache anchor
and prompt baseline before asynchronous snapshot work. It calls
`HistoryService.withRawHistorySnapshot` around the existing fallback callback.
Journal membership and readable descriptors are pinned before traversal.
Durable rows are copied into private disk files, one row at a time. They are
not retained in a full-history array or reference index.

Caller-owned pending journal rows retain their existing strong ownership.
Their original chronology markers are also held strongly for the scope, so a
metadata overwrite and forced GC cannot destroy the marker needed by rollback.
This pending identity collection can grow with unsettled caller-owned work.
It is not presented as bounded durable-history ownership.

Successful candidate installation is deliberately unchanged. The callback still
receives `IContent[]`, invalidates the Responses stateful chain, and passes its
array to `replaceAll`. Candidate installation then resets the anchor and
baseline. A false result after installation remains a rejection. Throwing
bookkeeping or baseline reset also triggers compensation. Failure before
installation leaves the original state untouched through the existing atomic
mutation contract.

Rejected installed history is rebuilt from the captured snapshot through
`restoreRawHistorySnapshot`, without a `replaceAll` rollback array. The restore
sink serializes durable values and preserves pending caller identities. It
retains the old `replaceAll` zero-block filtering rule, estimates tokens over a
repeatable row stream, and uses the existing transaction, media effects and
compensating journal protocol. Only after history restore succeeds are the
saved cache anchor and prompt baseline restored. A failed compensation retains
the original failure and rollback failure in the existing AggregateError.

Durable-only restore publication waits for journal acknowledgements between
rows. A pending-owner snapshot keeps the original non-streaming publication
behavior: awaiting a writer suspended by its caller would deadlock that caller.
This path can retain the existing pending publication envelope. It does not
claim a bound for arbitrary unacknowledged pending work. Disk candidates now
publish context-range events through the row-wise builder even when publication
uses that pending mode. This avoids an eager history materialization hidden in
`finalizeHistoryMutation`.

Snapshot and restore-candidate constructors close descriptors and remove
partially allocated scratch after file-open failure. Capture and disk writes
also clean up on source failure, short/zero-progress writes, consumer failure,
cancellation and completion. Capture scheduling points allow timer cancellation.
The provider enforcer currently supplies no request AbortSignal to capture;
helper cancellation and a cancellation thrown after installation are tested,
but upstream request-signal propagation is not claimed.

## Behavioral and ownership evidence

Real 512/8192-row journals contain mixed nested tool calls/results, duplicate
call IDs, media, stored Responses markers and cache metadata. Each row includes
a 2,048-byte payload. Public enforcer tests cover installed provider rejection,
false rejection, baseline-reset rejection, partial journal admission and
cancellation after installation. Exact raw serialization digests, token deltas,
base offset, cache anchor and baseline must match the pre-fallback state.
Success tests verify candidate stamping and pending order. A separate valid
nine-MiB candidate row is accepted without a row-size cap.

Pending rollback restores the original caller row and exact chronology-marker
object after candidate installation, metadata replacement and forced GC.
Additional cases preserve pinned membership across live history replacement,
reject a damaged snapshot or lost restore candidate before publication, clean
up index/chronology open failures, complete actual seven-byte partial snapshot
writes, and close pre/mid-capture cancellation and consumer failure. A public
rollback test forbids `materializeHistory` after installation and succeeds.
A diagnostic test verifies both errors when provider rejection is followed by
failed journal compensation.

The rejection-route census has one decoded reader row and four registered
transaction rows at peak for both sizes, with 7,756/7,775 serialized bytes at
peak and zero live transaction rows/bytes after completion. Ordinary owner
controls strongly retain all original rows or distinct shallow copies at both
fixture sizes, detect the unchanged 440-row/eight-MiB bound, and release to zero. The separate `FALLBACK_RETAINING_TRAP=1` lane must fail all four
cases. These counters observe registered reader/transaction/consumer owners,
not every JavaScript reference, provider-result array or retained heap.

The 24-case transport matrix covers both history sizes, Anthropic, Responses
and Gemini, caching off/on, and installed fallback success/rejection. Actual
requests use the real enforcer and provider conversion/transport preparation;
only the network boundary is replaced. Expected rows are independently built
with the old eager normalization path. The rejection oracle includes the
existing subsequent unified pending-tool trimming, and the successful fixture
uses two valid marked candidate rows. Responses transport retries require
identical request bodies. Anthropic caching cases require wire cache flags.
Remote cache writes are outside this test.

## Verification and adverse evidence

The selected regression union has 922 passes, zero failures and zero skips
across 104 isolated invocations. Suite identities are deduplicated by absolute
path, so confirmation reruns do not inflate that count. The selected manifest
includes the original 31 cases, isolated compression/provider-adjacent suites,
new fallback fault/identity/owner suites and provider body matrices. The four
deliberate retaining-trap failures and five unresolved owner/structural failures
are recorded separately, not counted as ordinary passes.

The new 24-case fallback matrix, existing twelve-case hard-limit matrix and
adjacent tool/curation matrices pass. All 84 selected saved actual/expected body
pairs match byte-for-byte; the receipt includes 48 final-matrix pairs and 36
other accepted body pairs, not 84 unique scenarios. Root typecheck and lint
pass. All 651 dirty code files pass normal and forced 800/80 ESLint with zero
warnings and Prettier. The audit retains all 2,126 finding identities, including
duplicates, with zero additions or removals when only line numbers are excluded.
Protected hashes match and `git diff --check` passes. Exact arguments and exit
codes are in `selected-manifest.json`, `final-gates-current/manifest.json` and
`final-summary.json`.

The unchanged structural suite retains eighteen passes and two failed
production-surface assertions. Its mutation controls pass. The existing public
`transformAll` owner tests also remain RED: they retain 1,024/16,384 registered
rows at the two fixture sizes and exceed eight MiB at the larger size. Those
array contracts and their protected assertions were not changed by this stage.
The stage-baseline source reconstruction confirms `transformAll`,
`captureChronology`, `transformRows` and `replaceAll` are unchanged. That is a
source comparison, not a baseline runtime reproduction of the owner failures.

Adverse logs retain the initial eager-snapshot RED, pending-writer deadlock,
hidden context-range materialization RED, partial-constructor leaks, first
lint/typecheck/audit failures, and deliberate retaining-trap failures. The first
body oracle omitted post-rejection tool trimming and used an empty AI candidate
row; its failed captures remain. Concurrent heavy scans also exceeded test
registration timeouts. Final transport lanes are serialized, with a larger
runtime timeout only on the newly added matrix. Memory assertions, row bounds,
byte bounds, retained-growth allowance and scanner/enforcement rules are unchanged.
An exact absolute-path rerun passes all fifteen provider-fallback propagation
cases, avoiding Bun relative-filter discovery of old copied baseline test files
in ignored evidence. A nonexistent supplemental body-suite name also produced
an invocation failure; it is excluded from the selected manifest and does not
replace any required suite. The accidentally started duplicate driver was
cancelled. All failed or cancelled logs remain available.

No statistical heap sweep is claimed. Recorded host snapshots show unrelated
active CLI/workload processes. The one-MiB retained-growth allowance and its
estimator are unchanged. Full repository test/build/smoke and whole-session
memory acceptance remain outside this result.

## Remaining raw and array surfaces

The remaining direct production raw call is
`CompressionHandler.ts:201`, which passes history to synchronous density
optimization. Its decision indexes and application contract still need migration.

The fallback strategy context/result, successful candidate callback and
`replaceAll` install still expose arrays. Provider recomposition and finalized
prompt estimation still collect full request rows. Provider request conversion,
hook/envelope, media resolver, retry and projection arrays retain their existing
contracts. `materializeHistory`, `captureChronology`, `getRawHistory`, `getAll`
and `getCurated` remain visible to the unchanged structural scanner. This stage
removes one invoked rollback capture, not those broader ownership surfaces.
