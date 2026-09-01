# Issue #3473: /stats Output Gen Rate (tok/s) can be far off server reality

Branch: `issue3473` (base `41c6d5dc8`, main up to date with `origin/main`, worktree
clean at branch creation). Issue assigned to acoliver, label Observability,
milestone 0.11.0. This document is the test-first implementation plan. No
production code or tests have been written yet.

## What the issue reports

`/stats` for a 73-request session (72 successes, 1 error, all through the
classic `openai` provider against a vLLM-style endpoint serving
`Qwen/Qwen3.8-Flash-Next-FP8`, a reasoning model) showed:

- Output Gen Rate: 512.34 tok/s session weighted (last request: 43.77)
- TTFT: 6928ms last, 34614ms average
- Total: 3,368,079 input tokens, 93,582 output tokens, 36.6s average latency,
  44m34s total API time

The server reported roughly 60-70 tok/s decode. The reporter observes the
client number is "wronger if its really slow and about right if its really
fast".

## Arithmetic check of the reported session

These are derived from the numbers in the issue itself; they constrain any
candidate root cause:

- Effective input rate 1351.44 = ΣP/ΣTTFT, so ΣTTFT = 3,368,079 / 1351.44
  ≈ 2492s, i.e. 34.6s average over 72 requests. Matches the displayed average
  TTFT.
- Σ(O-1) ≈ 93,582 − 72 = 93,510. At the displayed 512.34 tok/s the implied
  generation-window total is ΣG = 93,510 / 512.34 ≈ 182.5s, about 2.53s per
  request, while average request duration is 36.6s and average TTFT is 34.6s.
- At the server's 60-70 tok/s, decoding 93,582 tokens takes about 1440s. The
  client measured only 182.5s of generation window: the window is
  under-measured by roughly 8x, which is exactly the factor between 512.34 and
  65.

So the defect is in the measured generation window, not in the token counts
(those come from provider usage).

## Root-cause analysis (verified in source)

### Part 1: the aggregator admits degenerate windows via a duration fallback

`packages/telemetry/src/telemetry/sessionMetricsAggregator.ts`
`accumulateRateMetrics` (L410-422):

```ts
const gap =
  lastTokenMs !== null && lastTokenMs > positiveTtft
    ? lastTokenMs - positiveTtft
    : durationMs - positiveTtft;
```

When every token-bearing chunk of a request arrives at one instant
(firstTokenMs == lastTokenMs, see Part 2), the first branch is false and the
fallback yields `duration − TTFT`, which is the few milliseconds between the
terminal chunk and attempt finalization. `gap > 0` passes, so the request
contributes `(O−1)/ε`: on the order of 10^5 tok/s per request. A handful of
such requests dominates the weighted sum Σ(O−1)/ΣG.

This contradicts the window rule the rest of the repo already implements:

- `ProviderPerformanceTracker.recordCompletion`
  (packages/providers/src/logging/ProviderPerformanceTracker.ts L121-137):
  "Generation TPS is only valid when `lastTokenMs - timeToFirstToken > 0` ...
  There is NO fallback to total duration." (Finding #7)
- `TokenUsageLogger._generationWindowMs`
  (packages/agents/src/core/TokenUsageLogger.ts L497-510): window used only
  when strictly positive, "never a total-duration fallback".
- `project-plans/issue-3257-turn-timing-and-perf-provider-fields/plan.md` AC-2:
  `generation_ms = lastTokenMs - ttftMs`, emitted ONLY when strictly positive,
  no total-duration fallback.

### Part 2: the classic openai provider yields nothing token-bearing during reasoning decode

Timing stamps exist in exactly one place:
`AttemptRecorder.recordTokenBearingChunk`
(packages/providers/src/logging/attemptRecorder.ts L194-215) stamps
`firstTokenMs ??= now` and `lastTokenMs = now`. It only fires for chunks the
wrapper classifies as token-bearing
(`hasTokenBearingOutput`, packages/providers/src/logging/streamChunkUtils.ts
L43-73: non-empty text, thinking, code, or tool_call blocks in the yielded
IContent).

For the classic openai chat-completions path
(packages/providers/src/openai/OpenAIStreamProcessor.ts):

- `processReasoningDelta` (L243-270) only ACCUMULATES
  `reasoning_content`/`reasoning` deltas into
  `state.accumulatedReasoningContent`; it yields nothing. All reasoning is
  emitted later in one terminal chunk (`emitCombinedTerminalContent`,
  L566-654).
- Tool-call deltas go into the pipeline as fragments
  (`processDeltaToolCalls`, L356-399) and surface only in the terminal chunk
  (`buildPipelineToolCallBlocks` at finalize, L528-564).
