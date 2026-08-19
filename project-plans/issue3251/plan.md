# Plan: Compress Context and Retry on HTTP 413 (Issue #3251)

Plan ID: PLAN-20260819-ISSUE3251
Generated: 2026-08-19
Issue: #3251
Status: In progress

## Problem statement

When a provider rejects a request with HTTP 413 (`request_too_large`,
"Request exceeds the maximum size"), the agent loop breaks instead of
recovering. The 413 recovery path in
`packages/agents/src/core/MessageStreamTerminalHandler.ts`
(`handle413Error`) retries by sending a NEW synthetic message ("The previous
tool calls produced a response that was too large (HTTP 413)…"). That retry:

1. never compresses the conversation history, so when the 413 was caused by
   oversized context (the Anthropic `request_too_large` case in the issue),
   the retry payload is at least as large as the failed one, and
2. drops the user's original pending request in favor of the synthetic text.

The retried send then hits 413 again, the `isPayloadRecoveryRetry` guard ends
the iteration, and the loop breaks with no recovery. The synthetic message is
also misleading when no tool response caused the rejection.

Evidence from the issue:

- Error: `API Error: 413 {"error":{"type":"request_too_large","message":"Request exceeds the maximum size"}} (Status: 413)` then "the loop broke".
- CodeRabbit's independent analysis (issue comment) reached the same
  conclusions and recommends: identify context-size 413s, run
  `ChatSession.performCompression()` before the retry, escalate to
  finalized context-window enforcement when compression is insufficient,
  retry once with the original pending request, keep the bounded-retry
  guard, and preserve the existing tool-payload recovery for requests that
  actually carry oversized tool/media payloads.

## Preflight findings

1. `handleErrorEvent` routes a retryable 413 (status from the Error event
   payload) to `handle413Error` only when
   `config.getContinueOnFailedApiCall()` is true and
   `canRetryFailedStream(state)` holds (no content/thinking/tool-call emitted
   yet in this attempt).
2. `handle413Error` (MessageStreamTerminalHandler.ts) currently:
   - ends iteration on `ctx.isPayloadRecoveryRetry` (bounded guard — correct,
     keep);
   - otherwise extracts tool names from the request, builds the synthetic
     tool-focused message, and calls
     `deps.sendMessageStream([message], signal, prompt_id, boundedTurns-1,
     false, true)`.
3. `MessageStreamDeps.getChat()` exposes the live `ChatSession`, which has:
   - `performCompression(prompt_id, options?)` → `PerformCompressionResult`
     (`COMPRESSED | SKIPPED_EMPTY | SKIPPED_COOLDOWN | NOOP | FAILED`);
   - `enforceContextWindow(pendingTokens, promptId)` → hard-limit enforcement
     (density optimization, compression with `bypassCooldown: true`,
     truncation escalation); throws only when limits cannot be satisfied;
   - `estimatePendingTokens(contents: IContent[])` → token estimate for a
     pending request.
4. `PerformCompressionResult` is re-exported from `./turn.js`; the terminal
   handler already imports `AgentEventType` from there.
5. `describeRejectedPayload(request)` (`toolContentRejection.ts`) normalizes
   any `AgentMessageInput` and reports tool names and media descriptors; the
   sibling tool-content-400 path already uses it to distinguish tool-payload
   rejections.
6. The client-level preflight overflow path (issues #2402/#2755) was removed
   in favor of provider-side finalized enforcement; the only 413 recovery
   seam in the agents loop is `handle413Error`.
7. Existing tests in
   `packages/agents/src/core/client.sendMessageStream-errors.test.ts` lock
   in the current synthetic-message retry (tool-response 413), the repeated
   413 bound, the no-retry-after-content/tool-call guards, and the
   `continueOnFailedApiCall=false` suppression.
8. `ChatSession.performCompression` with plain options respects the failure
   cooldown (`SKIPPED_COOLDOWN`); `enforceContextWindow` internally retries
   compression with `bypassCooldown: true` plus truncation fallbacks.

## Proposed accepted behavior

### REQ-3251-1: Context-size 413 classification

A retryable 413 whose pending request carries no tool-response or media
evidence (`describeRejectedPayload(initialRequest)` yields no tool names and
no media descriptors) is classified as a context-size 413. Existing retry
gates are unchanged: `getContinueOnFailedApiCall()` must be true,
`canRetryFailedStream(state)` must hold, and `ctx.isPayloadRecoveryRetry`
must be false.

### REQ-3251-2: Compress before retry (context-size 413)

For a context-size 413 the handler first runs
`getChat().performCompression(prompt_id, { trigger: 'auto' })`. If the result
is not `COMPRESSED`, or the call throws, it escalates to
`getChat().enforceContextWindow(pendingTokens, prompt_id)` with
`pendingTokens` estimated from the original pending request via
`estimatePendingTokens`. Enforcement failure (throws) means recovery is
unrecoverable locally (see REQ-3251-4).

### REQ-3251-3: Retry the original request exactly once

After REQ-3251-2, the handler retries the ORIGINAL pending request (not a
synthetic message) through the existing
`deps.sendMessageStream(initialRequest, signal, prompt_id, boundedTurns - 1,
false, true)` path. The `isPayloadRecoveryRetry=true` flag keeps the
existing bounded-retry guard: a second 413 ends the iteration instead of
looping.

### REQ-3251-4: Graceful termination when enforcement is unrecoverable

If `enforceContextWindow` throws, the iteration ends gracefully: deferred
events are yielded, the AfterAgent hook fires, the stream does not crash,
and no retry is issued.

### REQ-3251-5: Tool-payload 413 behavior preserved

A 413 whose pending request carries tool-response blocks or media blocks
keeps the existing synthetic tool-name message retry, byte-for-byte the same
message text and call shape as today, and does not invoke compression or
enforcement.

### REQ-3251-6: Existing suppression guards unchanged

`getContinueOnFailedApiCall() === false`, a 413 after content was emitted,
and a 413 after a tool call all still suppress any retry, compression, or
enforcement.

## Out of scope

- Changing the `continueOnFailedApiCall` gate semantics or defaults.
- Compression subsystem changes (cooldown policy, strategies, enforcement
  internals) — the 413 path only calls the existing public seams.
- Provider-side 413 mapping or new error detection (status 413 already
  arrives on the Error event; no message parsing is added).
- UI changes for compression progress (compression subsystem already emits
  its own events).
- The tool-content-400 path (`handleToolContentRejection400`).

## Test plan (behavioral, bun:test)

Extend `packages/agents/src/core/client.sendMessageStream-errors.test.ts`
(this file already owns 413 behavior; sibling files stay untouched):

1. REQ-3251-1/2/3 — Anthropic-style 413 (message `request_too_large`,
   status 413), request without tool/media blocks:
   `performCompression` is called once with `{ trigger: 'auto' }` and the
   prompt id; the retried `turn.run` receives the ORIGINAL request; the
   retried content flows to the consumer.
2. REQ-3251-2 — compression returns non-`COMPRESSED` (parameterized over
   `SKIPPED_EMPTY`, `SKIPPED_COOLDOWN`, `NOOP`, `FAILED`, and a rejected
   promise): `enforceContextWindow` is called once, then the original
   request is retried once.
3. REQ-3251-4 — `enforceContextWindow` rejects: exactly one `turn.run`, no
   retry, the stream completes without throwing, and the original 413 Error
   event remains surfaced.
4. REQ-3251-3 — repeated 413 (compression succeeds both times, provider
   still rejects): exactly two `turn.run` calls, exactly one compression
   call (the guarded retry does not compress again), stream ends.
5. REQ-3251-5 — 413 with tool_response blocks (existing test) plus a new
   media-only variant: synthetic message retry unchanged;
   `performCompression`/`enforceContextWindow` are NOT called.
6. REQ-3251-6 — `continueOnFailedApiCall=false` (existing test, extended
   with mocks): no retry, `performCompression` NOT called; 413 after
   content (existing) and 413 after a tool call (existing): no compression.

Mock notes: the tests inject `client['chat']` partials; the context-size
paths must include `performCompression`, `enforceContextWindow`, and
`estimatePendingTokens` mocks, mirroring the existing overflow-compression
test file's style.

## Implementation steps

1. RED: add the failing tests above to
   `client.sendMessageStream-errors.test.ts`.
2. GREEN: modify `handle413Error` in
   `packages/agents/src/core/MessageStreamTerminalHandler.ts`:
   - classify with `describeRejectedPayload(initialRequest)` (tool names +
     media descriptors);
   - tool/media evidence → existing synthetic retry (unchanged);
   - otherwise run compression → escalation → retry original request once
     with `isPayloadRecoveryRetry=true`;
   - wrap the compression call so a throw escalates to enforcement; an
     enforcement throw ends the iteration per REQ-3251-4 (log a warning);
   - import `PerformCompressionResult` from `./turn.js` and
     `iContentFromAgentMessageInput` from
     `@vybestack/llxprt-code-core/llm-types/index.js`.
3. Keep the file within lint/complexity limits; no new files beyond the
   plan; no comment narration.

## Verification cycle

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, then the smoke:
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.

## Review plan

deepthinker compliance review (max 2 rounds), then detached `ocr review`
(max 2 rounds), then PR with `Fixes #3251`, watch CI and CodeRabbit.
