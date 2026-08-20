# Plan: Stop OTel INT/Floating-Point Warnings in Non-Interactive Output (Issue #3259)

Plan ID: PLAN-20260820-ISSUE3259
Generated: 2026-08-20
Issue: #3259
Status: Implemented; compliance review GO; OCR clean (2 rounds)

## Problem statement

Every API request whose duration has a fractional-millisecond part prints
this OpenTelemetry diagnostic to the console:

```
INT value type cannot accept a floating-point value for llxprt_code.api.request.latency, ignoring the fractional digits.
```

In non-interactive mode (`llxprt -p "..."`) the warning interleaves with
the response output, so piped or parsed stdout gets junk lines. A single
one-shot prompt produced two of them (one per recorded API request).

Root cause chain (verified on the issue branch):

1. `packages/telemetry/src/telemetry/metrics.ts:67-82` declares both
   latency histograms (`llxprt_code.tool.call.latency`,
   `llxprt_code.api.request.latency`) with `valueType: ValueType.INT`.
2. Recorded durations are `performance.now()` deltas
   (`packages/providers/src/LoggingProviderWrapper.ts`,
   `packages/providers/src/logging/attemptRecorder.ts`,
   `packages/telemetry/src/telemetry/events/tool-events.ts:71`), which are
   fractional milliseconds, e.g. `823.5471`.
3. `@opentelemetry/sdk-metrics` `SyncInstrument._record()` calls
   `diag.warn(...)` when an INT instrument receives a non-integer, then
   truncates with `Math.trunc()` and records anyway.
4. `packages/telemetry/src/telemetry/sdk.ts:51` wires
   `diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.INFO)`, so the
   warning lands on the console.

## Preflight findings

1. These are the only two histograms in the codebase
   (`createHistogram` appears only in `metrics.ts` and test mocks).
2. All counters (`tool.call.count`, `api.request.count`, `token.usage`,
   `file.operation.count`, `session.count`) record integer values only
   (`add(1, ...)`, integer token counts); they keep `ValueType.INT` and
   are out of scope.
3. `@opentelemetry/sdk-metrics` 2.8.0 is a direct dependency of
   `packages/telemetry` and ships `InMemoryMetricExporter` plus
   `PeriodicExportingMetricReader`, so a real-SDK behavioral test can
   assert exported histogram values without mock theater.
4. `metrics.ts` obtains its meter via `metrics.getMeter(SERVICE_NAME)`
   from `@opentelemetry/api`, so registering a real
   `MeterProvider` as the global provider makes `initializeMetrics` wire
   the real SDK instruments; `resetMetricsState()` exists for cleanup.
5. Consumers of the OTel metric export path are the file/console metric
   exporters only. Session `/stats` and `uiTelemetry` aggregate from log
   event attributes (`duration_ms`), not from OTel metric export, so
   changing the histogram value type to DOUBLE has no downstream
   integer assumptions to break.
6. `docs/telemetry.md` describes the metric as
   "`llxprt_code.api.request.latency` (histogram, ms)" with no INT/DOUBLE
   mention; no doc change needed.
7. Existing mocked tests (`packages/telemetry/src/telemetry/metrics.test.ts`,
   `packages/core/src/telemetry/metrics.test.ts`) mock
   `@opentelemetry/api` with `ValueType: { INT: 1 }`; the histogram
   creation mock ignores options, so changing INT to DOUBLE does not
   break them.
8. `packages/core/src/telemetry/metrics.ts` is a pure re-export of the
   telemetry package; the fix lands once in
   `packages/telemetry/src/telemetry/metrics.ts`.

## Proposed accepted behavior

### REQ-3259-1: Latency histograms accept fractional milliseconds

**Full text:** The `llxprt_code.api.request.latency` and
`llxprt_code.tool.call.latency` histograms are declared with
`ValueType.DOUBLE`. Recording a fractional-millisecond duration stores
the exact value (no truncation) and emits no OpenTelemetry diagnostic.

- GIVEN a real OTel SDK meter provider with an in-memory metric reader
  and a captured diag logger
- WHEN `recordApiResponseMetrics` is called with `durationMs = 823.5471`
- THEN the exported `llxprt_code.api.request.latency` histogram has
  count 1 and sum exactly `823.5471`
- AND no captured diag message contains "INT value type cannot accept a
  floating-point value"

### REQ-3259-2: Tool-call latency keeps fractional precision too

**Full text:** Same contract for tool calls.

- GIVEN the same real-SDK setup
- WHEN `recordToolCallMetrics` is called with `durationMs = 17.25`
- THEN the exported `llxprt_code.tool.call.latency` histogram has
  count 1 and sum exactly `17.25`
- AND no captured diag message contains the INT/floating-point warning

### REQ-3259-3: Count histograms remain INT where values are counts

**Full text:** Counters stay `ValueType.INT`. No counter receives
fractional values today, so no warning path exists for them; the test
suite does not encode an implementation-detail assertion for counters.