- Text for `qwen`-format models is additionally buffered until natural
  breakpoints (`shouldBufferText = detectedFormat === 'qwen'`, L864;
  `handleTextDelta` L272-351; final flush L771-784).

Consequences, both verified against the code paths:

1. TTFT is stamped at the first VISIBLE token (first post-reasoning content
   flush, or the terminal chunk), so it absorbs the entire reasoning decode
   phase. That is why the reported session shows 34.6s average TTFT out of
   36.6s average latency: only ~2s per request was counted as generation.
2. For responses with no text at all (pure reasoning + tool calls, the
   dominant shape in an agentic session; the reported session had 80 tool
   calls across 73 requests), the terminal combined chunk is the ONLY
   token-bearing chunk, so firstTokenMs == lastTokenMs and Part 1's fallback
   turns the request into (O−1)/ε.

This also explains the reporter's asymmetry: "really fast" requests (little
reasoning, streaming text) get honest windows; "really slow" requests (long
reasoning, tool-call-only turns) get degenerate or reasoning-excluded windows.

### Verification of the github-actions comment hypothesis (reject)

The precomputed comment on the issue claims the `-1` in
`sumOutputMinusOne += outputTokens - 1` (L417) is the root cause and removing
it fixes the metric. Checked against source, history, and arithmetic:

- Magnitude: for the reported session the change is 72 tokens out of 93,582
  (0.077%). The displayed rate would move from 512.34 to about 512.83.
- Direction: the complaint is OVERestimation (512 vs 60-70). Removing the -1
  makes the value larger, not smaller.
