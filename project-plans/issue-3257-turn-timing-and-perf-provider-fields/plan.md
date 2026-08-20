# Issue #3257 — Token-usage turn timing + perf provider fields

Branch: `issue3257`. Issue: token-usage logs record tokens without duration, so
tok/s cannot be computed; perf operation records log zeros for provider/token
fields on the claudecode path.

## Root-cause analysis (verified in source)

### Part 1 — turn records have no timing

`token-usage/<sessionId>.jsonl` turn records carry every token field and no
duration. `TokenUsageTurnContext` (tokenUsageRecords.ts) has no timing fields.
`ProviderPerformanceTracker` computes generation tok/s in-session
(`lastTokenMs - ttft > 0` window, output tokens only, no total-duration
fallback) and persists nothing. The measurement needed for per-turn timing
already exists client-side at the agents-layer stream seam
(`StreamProcessor._convertIContentStream`): the prompt-send `startTime`, the
chunk iteration, and completion-time `logStreamTelemetry` →
`recordActualTokenUsage` on the same promptId the turn record uses.

### Part 2 — perf operation records log zeros

Two independent defects, both verified:

- **Join mismatch.** `AttemptRecorder.logicalRequestId` is the
  `LoggingProviderWrapper`-minted id (`prompt_<ts>_<rand>`), while the CLI
  operation registry keys ops by `deriveOperationId(turn.promptId)` (e.g.
  `<session>########<n>` or `<session>#agentic-loop#<uuid>` roots with
  `#continuation#N` suffixes stripped). The two namespaces never intersect, so
  `onProviderAttemptStart/End` drop for every provider in the CLI:
  `provider_attempts=0`, `provider_union_ms=0`, and context/output tokens never
  accumulate. The registry's D1 design explicitly expects the recorder's
  logicalRequestId to be the caller-visible prompt id.
- **Raw token zeros on orchestrator-owned attempts.** `onAttemptEnd` fires the
  perf observer with raw `info.inputTokens/outputTokens`. Anthropic (and its
  `claudecode` OAuth alias) uses the central `RetryOrchestrator`
  (`wrapperOwned=false`); its `notifyEnd` passes no token metrics, so the end
  info carries 0s — even though `emitAttemptRecord` resolves real counts from
  `attempt.latestTokenUsage` accumulated by `recordTokenBearingChunk` /
  `recordMetadataUsage` and only uses the raw values when non-zero.

## Acceptance criteria

### Part 1 — per-turn provider timing on turn records

- **AC-1 Schema.** `TokenUsageTurnContext` gains optional `ttftMs`,
  `lastTokenMs` (request-relative ms), `providerRequestMs`, `chunkCount`.
  Serialized turn record schema gains optional `ttft_ms`, `generation_ms`,
  `provider_request_ms`, `chunk_count`. All optional; schema version stays 1
  (established optional-field pattern).