### REQ-3259-4: Behavioral test owns the contract

**Full text:** A new Bun test
(`packages/telemetry/src/telemetry/metrics.valueType.behavior.test.ts`)
drives the REAL SDK (real `MeterProvider`, real instruments, real record
path via `initializeMetrics`/`record*Metrics`, in-memory exporter as the
only infrastructure seam) and asserts the exported values plus absence
of the diag warning. The test fails against the current INT
declarations (RED) and passes after the DOUBLE change (GREEN). It
restores the global meter provider and diag logger on cleanup.

## Implementation tasks

### Files to modify

- `packages/telemetry/src/telemetry/metrics.ts`
  - `toolCallLatencyHistogram` creation: `valueType: ValueType.INT` →
    `ValueType.DOUBLE`
  - `apiRequestLatencyHistogram` creation: `valueType: ValueType.INT` →
    `ValueType.DOUBLE`
  - No other lines change.

### Files to create

- `packages/telemetry/src/telemetry/metrics.valueType.behavior.test.ts`
  - Real-SDK behavioral test for REQ-3259-1/2/4 (Bun test, TypeScript,
    no `@opentelemetry/api` mocking).
  - Copyright header year: 2026.

## Implementation notes

- Do NOT round durations at record sites; the record path keeps its
  current signatures and passthrough values.
- Do NOT touch `sdk.ts` diag wiring (option 3 in the issue is a
  separate, broader consideration; DOUBLE removes this warning at the
  source).
- Test cleanup must restore prior state because Bun runs test files in
  one process per file: `resetMetricsState()`, shutdown the test meter
  provider, restore/disable the global meter provider, and restore the
  diag logger via `diag.disable()` or a saved logger.
- The diag capture logger installs at `DiagLogLevel.WARN` (the SDK emits
  the truncation warning at warn level).
- If `InMemoryMetricExporter` API shape differs in 2.8.0 (e.g.
  `getMetricReader()`/`getMetrics()` naming), adapt to the installed
  version; verify with a quick read of the installed `.d.ts` before
  writing assertions.

## Verification

Full cycle per the issue workflow:

1. `npm run test`
2. `npm run lint`
3. `npm run typecheck`
4. `npm run format`
5. `npm run build`
6. `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`

Plus targeted confirmation that the new behavioral test fails against
the unchanged INT declarations (run it once before the two-line fix as
the RED step).

## Verification and review outcome

- RED proven twice (driver and reviewer, via `git stash push --` of
  metrics.ts): sums truncated to 823 and 17, both tests fail. GREEN
  after the DOUBLE change: 2/2 pass.
- Telemetry workspace via the official isolated runner: 43/43 files.
- Full monorepo cycle: lint 0, typecheck 0 (initial typecheck run
  failed in packages/a2a-server against a stale providers dist because
  it ran before build; re-run after `npm run build` exited 0), format 0
  (no file changes), build 0, smoke test green
  (`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`)
  with zero INT/floating-point warnings in the output.
- `npm run test` exited 1 from exactly two unrelated core files:
  `packages/core/test/utils/ripgrepPathResolver.test.ts` (4 tests) fails
  identically on the clean stashed baseline, and
  `packages/core/src/recording/SessionLockManager.safety.test.ts` is a
  subprocess race test that passes standalone on both baseline and this
  branch and only failed under full-suite concurrency. Neither imports
  the changed code.
- AST test-audit scanner: zero findings on the new test file.
- Compliance review (deepthinker subagent): PASS on all four REQs,
  independently re-ran RED/GREEN, telemetry suite, typecheck, lint.
  Verdict GO.

### Known follow-up (out of scope, LOW)

`tokenUsageCounter.add` accepts any number and providers normalize
usage without forcing integers
(`packages/providers/src/logging/tokenCounts.ts`). A misbehaving
provider returning a fractional token count could still trigger the
same OTel warning for `llxprt_code.token.usage`. No current producer
produces fractional counts, and the plan requires counters to stay
INT, so no change was made here.

### Open code review

- Round 1: one LOW finding. `summarizeHistogram` indexed
  `metric.dataPoints[0]` directly; a metric with zero data points
  would throw a TypeError that masks the assertion failure. Fixed by
  adding an undefined guard.
- That guard tripped `@typescript-eslint/no-unnecessary-condition`
  because `[0]` indexing types as always-defined; switched to
  `dataPoints.at(0)` (typed `T | undefined`, matches existing repo
  usage in `packages/cli/src/utils/sandbox-env.ts` and
  `mcpPromptArgParser.ts`). Lint re-run: exit 0.
- Round 2: zero findings. The `.at(0)` one-token change postdates
  round 2 and was validated by lint, typecheck, the behavior test
  (2/2), and the telemetry workspace suite (43/43); both OCR rounds
  were spent per the workflow cap.