- Intent: the estimator is documented in the interface comment
  ("Σ(O-1)/ΣG ... only O>=2, G>0", L77) and in the tests since it was
  introduced by the telemetry unification commit abd16eacf (Fixes #2585).
  Within the first-token→last-token window, O−1 tokens are decoded, so (O−1)/G
  is the honest numerator. `ProviderPerformanceTracker` uses full O over the
  same window; the two differ by at most 1/O per request, a sub-0.1%
  cosmetic inconsistency, not this bug.

Classification: Reject. See the findings table.

## Finding classification

Legend (use these classes for every finding, including any new ones discovered
during implementation; add a row to this table with evidence and rationale):

- **Blocker-Fix**: a defect that makes an acceptance criterion fail. Must be
  fixed in this issue.
- **In-scope-Fix**: small, inside the issue's functional scope, worth fixing
  now even though acceptance does not hinge on it.
- **Reject**: not a defect for this issue, or a proposed change that cannot
  fix the reported behavior. No change; record the reasoning.
- **Defer**: real, but outside this issue's scope. Needs its own issue; record
  a one-line follow-up here.

| # | Finding | Evidence | Class | Action |
|---|---------|----------|-------|--------|
| F1 | Aggregator duration fallback admits degenerate near-zero generation windows; single-instant token output yields (O−1)/ε and explodes the weighted rate | sessionMetricsAggregator.ts L410-422; implied ΣG ≈ 182.5s vs ~1440s decode time in the reported session; contradicts Finding #7 rule implemented in ProviderPerformanceTracker L121-137 and TokenUsageLogger L497-510, and issue-3257 plan AC-2 | Blocker-Fix | Window = lastTokenMs − TTFT, strictly positive, no fallback (AC-1) |
| F2 | Classic openai provider emits no token-bearing chunk during reasoning decode or tool-call fragment streaming; TTFT absorbs reasoning decode and tool-call-only responses stamp first == last | OpenAIStreamProcessor.ts L243-270, L356-399, L566-654, L864; attemptRecorder.ts L194-215 is the only timing stamp; reported TTFT avg 34.6s of 36.6s avg latency | Blocker-Fix | Stamp attempt timing at each raw token-bearing delta via the internal `AttemptLifecycleObserver.onRawTokenDelta` callback channel (F8; marker chunks rejected); visible stream unchanged (AC-4..AC-7) |
| F3 | Issue comment hypothesis: remove the `-1` numerator adjustment | 0.077% magnitude, wrong direction (increases the overestimate), documented intentional estimator since abd16eacf | Reject | No change. Optional separate cosmetic issue to unify with ProviderPerformanceTracker's full-O numerator; do not bundle here |
| F4 | Agents-layer `StreamTimingTracker` measures the same post-conversion yielded stream, so token-usage turn records (`ttft_ms`, `generation_ms`) stay dishonest for reasoning models even after F2's fix lands at the providers layer | streamTelemetryLogger.ts L74-97 | Defer | File a follow-up issue referencing this plan once #3473 lands |
| F5 | Other providers (openai-responses, openai-vercel) may buffer reasoning similarly | Not verified in this pass | Defer | Verify separately; no changes in this issue |
| F6 | `packages/cli/src/utils/sandbox-entrypoint.test.ts` snapshots the real `$HOME` config directory and fails when a concurrent sibling LLxprt/llxprt-code-rs session mutates it mid-run (observed: `code-rs-sessions/issue38-*` hashes changed during an unrelated workspace test run) | ws-cli.log failure 2026-09-01: only failing CLI file (1/719), changed paths are another workspace's rs-session artifacts; unrelated to #3473 diff | Defer | Filed #3480 (test-environment fragility on multi-session machines) |
| F7 | Final-review Blocker 1: raw timing markers stamped `lastTokenMs`, but a later deferred visible terminal or buffer-flush chunk still called `recordTokenBearingChunk` and overwrote that timestamp, so raw timing was not authoritative | RED: `tmp/verify3473/remediation/red-run1.log` DT-1 (buffered qwen text) and DT-2 (reasoning + tool calls) failed with windows of 168 ms and 206 ms, i.e. last_token_ms sat at the terminal emission, not the final raw delta | Blocker-Fix | `AttemptRecorder.recordTimingOnly` stamps first/last and sets `rawTimingStamped`; `recordTokenBearingChunk` keeps updating usage, streamedText, chunkCount, and finishReasons but never overwrites first/last once raw timing stamped. GREEN: `green-run2.log` DT-1/DT-2 (0 < window < 80 ms and < 110 ms) plus B1-B5 |
| F8 | Final-review Blocker 2: timing marker chunks traversed RetryOrchestrator and load-balancing layers before LoggingProviderWrapper suppressed them, so they counted as yielded output, could suppress retry and failover, bypassed empty-stream handling, and satisfied first-visible-chunk timeout behavior | RED: `tmp/verify3473/remediation/red-run1.log` R1 (marker-before-error: error propagated, no retry), R3 (marker satisfied first-visible-chunk timeout, stream resolved instead of timing out), L1 (config-less load-balancer composition: immediate throw instead of failover, marker leaked to consumer) | Blocker-Fix | Marker chunks removed entirely. Timing now travels the internal `AttemptLifecycleObserver` channel: optional `onRawTokenDelta` hook resolved from request metadata (`resolveRawTokenDeltaNotifier`), threaded through `DispatchResponseOptions` and `StreamProcessorDeps`, fired at each raw token-bearing delta site. No chunk exists for RetryOrchestrator, empty-stream, timeout, or LB layers to observe, so consumer-visible output and those semantics are structurally unaffected. No public-surface change (index.ts exports unchanged). GREEN: `green-run2.log` R1, R3, L1, L2 |
| F9 | Review sub-claim: a marker-only completing stream bypasses empty-stream handling | Not reproducible: every marker-firing site in a completing classic-openai stream has a guaranteed visible terminal emission. Reasoning deltas (even whitespace-only) end in a terminal thinking block, unterminated tool-call fragments end in a terminal tool_call block, buffered whitespace text ends in a terminal text block. Debug evidence: `tmp/verify3473/remediation/debug-r2.ts`, `debug-r2b.ts`, `debug-r2c.ts` | Reject | Premise invalid; a completing marker-only empty stream cannot exist. Guards added anyway: R2a (zero-chunk stream still triggers the `no content` empty-stream error) and R2b (fragment-only no-finish stream still yields its terminal tool_call chunk) both GREEN in `green-run2.log` |
| F10 | Review sub-claim: load-balancer counts markers as backend output in the production composition | Not reproducible in the production composition: with ProviderManager plus config, the inner LoggingProviderWrapper filtered markers before the load balancer, so the LB never saw one (L2 guard passed both before and after remediation). The config-less composition without the wrapper was affected pre-fix and is covered by F8's fix and the L1 guard | Reject | No additional change beyond F8; L2 guard remains in `rawTimingTransport.retryBoundary.test.ts` as a standing boundary test |
| F11 | OCR (selected run, attemptLifecycle.ts, low/bug): `resolveRawTokenDeltaNotifier` accepted a non-function `onRawTokenDelta`; `.bind` on it would throw a TypeError at resolve time and fail the request instead of degrading to visible-chunk timing | attemptLifecycle.ts `isAttemptLifecycleObserver` only validated onAttemptStart/onAttemptEnd; RED `tmp/verify3473/ocr-remediation/red-run.log`: observer with `onRawTokenDelta: 42` was accepted (got the observer back instead of undefined) | In-scope-Fix | `isAttemptLifecycleObserver` now also requires the optional hook be undefined or a function (`isOptionalFunctionHook`), so a malformed observer is rejected at the guard and `resolveRawTokenDeltaNotifier` can never reach `.bind` on a non-function. Guard tests B8 GREEN in `ocr-remediation/green-run.log` |
| F12 | OCR (selected run, retryBoundary test, medium/maintainability): the boundary test re-implemented the production wiring in a local `wireRawTimingNotifier` instead of importing `resolveRawTokenDeltaNotifier`, and the two had already diverged (typeof check vs undefined check) | Old test lines 97-104 vs attemptLifecycle.ts `resolveRawTokenDeltaNotifier` | In-scope-Fix | Local duplicate deleted; the fake provider now wires `makeDeps(resolveRawTokenDeltaNotifier(options.metadata))` with the production resolver, so the boundary tests track the real wiring contract. GREEN `ocr-remediation/green-boundary-timing.log` |
| F13 | OCR (selected run low + full run medium, R3 timer concern): R3 uses real sleeps (interDelayMs 150 vs streamingTimeoutMs 40) and could flake on a loaded runner if the first reasoning chunk stretches past 40ms | Rejected on the race's direction: the sleeps only start when the consumer first pulls the generator, which happens after the timeout race is armed, so the first visible chunk is always ≥ 1 + 150 ms of setTimeout time away from arming while the timeout rejects at 40 ms; setTimeout never fires early, so load can only push the visible chunk further out, never rescue it, and the assertion direction (rejects /Stream timeout/) is monotone under jitter | Reject | No change; R3 stays as the deterministic guard that raw reasoning deltas do not satisfy the first-visible-chunk timeout |
| F14 | OCR (selected run, OpenAIProvider.ts, medium/bug): the continuation loop fired `onRawTokenDelta` only for sanitized text, so continuation `reasoning_content`/`reasoning` and `tool_calls` deltas (sanitized text is '') never fired and `last_token_ms` froze at the last text delta | RED `tmp/verify3473/ocr-remediation/red-run.log`: CT-2 got 1 (expected 4), CT-3 got 1 (expected 4), CT-4 got 2 (expected 4); CT-1 proved the continuation wiring itself works | In-scope-Fix | Continuation loop now fires the notifier exactly once per token-bearing raw delta: content (sanitized text), reasoning (`parseStreamingReasoningDelta`, covering `reasoning_content` and the `reasoning` fallback), and non-empty `tool_calls`; a delta carrying several payload kinds fires once. Visible output unchanged (text only from content deltas). CT-1..CT-4 GREEN in `ocr-remediation/green-run.log` |
| F15 | OCR (full run, plan.md, high): the plan was internally contradictory; F8 recorded marker chunks as a final-review Blocker replaced by the observer channel, but AC-4 and Slice 2 still described the marker-chunk route as the default seam, so a top-to-bottom implementer would reintroduce a known blocker | Old AC-4 ("Default mechanism: a metadata-only marker chunk ... or an equivalent internal seam") and old Slice 2 bullets vs F8 | In-scope-Fix | This plan revision: AC-4, AC-7, F2's action, Slice 2, the B-table, and the seam paragraph now specify the `AttemptLifecycleObserver.onRawTokenDelta` channel as the sole design and record marker chunks as rejected |
| F16 | OCR (full run, timing test, low): DT-2's windowMs < 110 bound for a ~60 ms nominal raw span has <2x margin and could flake under timer coarsening on loaded runners | Six sleep(10) gaps accumulate overshoot; a terminal-stamped window is ~210 ms (includes the 150 ms gap) | In-scope-Fix | DT-2's upper bound is now the injected terminal gap itself (`TERMINAL_GAP_MS = 150`): any window that includes the gap is ≥ raw span + 150 > 150 and still fails, so the remediation claim (the deferred terminal emission does not append the gap) is proven with a 2.5x jitter margin. DT-1 keeps its <80 bound (>5x margin over its ~15 ms nominal span) and was not weakened |
| F17 | OCR (full run, attemptRecorder.ts, medium; retry-attribution race): `onRawTokenDelta` attributes to `getCurrentAttemptId()` (most recently started attempt), so a late raw delta from a prior aborted stream arriving after the next attempt's `onAttemptStart` would stamp the new attempt and freeze its timing | The race premise is unreachable: the notifier fires synchronously inside the consumer's for-await pull of the in-flight stream; a generator is single-consumer and produces nothing after its loop exits, and every lifecycle owner drives attempts strictly sequentially (RetryOrchestrator fully drains/terminates attempt N before `onAttemptStart` of N+1; LB delegates are invoked once per backend via the `loadBalancerDelegate` metadata bypass; the continuation runs inside the same attempt's stream before any next attempt can start). No interleaved late-delta window exists | Reject | No change; threading an attemptId through the notifier would widen the observer interface for a race that cannot occur in any production composition |
| F18 | OCR (full run, retryBoundary test, high): L1/L2 never exercised the raw-timing transport (no metadata passed, so `resolveRawTokenDeltaNotifier` returned undefined and `onRawTokenDelta` never fired), and L2's "full production wrapper composition" title was inaccurate (config alone does not insert a wrapper between the LB and delegates) | Old L1/L2 called `lb.generateChatCompletion({contents})` with no metadata | In-scope-Fix | L1 now passes an observer through the LB metadata channel and asserts exactly 3 raw-delta callbacks (2 failing-backend reasoning deltas + 1 healthy-backend content delta; empty finish deltas fire nothing) on top of failover and no-leak assertions, proving the callback genuinely executes through the boundary. L2 retitled to the composition it actually builds (ProviderManager config composition) with the callback-execution assertion living in L1. GREEN `ocr-remediation/green-boundary-timing.log` |
| F19 | OCR (full run, retryBoundary test, low): `plans[Math.min(calls - 1, plans.length - 1)]` silently replayed the last plan when a provider was called more times than planned, so an over-retry regression could observe the success plan twice and still pass | Old fake-provider plan lookup | In-scope-Fix | The fake provider now throws when `calls > plans.length`, so over-retry fails loudly; every existing boundary test still passes (delegates are called exactly once via the LB bypass, R1's two attempts match its two plans) |
| F20 | OCR (full run, OpenAIProvider.ts, high; bind-argument concern): the continuation `onRawTokenDelta` parameter is "never supplied at its only production call site" because the callback is bound with `requestContinuationAfterToolCalls.bind(this)`, making the continuation firing dead code | Factually wrong: `Function.prototype.bind` with only a thisArg forwards all call-time arguments; `handleToolCallsWithoutText` passes `deps.onRawTokenDelta` as the final argument of `requestContinuation(...)`, so the parameter is supplied. Behaviorally, pre-fix CT-1 fired exactly 3 callbacks through this path (primary fragment + 2 continuation content deltas) in `ocr-remediation/red-run.log`, and L1 counts primary deltas through the same wiring | Reject | No change to the bind site; the real continuation gap was payload coverage (F14), which is fixed |

## Acceptance criteria

### Part A: aggregator window semantics (packages/telemetry)

- **AC-1 Window rule.** `outputGenerationTps` and `lastOutputGenerationTps`
  accumulate only over `window = lastTokenMs − timeToFirstTokenMs` when
  strictly positive. The `durationMs − TTFT` fallback is removed. A request
  without a positive window contributes to neither numerator nor denominator
  and does not update the last-attempt generation TPS state.
- **AC-2 Eligibility otherwise unchanged.** `outputTokens >= 2`, TTFT present
  and > 0, non-error, `hasUsage` true. The Σ(O−1) numerator stays (F3).
- **AC-3 Comments updated.** `SessionMetricsSnapshot.outputGenerationTps`
  (sessionMetricsAggregator.ts L77) and the `SessionTimingMetrics` comment
  (uiTelemetry.ts L64) state the window rule: G = lastTokenMs − TTFT > 0, no
  duration fallback.

### Part B: honest timing stamps at the openai stream seam (packages/providers)

- **AC-4 Honest stamps.** For the classic openai provider streaming path, the
  emitted attempt event's `time_to_first_token_ms` is the request-relative
  time of the FIRST raw token-bearing delta (reasoning delta, content delta,
  or tool-call fragment), and `last_token_ms` is the time of the LAST such
  delta, including continuation-stream deltas after tool-calls-without-text.
  Stamps travel the internal `AttemptLifecycleObserver.onRawTokenDelta`
  callback channel and nothing else: the logging wrapper places the
  `AttemptRecorder` (an observer) in `GenerateChatOptions.metadata` under
  `ATTEMPT_LIFECYCLE_KEY`; the provider resolves the notifier once per
  request with `resolveRawTokenDeltaNotifier` and threads it through
  `DispatchResponseOptions` and `StreamProcessorDeps`; each raw
  token-bearing delta site invokes it; `AttemptRecorder.onRawTokenDelta`
  stamps first/last without touching chunkCount, streamedText, usage, or
  finishReasons. The earlier metadata-only marker-chunk mechanism is
  REJECTED (F8): marker chunks traversed RetryOrchestrator,
  load-balancing, and timeout layers, suppressed retry/failover, and
  leaked to consumers. No new exports from the providers package public
  surface.
- **AC-5 Reasoning + tool-call-only responses** (no content text) produce a
  strictly positive window: first reasoning delta through last tool-call
  fragment. They qualify for the weighted rate instead of producing a
  degenerate window.
- **AC-6 Reasoning-only responses** (no content, no tool calls) also produce a
  strictly positive window: first through last reasoning delta.
- **AC-7 Visible stream unchanged.** The yielded IContent sequence carries
  exactly the same visible blocks in the same order as before: no interim
  thinking/text/tool blocks during reasoning decode, single terminal combined
  chunk. Timing travels the observer callback, never as stream output, so no
  timing artifact can appear in, reorder, or enrich the visible chunk
  sequence, and no timing chunk exists for retry, timeout, empty-stream, or
  load-balancing layers to observe. The recorder's raw-delta stamping path
  does not increment the attempt's `chunkCount` and does not alter
  `streamedText` or usage accumulation.
- **AC-8 Display consequences only, no UI formula changes.** Sessions where
  every request lacks a measurable window show no Output Gen Rate row (row is
  already hidden at 0). TTFT last/avg for reasoning-model streams drop to the
  honest first-token time through the same events; the effective input rate
  (ΣP/ΣTTFT) rises correspondingly. No change to StatsDisplay logic.

## Out of scope (explicit non-goals)

- Removing or renaming the Σ(O−1) numerator or `sumOutputMinusOne` (F3).
- Agents-layer `StreamTimingTracker`, turn-record `ttft_ms`/`generation_ms`,
  and token-usage log surfaces (F4).
- openai-responses, openai-vercel, anthropic, gemini, kimi provider paths (F5).
- Streaming/visibility behavior changes: reasoning stays accumulated and
  emitted at the terminal chunk; no live reasoning display.
- UI formula changes, schema changes, new public abstractions or exports, new
  dependencies, renames, or cleanup of unrelated metrics.

## Tests (bun:test, behavioral; follow .llxpert/skills/typescript-test-writing and dev-docs/RULES.md)

Existing tests that encode the duration fallback as intended behavior get
rewritten, not preserved: RULES.md forbids enshring incorrect behavior as
specification. The rewrite keeps each test's original intent (exclude TTFT
from the denominator) by supplying `lastTokenMs` explicitly.

### Part A tests: packages/telemetry (plus one UI boundary test)

| ID | File | Test | RED/GREEN | Proves |
|----|------|------|-----------|--------|
| A1 | `sessionMetricsAggregator.test.ts` (rewrites `computes weighted sum(O-1)/sum(G) for O>=2 and G>0`) | Attempt with TTFT=1000, O=10, no lastTokenMs: expect `outputGenerationTps === 0`. Companion positive case: same attempt plus `lastTokenMs=5000` (window 4000): expect `(9/4000)*1000 = 2.25` | RED | AC-1 (absent lastTokenMs excluded) |
| A2 | `sessionMetricsAggregator.test.ts` (rewrites `accumulates across multiple qualifying requests`) | a1: TTFT=1000, lastToken=3000, duration=3000, O=10; a2: TTFT=1000, lastToken=4000, duration=4000, O=5; expect `13/5000*1000 = 2.6` | RED | AC-1 (weighted sum over real windows) |
| A3 | `sessionMetricsAggregator.test.ts` (new) | Single-chunk shape: TTFT=35995, lastTokenMs=35995, duration=36000, O=1250: expect 0 | RED | AC-1 (degenerate window excluded; today computes ≈ 249,800 tok/s) |
| A4 | `sessionMetricsAggregator.test.ts` (new) | Three degenerate attempts (A3 shape) plus two qualifying (O=100 window 2000ms; O=300 window 6000ms): expect exactly `(99+299)/8000*1000 = 49.75`; degenerate attempts do not perturb the rate | RED | AC-1 + reported-session shape |
| A5 | `sessionMetricsAggregator.test.ts` (new) | Qualifying attempt (window 2000, O=100 → 49.5 tok/s) followed by a degenerate attempt: `lastOutputGenerationTps` stays 49.5 | RED | AC-1 (last-attempt state untouched by degenerate) |
| A6 | `sessionMetricsAggregator.advanced.test.ts` (rewrites `generation gap G = duration - TTFT, not duration`) | Same numbers plus `lastTokenMs=10000` (TTFT=3000, window 7000, O=11): expect `(10/7000)*1000` unchanged | RED | AC-1 (fallback removed, TTFT still excluded) |
| A7 | `canonicalConsumer.behavior.test.ts` (rewrites `output generation TPS tracks last and weighted`; adds one case) | Event with `last_token_ms=5000`, TTFT=1000, O=10, duration=5000: expect 2.25 session and last. New case: same event without `last_token_ms`: expect 0 | RED | AC-1 on the real event → aggregator path |
| A8 | `StatsDisplay.sections.test.tsx` (new, boundary guard) | Metrics with `timing.outputGenerationTps = 0` and `lastOutputGenerationTps = 0`: `Output Gen Rate` absent from the rendered frame | GREEN guard | AC-8 (row hidden when nothing measurable) |

### Part B tests: packages/providers

Harness: real `processStreamingResponse` (openai stream processor) composed
with the real wrapper stream processing
(`processStreamWithRecorderGen`) and a real `AttemptRecorder`, fed a synthetic
raw chunk iterator that sleeps ~5ms between deltas (infrastructure fake at the
raw-stream boundary only; precedent: issue-3257 plan's stream tests and
`OpenAIProvider.e2e.test.ts` Scenario 1). Capture the emitted attempt event
the way `attemptRecorder.perf.behavior.test.ts` does. Feed captured events
into a real `SessionMetricsAggregator` for rate assertions.

| ID | File | Test | RED/GREEN | Proves |
|----|------|------|-----------|--------|
| B1 | `packages/providers/src/openai/__tests__/` (new file, e2e pattern) | 12 reasoning deltas, 3 tool-call fragment deltas (5ms apart), finish + usage (output_tokens=100): captured event has `0 < time_to_first_token_ms < last_token_ms` | RED (today both equal the terminal chunk time) | AC-4, AC-5 |
| B2 | same file | Feed B1's event to a real `SessionMetricsAggregator`: `outputGenerationTps > 0` and `< 10_000` (honest window ≈ 70ms → ≈ 1400 tok/s; degenerate pre-fix ≥ 90_000; excluded state = 0) | RED | AC-5 end to end |
| B3 | same file (characterization guard) | Consume the provider stream directly (no wrapper) for the same input: exactly one blocks-bearing chunk (terminal: thinking + tool_call); no interim thinking/text/tool blocks | GREEN guard (pins the contract before and after) | AC-7 |
| B4 | same file | Reasoning-only stream (reasoning deltas + finish + usage, no content, no tool calls): `0 < ttft < last_token_ms` on the captured event | RED (today equal) | AC-6 |
| B5 | same file (regression guard) | Content-only stream (no reasoning, qwen format): per-delta text chunks still yielded; event `ttft < last_token_ms` | GREEN guard | AC-4 does not regress plain streams |
| B6 | `packages/providers/src/__tests__/rawTimingTransport.retryBoundary.test.ts` (remediation F8/F10; real RetryOrchestrator, real LoadBalancingProvider, real `processStreamingResponse` output) | R1 retry after mid-stream error, R2a/R2b empty-stream boundaries, R3 first-visible-chunk timeout, L1 failover with the observer wired through LB metadata asserting exactly 3 raw-delta callbacks (2 failing-backend reasoning deltas + 1 healthy-backend content delta), L2 ProviderManager-config composition failover | GREEN guards | AC-4/AC-7 transport boundaries; raw callback genuinely executes (L1) |
| B7 | `packages/providers/src/openai/__tests__/OpenAIProvider.continuationTiming.test.ts` (OCR remediation F14) | CT-1 content-only, CT-2 reasoning-only, CT-3 tool-call-only, CT-4 mixed continuation deltas each fire `onRawTokenDelta` exactly once per token-bearing delta; visible output unchanged (text only from content deltas) | RED → GREEN | AC-4 continuation decode span |
| B8 | `packages/providers/src/__tests__/attemptLifecycle.rawDeltaGuard.test.ts` (OCR remediation F11) | Observer with a non-function `onRawTokenDelta` is rejected by the metadata guard and resolves no notifier instead of throwing at bind time; function and absent hooks still accepted | RED → GREEN | Observer contract for the raw-delta hook |
| B9 | `packages/providers/src/openai/__tests__/OpenAIStreamProcessor.timing.test.ts` DT-1/DT-2 (remediation F7) | Deferred terminal emission and buffered-text flush do not overwrite raw-delta `last_token_ms`; DT-2 upper bound is the injected terminal gap (150 ms), which any terminal-stamped window necessarily includes | RED → GREEN | F1/F7 raw-authoritative stamps |

Observer-channel invariants (AC-4/AC-7) are asserted through B3/B5/B6/B7 plus
the recorder-level rule that `AttemptRecorder.onRawTokenDelta` (via
`recordTimingOnly`) never increments `chunkCount` or appends to
`streamedText`.

## RED/GREEN implementation slices

1. **Slice 1 (Part A, telemetry).** Write A1-A7 (RED; run and confirm each
   fails for the fallback reason). Add A8 (should pass; it pins AC-8). Then
   change `accumulateRateMetrics` in
   `packages/telemetry/src/telemetry/sessionMetricsAggregator.ts`: require
   `lastTokenMs !== null && lastTokenMs - ttft > 0`, delete the duration
   fallback, and update the three comment sites (AC-3). Run the telemetry
   tests to GREEN.
2. **Slice 2 (Part B, providers).** Write B3/B5 first (GREEN guards pinning
   the visible-stream contract), then B1/B2/B4 (RED; confirm each fails
   because first == last token time). Then implement the timing seam:
   - Extend `AttemptLifecycleObserver` with the optional
     `onRawTokenDelta()` hook; the logging wrapper already places the
     recorder in `GenerateChatOptions.metadata` under
     `ATTEMPT_LIFECYCLE_KEY`, so `AttemptRecorder` gains an
     `onRawTokenDelta` implementation that stamps timing only.
   - Resolve the notifier once per request from metadata
     (`resolveRawTokenDeltaNotifier` in `attemptLifecycle.ts`), thread it
     through `DispatchResponseOptions` and `StreamProcessorDeps`, and fire
     it at each raw token-bearing delta site in the classic openai path:
     inside `processReasoningDelta` (reasoning block or reasoning-embedded
     tool calls), in `handleTextDelta` (buffered and immediate text), in
     `processDeltaToolCalls` (fragments), and in the continuation loop of
     `requestContinuationAfterToolCalls` (content, reasoning, and
     tool-call deltas of the same attempt, exactly once per delta).
   - `AttemptRecorder.recordTimingOnly` applies `firstTokenMs ??= now`,
     `lastTokenMs = now`, sets `rawTimingStamped`, and never touches
     chunkCount, streamedText, usage, or finishReasons;
     `recordTokenBearingChunk` keeps updating usage/text/chunkCount/finish
     but never overwrites first/last once raw timing stamped (F7).
   - Marker chunks are the rejected first approach (F8) and must not be
     reintroduced: no chunk is emitted for timing, so RetryOrchestrator,
     empty-stream, timeout, and load-balancing semantics are structurally
     unaffected.
   - GREEN B1/B2/B4 with B3/B5 still green.
3. **Slice 3 (verification).** Full cycle below, plus the test-audit scanner
   diff against main for every touched file.

The marker-chunk route was implemented first and then REJECTED during final
review (F8): metadata-only marker chunks traversed RetryOrchestrator and
load-balancing layers, counted as yielded output, suppressed retry and
failover, satisfied the first-visible-chunk timeout, and leaked to consumers
in the config-less composition. The observer-callback channel above is the
final design; it is the only acceptable seam for this issue, and any future
change must keep B1-B9 and the R/L boundary guards green.

## Verification commands

Quick loops during development:

```bash
bun test packages/telemetry/src/telemetry/sessionMetricsAggregator.test.ts \
          packages/telemetry/src/telemetry/sessionMetricsAggregator.advanced.test.ts \
          packages/telemetry/src/telemetry/canonicalConsumer.behavior.test.ts
bun test packages/cli/src/ui/components/StatsDisplay.sections.test.tsx
bun test packages/providers/src/openai/            # Part B harness lives here
npm run test --workspace telemetry
npm run test --workspace providers
```

Full cycle (required before commit, per .llxprt/skills/llxprt-issue-workflow):

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```

Test-audit scanner over touched files (no new MOCK_MIRROR, ALWAYS_TRUE,
SELF_CONFIRMING, or NO_ASSERT findings):

```bash
bun scripts/test-audit/scan.ts tmp/scan-3473-main   # from main
bun scripts/test-audit/scan.ts tmp/scan-3473-branch # from this branch
diff tmp/scan-3473-main/findings.tsv tmp/scan-3473-branch/findings.tsv
```

## Notes for the implementing agent

- Do not touch `.llxprt/` or dev-docs/; this plan stays the only planning
  artifact. Logs and scanner output go under the repo's gitignored `tmp/`
  with unique paths (sibling sessions share /tmp).
- TypeScript strict, ESM, bun:test only; no new .js files; explicit return
  types; no `any`.
- After GREEN: delegate implementation and reviews per the issue workflow
  (typescriptexpert implements, deepthinker reviews, ocr with the zai profile
  at final review, at most two rounds each). Then PR titled with
  `(Fixes #3473)`, body with `fixes #3473`. Do not merge without explicit
  user approval.