- **AC-2 Serialization rules.** `ttft_ms` emitted only when measured (non-null
  finite number). `generation_ms = lastTokenMs - ttftMs`, emitted ONLY when
  strictly positive — no fallback to total duration (Finding #7 semantics).
  `provider_request_ms`, `chunk_count` emitted when present. Never zero-filled.
- **AC-3 Measurement.** Timed inside `_convertIContentStream` from one
  monotonic `performance.now()` reference captured when generator execution
  begins (i.e. at first pull — the provider call boundary), so
  `provider_request_ms` covers the provider stream lifecycle alone and does NOT
  include send-seam estimation (`prepareAtSendSeam` runs before the provider
  call). Token-bearing detection mirrors the providers'
  `hasTokenBearingOutput` semantics on the raw IContent blocks: non-empty
  `text`, non-empty `thinking.thought`, non-empty `code`, or `tool_call` with
  non-empty `name` and `parameters` present. Durations exclude user think
  time, approval waits, tool execution, and inter-turn idle by construction.
- **AC-4 Attachment.** Timing attached via
  `attachTurnContext(promptId, {...})` immediately before
  `recordActualTokenUsage` on the stream success path, so it lands on the same
  turn record as the token counts. All four keys attached every time (null
  where unmeasured) so a retry attempt fully replaces the previous attempt's
  timing instead of merging with it.
- **AC-5 Tolerant reader.** Legacy records (no timing fields) keep parsing;
  `parseTokenUsageLogRecord` round-trips the new fields.

### Part 2 — perf provider/token fields

- **AC-6 Logical request id threading.** Agents `_buildStreamChatOptions`
  sets `metadata['__logicalRequestId'] = promptId` (key constant exported from
  providers). `LoggingProviderWrapper` uses it as the recorder's
  `logicalRequestId` (and per-call prompt id) when present, minting its own
  otherwise. Metadata survives options normalization (verified:
  `normalizeChatCompletionOptions` spreads options.metadata with top
  precedence) and `prepareAtSendSeam` (spreads options). No other promptId
  consumer parses the `prompt_` prefix; ids remain opaque unique strings.
- **AC-7 Resolved tokens to the perf observer.** `AttemptRecorder.onAttemptEnd`
  resolves input/output token counts once (info value when non-zero, else the
  counts resolved from accumulated usage/text — the same precedence
  `emitAttemptRecord` uses) and passes the resolved values to
  `perfObserver.onProviderAttemptEnd`.
- **AC-8 Claudecode shape.** Wrapper around a RetryOrchestrator-owned fake
  provider + perf observer installed via the core seam: attempt start/end
  notifications carry the threaded logical request id and non-zero
  input/output tokens when usage metadata is present, so registry attribution
  (provider_attempts, provider_union_ms, context_tokens, output_tokens)
  works on that path.

### Out of scope (explicitly)

- Persisting `ProviderPerformanceTracker` session aggregates anywhere new.
- Timing fields on abandoned/error attempt records (schema stays optional;
  success path is the minimum viable per the issue).
- Perf record schema changes; perf CLI/UI changes.
- Changing `RetryOrchestrator.notifyEnd` to carry metrics (AC-7 fixes the
  observable defect without touching the orchestrator).
- Exporting `streamChunkUtils` from the providers package surface.

## Implementation slices

1. `packages/agents/src/core/tokenUsageRecords.ts` — context + schema fields.
2. `packages/agents/src/core/TokenUsageLogger.ts` — `_serializeContextFields`
   timing emission with the strictly-positive `generation_ms` rule.
3. `packages/agents/src/core/streamTelemetryLogger.ts` — timing type + attach
   before `recordActualTokenUsage`.
4. `packages/agents/src/core/StreamProcessor.ts` — measure timing in
   `_convertIContentStream`; thread promptId into `_buildStreamChatOptions`;
   set `__logicalRequestId` metadata.
5. `packages/providers/src/logging/attemptLifecycle.ts` —
   `LOGICAL_REQUEST_ID_KEY` + `extractLogicalRequestId`.
6. `packages/providers/src/index.ts` — export the key constant.
7. `packages/providers/src/LoggingProviderWrapper.ts` — prefer metadata id.
8. `packages/providers/src/logging/attemptRecorder.ts` — resolve tokens once,
   feed the perf observer resolved values.

## Tests (bun, behavioral; follow .llxprt/skills/typescript-test-writing)

- Logger: timing fields serialize; `generation_ms` omitted unless strictly
  positive; retry overwrite replaces prior attempt timing; absent timing →
  absent fields. Real `TokenUsageLogger` + temp file; parse with
  `parseTokenUsageLogRecord`.
- Stream path: real chatSession/stream harness (extend
  `TokenUsageLogger.integration.test.ts` pattern) with a fake provider
  generator that sleeps between token-bearing chunks → emitted record has
  `ttft_ms`, `generation_ms > 0`, `provider_request_ms`, `chunk_count`; a
  usage-only (no token-bearing output) stream → ttft/generation omitted,
  provider_request_ms/chunk_count present.
- Providers: wrapper uses `__logicalRequestId` when set and mints otherwise
  (observable through the recorder's perf-observer notifications or metrics
  telemetry prompt id — real wrapper + fake wrapped provider); recorder
  resolves tokens for orchestrator-shaped end info (0 info tokens + usage
  accumulated from chunks) → observer end info carries resolved counts;
  claudecode-shape end-to-end: wrapper(RetryOrchestrator(fake provider)) +
  fake observer via the core seam, op keyed by the same logical id.
- Test-audit scanner: no new findings on touched files.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, smoke: `bun scripts/start.ts --profile-load stepfun-37
"write me a haiku and nothing else"`. Then ocr review, PR, CI/CodeRabbit.
