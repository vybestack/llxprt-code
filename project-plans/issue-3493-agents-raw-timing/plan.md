# Issue #3493 — StreamTimingTracker misses raw reasoning and tool-call timing

## Problem

`StreamTimingTracker` (`packages/agents/src/core/streamTelemetryLogger.ts`) stamps
`firstTokenMs`/`lastTokenMs` from the post-provider `IContent` chunks yielded to the
agents layer. Classic OpenAI reasoning streams buffer raw reasoning deltas and
tool-call argument fragments and only yield a visible chunk much later (often a single
terminal combined chunk). The agents-layer token-usage turn record therefore reports
`ttft_ms` and `generation_ms` measured from visible emission, not from generation.

Issue #3473 (merged as PR #3494) fixed the equivalent problem for provider/session
telemetry by adding an optional `onRawTokenDelta()` hook on `AttemptLifecycleObserver`.
Providers resolve it once per request via `resolveRawTokenDeltaNotifier(metadata)` and
call it at each raw token-bearing delta. The only observer installed on that channel is
the `AttemptRecorder` created inside `LoggingProviderWrapper`, which overwrites
`metadata[ATTEMPT_LIFECYCLE_KEY]`. The signal never reaches the agents layer.

## Intended timing source (the decision this issue asks for)

Agents-layer turn records measure the **raw generation window** when the provider
reports raw token deltas, and fall back to visible-chunk stamping when it does not.
`StreamTimingTracker` stays the single agents-layer measurement point — it is fed a
better input rather than being shadowed by a parallel tracker or by re-deriving the
provider's numbers. Precedence exactly mirrors
`AttemptRecorder.recordTokenBearingChunk`/`recordTimingOnly`: once a raw delta has
stamped an attempt, later visible chunks update volume (`chunkCount`) but must not move
first/last token timestamps, because deferred visible emissions trail the final raw
delta.

## Acceptance criteria

**AC-1 — Raw deltas drive agents-layer timing.**
When the provider emits raw token deltas for an attempt, the `StreamTimingMeasurement`
attached to the turn record derives `firstTokenMs` from the first raw delta and
`lastTokenMs` from the last raw delta, both relative to the same stream-start origin
used today. `ttft_ms` and `generation_ms` in the token-usage record follow.

**AC-2 — Raw stamps are authoritative over visible chunks.**
After the first raw delta, visible token-bearing chunks still increment `chunkCount`
but never overwrite `firstTokenMs`/`lastTokenMs`. Same rule as the provider recorder,
so agents-layer and provider/session telemetry cannot disagree about the window.

**AC-3 — Unchanged fallback.**
With no raw-delta signal (providers that never call the hook), timing is stamped from
visible token-bearing chunks exactly as before this change. `providerRequestMs` remains
the full stream-lifecycle elapsed time and `chunkCount` remains the visible chunk count
in every case.

**AC-4 — Visible stream and retry/load-balancing semantics preserved.**
The raw signal travels only on the internal metadata channel. The consumer-visible
chunk sequence (order, content, count) is identical with and without a raw-delta
source. Each agents-layer attempt measures into a fresh tracker, and `attachStreamTiming`
still writes all four keys so a retry fully replaces the previous attempt's timing.
The failed-attempt path (stream error, empty stream) still attaches partial timing.

### Boundary cases

| Case | Expected |
| --- | --- |
| Reasoning-only stream (raw reasoning deltas, single terminal visible chunk) | ttft from first raw reasoning delta |
| Tool-call-only stream (raw argument fragments, tool_call yielded at end) | ttft from first raw fragment; window ends at last fragment |
| Buffered text (raw content deltas held, flushed late) | ttft from first raw delta, not from the flush |
| Ordinary text (raw delta per visible chunk) | unchanged numbers |
| No raw-delta source | visible-chunk stamping (AC-3) |
| Raw deltas but zero visible chunks (EmptyStreamError path) | raw timing still attached to the abandoned-attempt record |
| Malformed sink value in metadata (present, not a function) | ignored; degrade to visible-chunk stamping, no throw |

## Design

Add one internal metadata channel so the same raw signal fans out to both consumers
instead of creating a second measurement:

1. `packages/providers/src/logging/attemptLifecycle.ts`
   - New key `RAW_TOKEN_DELTA_SINK_KEY = '__rawTokenDeltaSink'` carrying an optional
     caller-supplied `() => void`.
   - `resolveRawTokenDeltaNotifier(metadata)` returns a notifier that invokes the
     lifecycle observer's `onRawTokenDelta` (when present) **and** the caller sink
     (when present and a function), returning `undefined` when neither exists.
     Guarded like `isOptionalFunctionHook`: a present non-function sink is ignored.
   - No provider call sites change — `OpenAIProvider` already resolves the notifier
     once per request, and `LoggingProviderWrapper` spreads caller metadata, so the
     sink survives the recorder installation.
   - Export the key from `packages/providers/src/index.ts` next to
     `LOGICAL_REQUEST_ID_KEY`.

