<!-- Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. -->

# Realistic-session memory tests

The test-only subpaths are `core/scale-test-lane.js`,
`core/realistic-session.js`, and `core/session-memory-protocol.js` under
`@vybestack/llxprt-code-test-utils`. They import no provider, agent, plugin,
or journal production code.

## Fixture and byte accounting

`realisticSessionRows()` lazily yields 25,000 rows. Each quartet contains human
text, assistant text, a tool call, and its matching result. IDs and text differ
between rows. Three results contain 2 MiB each. The text payload totals exactly
64 MiB, including UTF-8 and escaping characters. Tool-call `text` is input data
for the adapter's argument object, not an already serialized JSON argument.

`sessionRowPayload()` returns this neutral content. Its byte count excludes row
IDs and envelopes. `realisticSessionSummary()` computes its digest and counts
incrementally, and reports the largest complete call/result unit. Route adapters
must separately count actual journal bytes, selected native-format payload bytes,
and complete wire bytes. None of these is assumed equal to the neutral count.
Build reference digests incrementally before measurement. Do not construct an
eager expected request body.

## Adapter lifecycle

Implement `SessionRouteAdapter` locally to the production route's package.
`warmup()` exercises that route on a small corpus. `prepare()` seeds a real
journal using bounded batches and releases seed objects before returning.
It returns corpus accounting, an independent wire reference, the measured
`run()` operation, and `close()` cleanup. Run the measurement in an isolated
process. HTTP and WebSocket receivers belong in separate processes.

For send, `run()` must call the public provider with the journal pin and consume
and hash the actual upload incrementally. Count selected rows independently,
including a realistically sized suffix when exercising stateful Responses.
For record, start with the full journal present, then measure bounded new output
through the route's parser, logging, agent recording, append acknowledgement,
terminal publication, and durable reopen verification. A direct journal append
benchmark does not replace this adapter.

Call `probe.checkpoint()` at the quarter, half, and three-quarter consumption
positions. Send also requires conversion, post-serialization transport entry,
paused upload, and body admission checkpoints. Record requires append, ack, and
terminal publication checkpoints. Each checkpoint takes an uncollected sample
before a settled reading. `probe.sample()` provides additional synchronous
high-water observations inside conversion or serialization. An interval samples
while asynchronous work runs. Release operation-local holders before `run()`
returns; the harness then samples `after-release`, preserving the route until
`close()` runs. Keep the provider instance reachable for route-level repeat-send
release tests as well.

## Predicate and controls

`assertSessionMemory()` requires the maximum collected heap-plus-external growth
strictly below `max(8 MiB, floor(wireBytes / 8))` for sends. Record uses neutral
payload bytes instead. The 8 MiB floor allows current-row conversion, including
the 2 MiB tool results, and fixed runtime bookkeeping. The one-eighth term stays
far below a complete selected history. The control must exceed twice this bound.
Small selections, missing checkpoints, invalid readings, and changed wire digests
or lengths fail independently of memory. RSS remains diagnostic.

Each checkpoint uses the same full-collection settling procedure as the baseline
while the operation is paused and its objects remain in scope. Use about eight evenly spaced checkpoints
across conversion and upload, including mid-fill, mid-send and body admission
before completion. A final post-return reading cannot replace them. The sampler
never clears production holders or changes production code. Conversion observers
can take cheap uncollected samples between collection checkpoints.

JSC heap includes some externally owned storage. The sum with
`max(external, arrayBuffers)` is a conservative upper bound: overlapping storage
may be counted twice, never omitted. Baseline and checkpoint use the same sum.
Uncollected heap and buffer peaks are reported diagnostics only. The
`allocationGrowthBytesPerRow` diagnostic sums positive changes between sampled
heap-plus-external readings and divides by selected rows. It is an allocation-volume proxy, not a total-allocation counter: automatic GC
can occur between samples, and heap/external storage may overlap. No sample is discarded, retried or averaged.

Pass the supplied owner each selected row's complete native-format payload during
the same measured operation. HTTP controls may instead retain every selected raw
history row if that holds at least the complete history payload. For record pass each existing row's neutral payload
during the record window. The ordinary owner retains nothing. Repeat with
`createWholeHistoryBufferingControl()`, which makes fresh byte copies of every
payload and holds them through sampling. `assertWholeHistoryControl()` checks
complete retention and requires a memory-bound failure under the same predicate.
Only then call `release()`. An early pull trap or a short retained prefix cannot
substitute for this control.

## Lane selection

`selectScaleCases(defaultCases, extendedCases)` retains every default case and
adds extended cases for `LLXPRT_SCALE_EXTENDED=1`. `0` forces defaults. Without an
override, only scheduled or manually dispatched `Nightly Tests` runs select the
extended lane. Other explicit values fail. Put selected sizes in registered test
names so diagnostics expose the chosen cases. Construct large fixtures inside
selected cases, not before selection. No runner or workflow edits are needed.

## Native HTTP reference and control

The native HTTP adapter independently enumerates the selected journal once inside
the measured window to feed the supplied owner and count selected rows. This
includes Anthropic, whose indexed transport bypasses the outer selection reader.
The ordinary owner stores nothing; the control retains fresh raw-row byte copies
through body admission and after-release. Native conversion and upload still run
unchanged, with cold-fill collections through existing format registration
callbacks and the existing file-I/O seam for Kimi fact filling. Receiver checkpoints wait for the sender to acknowledge collection,
so the sender remains in flight during upload samples.

Anthropic's caller-owned reference made 837,456 random row reads for this corpus,
about 33.5 per row, versus zero random reads for the streaming Chat reference.
Reading each reference row from the journal made setup dominate the hang guard.
`realisticSessionRowAt()` reconstructs one deterministic reference row without
I/O or a whole-history array. A streaming digest test compares every reconstructed
row with the generator. This changes reference setup only; the measured native
send reads its real journal and does not prefill format lengths.
