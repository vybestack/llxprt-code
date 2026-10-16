# Metrics and the one-row probe no longer materialize raw history

This stage removes the two requested non-compression production
`getRawHistory` calls. The package/plugin/script AST inventory drops from four
direct non-test calls to two. The raw facade and Criterion 1 remain RED.

Evidence is under `tmp/verify854/p05d/raw-metrics-probe-20261001-sol/`.
The existing dirty workspace and earlier evidence were preserved. No protected
`.llxprt` content, raw facade implementation, enforcement rules, scanner or
threshold was changed. No GitHub, commit, push, OCR, PR or merge operation was
performed.

## Metric input, timing and reference-byte ownership

`MediaLifecycleMetrics.snapshot` already returned a promise. Its
`HistoryMetricSource` now requires `streamRawHistory`, and the existing
`HistoryService` supplies that API. Both existing metric clients continue to
await the snapshot; there is no synchronous array adapter.

The snapshot starts the cold raw cursor before sampling the other lifecycle
owners. The first `next` pins the journal before asynchronous traversal.
Request, recording queue, persistence queue, provider retention, decoded cache,
process memory and OS peak values are sampled in the invocation turn, before
awaiting history or spool work. This prevents an asynchronous history scan from
sampling queues after they drain. Process values are taken before reference
index writes, including after the probe's existing forced-GC settle point.
The snapshot does not add a GC call, queue flush or history event.

History measurement holds scalar totals and a scoped `MediaMetricByteIndex`.
The private index hashes each content ID into a file containing its byte count.
A first occurrence adds to the retained total; a duplicate contributes zero
and rejects inconsistent byte lengths. Each lookup reads one scalar record.
There is no history-sized Map, Set, row array, reference collection or promise
fan-out. Index storage grows on disk and closes on normal completion, source
failure, validation failure, cancellation and synchronous owner-sampler
failure. The pinned cursor also closes, and outstanding metric work settles
before a failed snapshot returns.

Counter scopes are unchanged. Local retained blob bytes count distinct raw
reference IDs and their declared lengths, not all objects in the store.
Resident encoded bytes count every inline base64 occurrence using the existing
ASCII byte charge; URL blocks do not contribute. Request materialization,
queues, provider retention, decoded-cache availability, process and OS values
remain separate from asynchronous physical spool bytes. Safe-integer and
non-negative validation remain enforced. No eight-MiB input-row cap was added.

## Exact admitted-row probe route

`scripts/issue-3199-media-memory-target.ts` now passes its cold raw cursor to
`resolveMediaProbeHistory`. This helper feeds a single borrowed row to the real
`RequestMediaResolver.resolve`, retaining the existing one-row workload.
It rejects empty or multi-row probe history rather than accumulating an
arbitrary history array. The existing resolver receives a bounded `[row]`,
performs real blob verification, reservation and base64 materialization, and
returns the same resolved-request lifecycle. Cursor/source failures and an
unexpected second row release any request already resolved.

The exact target's image size, per-turn unique identities, request and envelope
budgets, queue budgets, transport consumption, persistence, recording flush,
forced-GC sequence, active/settled sampling order, superseded-owner checks and
plateau evaluator are unchanged. Both Bun and Node bundles of the exact target
build successfully. Statistical execution of the full target is deferred
because the recorded host has active unrelated CLI sessions. The bundles are
not presented as measured-heap acceptance.

## Behavioral evidence

Real 512/8192-row journals contain media references, duplicate IDs, legacy
inline media, URL media and nested tool call/result blocks. Independent scalar
expectations verify exact unique-reference and inline totals. Raw serialization
hashes and independently constructed redacted diagnostic hashes match.

The saved census has 512 and 8192 decoded rows respectively, one registered
reader-owned row at peak, 22,179 and 22,184 charged serialized bytes at peak,
and zero live rows/bytes after completion. These values satisfy the unchanged
440-row/eight-MiB controlled-fixture bounds. Separate valid base64 input larger
than eight MiB is accepted with one registered row and no artificial size cap.

Real store/history/request tests prove duplicate references do not double
count local blob bytes, measurements do not reserve media or emit history
events, removed references lose their history reservation, request
materialization drops to zero on release, and clearing history drops retained
and encoded counters to zero while physical spool bytes remain independent.
Invocation-time pinning survives clearing and replacing live history.
Source failure, late inconsistent duplicates, invalid byte counts, total
overflow, synchronous sampling failure and pre/mid-read cancellation close
readers and scratch.

The admitted-row helper test compares exact independently constructed serialized
request bytes and checks real resolver accounting, missing-blob rejection,
abort handling, workload-shape rejection and release. Four deliberate consumers
strongly retain every borrowed row or distinct shallow copy at both fixture
sizes. Their ordinary controls detect excess and release to zero. With
`MEDIA_METRIC_RETAINING_TRAP=1`, all four fail against the unchanged bounds.
These are explicit-owner census controls, not measurements of every JavaScript
reference or retained heap.

## Verification

The accepted regression union has 337 passes, zero ordinary failures and zero
skips across 33 isolated invocations. It includes the original 31 cases,
media/store/request/provider adjacent suites, the admitted-row probe helper,
redaction tests and both twelve-case tool provider body matrices. All 24 saved
actual/expected provider body pairs match byte-for-byte.

Official root typecheck and lint pass. All 639 dirty code files pass normal and
forced 800/80 ESLint with zero warnings, and all pass Prettier checks. The test
audit retains all 2,126 findings, including duplicate identities, with zero
additions or removals when only line numbers are excluded. Protected hashes
match. Comparing every pre-existing file against the stage baseline finds
changes only in the two requested target files. `git diff --check` passes.

The unchanged structural suite has eighteen passes and two failed production
surface assertions. Its mutation controls pass. The five reported surfaces
remain `materializeHistory`, `captureChronology`, `getRawHistory`, `getAll` and
`getCurated`; their failures are not waived. The separate retaining-trap
invocation has zero passes and four expected failures.

Exact accepted commands, exit codes and logs are in `accepted/manifest.json`.
The aggregate result, body comparisons, caller inventory, ownership census and
scope limits are recorded in `final-summary.json` and the adjacent receipts.

Adverse evidence retains the raw-array metric RED, absent probe-helper RED,
initial serialized-property-order fixture mismatch, initial lint failures,
initial audit findings and four expected retaining-trap failures. Fixture and
audit cleanup checks were corrected without reducing assertions or changing
scanner/enforcement rules. Scratch differences test both added and removed
paths against an independently captured directory census.

No statistical heap lane, full repository test run or whole-session memory
acceptance is claimed. The full probe's plateau and any retained-heap acceptance lane need a
quiet host. The retained-growth allowance and its estimator were not changed.

## Remaining raw callers and ownership limits

`CompressionHandler.ts:201` still passes raw history to synchronous density
optimization. Its path/call/inclusion indexes and decision/application contracts
remain outside this stage. `providerContentEnforcement.ts:651` still copies raw
history for fallback capture and later rollback through `replaceAll`.
Those two migrations must complete before the raw facade can be removed.

The existing general `RequestMediaResolver` still has array-valued inputs and
outputs, selected-reference and unique-reference collections, reservation IDs
and materialized-data Maps. This stage proves its one-row probe use, not bounded
ownership for arbitrary provider requests. The probe's separate persistence
and history-count `getAll` calls still materialize its one current row. Other
provider request/retry/projection arrays, caller-retained rows and unsettled
pending journal owners retain their earlier ownership contracts. Media metrics
retain their existing counter definitions; they do not become a whole-process
owner census through this migration.