2. `packages/agents/src/core/streamTelemetryLogger.ts`
   - `StreamTimingTracker` gains `recordRawTokenDelta()` (stamps first/last, marks raw
     timing authoritative) and `recordChunk()` keeps counting chunks but skips timing
     once raw-stamped.
   - The tracker's `startMs` origin is unchanged (stream-lifecycle start).

3. `packages/agents/src/core/StreamProcessor.ts`
   - `_sendProviderRequest` creates the tracker before `provider.generateChatCompletion`
     and threads `RAW_TOKEN_DELTA_SINK_KEY` into request metadata bound to it, then
     passes the tracker into `_convertIContentStream` instead of constructing one there.
   - The tracker's clock still starts at the provider-call boundary so
     `provider_request_ms` keeps excluding send-seam estimation (#3257). If construction
     order cannot preserve that origin, the tracker starts its clock explicitly at
     generator-body start and the sink is a stable indirection to it.

## Test plan (behavioral, written first)

New: `packages/agents/src/core/StreamProcessor.rawTiming.test.ts`
Drives `StreamProcessor` with a fake provider that reads
`metadata[RAW_TOKEN_DELTA_SINK_KEY]`, fires raw deltas on a controlled clock, then
yields visible chunks later. Captures the record written through `TokenUsageLogger`.

- reasoning-only: raw deltas at t0..t1, single terminal visible chunk at t2 →
  `ttft_ms` ≈ t0, `generation_ms` ≈ t1 - t0 (not t2 - t2).
- tool-call-only: raw argument fragments then one terminal `tool_call` chunk → same shape.
- buffered text: raw deltas then a late flush → window from raw deltas.
- ordinary text: raw delta immediately before each visible chunk → window matches
  visible timing (no regression).
- no sink consumed by the provider → visible-chunk timing preserved (AC-3).
- visible chunk sequence asserted identical across the raw/no-raw variants (AC-4).
- error path: raw deltas then a thrown stream error → partial timing still attached.

New/extended provider-side unit coverage in
`packages/providers/src/__tests__/attemptLifecycle.rawDeltaGuard.test.ts`:
sink-only metadata, observer-plus-sink fan-out, malformed sink ignored, neither present
→ `undefined`.

Extended `packages/agents/src/core/streamTelemetryLogger` coverage for the tracker's
precedence rule (raw stamp wins, chunkCount still advances).

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`,
plus the `stepfun-37` startup smoke.

## Out of scope

Provider-side timing formulas, session `/stats` aggregation, non-OpenAI providers
adopting the raw-delta hook, and any change to retry, load-balancing, or compression
behavior.

## Review outcomes

Verification on the candidate head: lint, typecheck, format and build all exit 0; the
`stepfun-37` startup smoke passes; the suite reports 9298 passed / 1 failed, where the
single failure is `packages/cli/src/utils/sandbox-entrypoint.test.ts` snapshotting the
real home config directory while a concurrent sibling checkout wrote
`~/.llxprt/code-rs-sessions/`. That test passes in isolation and is unrelated to this
change.

### Triaged findings

- **Reject** (OCR, low): reuse `isOptionalFunctionHook` for the sink guard instead of
  the new `isRawTokenDeltaSink`. `isOptionalFunctionHook` returns `boolean`, not a type
  predicate, so the suggested form needs an unchecked cast. The type-predicate guard is
  the safer shape.
- **Defer** (medium): the agents-layer tests drive the sink from a fake provider rather
  than composing `LoggingProviderWrapper` with a real classic OpenAI stream fixture. The
  review separately traced that production path end to end and found no point where the
  sink is dropped, through `prepareAtSendSeam`, `optionsNormalizer`,
  `LoggingProviderWrapper`, `BaseProviderNormalization`, `RetryOrchestrator` and the
  load-balancer options builder.

### Open scope question: inner-attempt raw window

`RetryOrchestrator.runRetryRequest` derives `attemptOptions` from the same
`requestOptions.metadata` on every loop iteration, so every provider-internal retry and
load-balancer failover attempt shares one sink. The lifecycle observer receives fresh
`onAttemptStart`/`onAttemptEnd` boundaries and `AttemptRecorder` keeps a separate window
per attempt; the agents bridge does not.

Consequence: when an inner attempt emits raw reasoning or tool fragments, yields no
visible chunk and then fails, its first raw delta stamps `ttft_ms` while the successful
retry ends the window, so `generation_ms` absorbs the failed attempt and its backoff.
Before this change a raw-only failed attempt contributed nothing to agents timing, so
this is a narrow new gap rather than inherited behavior, and it cuts against the
"consistent with provider/session telemetry" criterion.

Closing it requires attempt identity on the sink, which changes the metadata contract
(for example the sink becomes a factory resolved once per provider invocation, returning
a per-attempt stamper that resets the tracker's raw window) plus a `beginRawAttempt()`
on the tracker and behavioral tests through `RetryOrchestrator` and load-balancer
failover. That is new public contract surface beyond this plan, so it is held for an
explicit scope decision rather than implemented here.
