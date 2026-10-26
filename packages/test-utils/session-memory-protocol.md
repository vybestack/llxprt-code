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
process. A WebSocket receiver belongs in a separate process.

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

`assertSessionMemory()` requires both heap and buffer peak growth strictly below
`floor(selectedPayloadBytes / 4)` for send. Record uses neutral payload bytes.
It rejects small selections, missing checkpoints, invalid readings, and changed
wire digests or lengths. RSS is reported but does not decide acceptance.

JSC heap includes externally owned string and buffer storage. The buffer counter
uses `max(external, arrayBuffers)` because those counters overlap. Heap and
buffers are gated independently, never added together. Uncollected samples also
read `process.memoryUsage().heapUsed` because JSC's heap counter describes its
last collection. Deltas are not clamped, averaged, retried, or filtered.

Pass the supplied owner each selected row's complete native-format payload during
the same measured operation. For record pass each existing row's neutral payload
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
