# Issue #3049 — OpenAI Responses HTTP/SSE: no mid-stream replay, no attempt multiplication, no silent truncation

Follow-up to #3034 / PR #3047 (WebSocket transport).

## Problem (grounded in code)

`packages/providers/src/openai-responses/openAIResponsesHttpStream.ts`

- `fetchStreamWithRetries` wraps `yield* parseSuccessfulResponse(...)` in the
  attempt-level `try`. A body failure that happens **after** messages were
  yielded re-runs `fetchResponse` and yields the second attempt's messages into
  the SAME provider iterator. `StreamProcessor` accumulates one assistant
  message per iterator, so attempt 1's partial text and attempt 2's regenerated
  text are concatenated. `RetryOrchestrator.yieldStreamUnprotected` forbids
  exactly this one layer up (`markErrorAfterStreamOutput`, "cannot retry (would
  produce mixed response)"), and the WebSocket transport does not do it.
- The `retries` ephemeral feeds BOTH the internal loop (`maxStreamingAttempts`,
  executor line ~214) and the orchestrator budget
  (`resolveRetryRequestContext` -> `attachTransportAttemptBudget`). The internal
  loop does not touch the shared budget, so a pre-output failure costs
  N internal fetches per orchestrator attempt: up to `retries x retries`
  requests.

`packages/providers/src/openai/parseResponsesStream.ts`

- The read loop `break`s on `done` and the generator returns normally. No
  terminal response event is required, and `parseSuccessfulResponse` adds no
  completion check, so a connection cut mid-body is indistinguishable from a
  completed response. `packages/agents/src/core/streamValidationHelpers.ts`
  only rejects a missing finish reason when there is also no text, so truncated
  text is silently committed to history. The WebSocket transport already throws
  `Codex Responses WebSocket ended before a terminal response event` via
  `source.didReceiveAcceptedTerminal()`.

## Accepted behavior (acceptance criteria)

**AC1 — no internal replay after output.**
When the HTTP/SSE body fails after at least one `IContent` has been yielded for
the current attempt, `fetchStreamWithRetries` rethrows. It does not issue a
second `fetch` and does not yield any content from a second attempt. The
already-yielded content stays yielded (the consumer/orchestrator decides).

**AC2 — attempts do not multiply.**
When a shared transport attempt budget is attached (the normal path: every
provider is wrapped by `RetryOrchestrator`), the total number of `fetch` calls
for one logical request is bounded by the `retries` budget, not by
`retries x retries`. Internal retries consume from the same
`TransportAttemptBudget` used by the orchestrator, via
`tryConsumeTransportAttempt(normalizedOptions)`. When no budget is attached
(provider used directly, e.g. unit tests), behavior is unchanged: the internal
loop is bounded by `maxStreamingAttempts`.

**AC3 — abrupt EOF is an error, not a success.**
An HTTP/SSE body that reaches EOF without an accepted terminal response event
(`response.completed`, `response.done`, `response.incomplete`) raises a
stream-interruption error (`name === 'StreamInterruptionError'`, retryable
classification) instead of returning normally. `response.failed` and `error`
keep throwing their existing specific errors. A body that DOES carry a terminal
event completes normally, unchanged.

**AC4 — behavioral tests** for AC1, AC2 and AC3 in the existing Responses
executor test style (real executor, real parser, only the `fetch` boundary
faked).

### Boundary cases and explicit non-goals

- Consumer-driven early termination (`break`, `return()`) must not be turned
  into an interruption error — only reader EOF inside the parse loop.
- Abort (`AbortError`) keeps its current precedence: never retried, never
  reclassified.
- `!response.body` (no body at all) keeps returning early. That path never
  enters the parser, and an empty stream is already handled one layer up by
  `throwIfEmptyStreamExhaustsBudget`. Out of scope.
- The WebSocket path's own terminal assertion stays exactly as it is. If the
  accepted-terminal event set is shared, it is shared by extraction, with no
  behavior change on the WS side.
- `streamValidationHelpers.ts` (agents package) is NOT changed.
- `transportAttemptOwnership = 'provider'` is deliberately NOT declared on the
  Responses providers: that flag also flips `isWrapperLifecycleOwner`
  (`packages/providers/src/logging/lifecycleOwnership.ts`), which would change
  attempt-lifecycle logging for every chain without an orchestrator, and it
  would have to be declared on `OpenAIProvider` too (which also routes to this
  executor), changing its Chat Completions path as well. Participating in the
  shared budget achieves AC2 with a strictly narrower blast radius.

## Implementation shape

1. `fetchStreamWithRetries`: track `yieldedForAttempt`; set it immediately
   before the first `yield` of an attempt; in the `catch`, rethrow when it is
   true. Only when nothing was emitted may `handleStreamRetry` run.
2. Same loop: before starting an attempt after the first, require a shared
   budget slot (`tryConsumeTransportAttempt(params.normalizedOptions)`); when
   the budget is exhausted, rethrow the last error instead of refetching.
   `getTransportAttemptBudget` returning `undefined` (no orchestrator) must
   keep today's behavior. The budget object arrives through
   `options.metadata._retryRequestContext` and survives normalization
   (`mergeInvocationMetadata` in `BaseProviderNormalization.ts`).
3. `parseResponsesStream`: add an opt-in option (default off, so the WS caller
   and the parser's own tests are untouched) that makes reader EOF without an
   accepted terminal event throw `createStreamInterruptionError`. The HTTP path
   opts in. Accepted terminal event types are defined once and reused by the
   WebSocket transport instead of being duplicated.
4. Keep `parseResponsesStream.ts` and `openAIResponsesHttpStream.ts` inside the
   `max-lines` (800) and `max-lines-per-function` (80) budgets; extract a small
   helper module if needed. No lint/complexity threshold changes, no
   suppression directives.

## Tests (behavioral, bun:test, added to `scripts/bun-test-manifest-data-providers.ts`)

New file(s) under `packages/providers/src/openai-responses/`:

- **AC1**: fetch returns a body that emits `response.output_text.delta` then
  errors the `ReadableStream`. Assert: the yielded content contains the partial
  text exactly once, the iterator rejects, and `fetch` was called exactly once.
- **AC1 control**: a pre-output failure (fetch rejects with
  `TypeError('fetch failed')`) still retries and succeeds — proving the fix did
  not disable legitimate connection-phase retry.
- **AC2**: provider wrapped so a shared budget with `retries: N` is attached,
  fetch always fails pre-output. Assert the total `fetch` count equals N (not
  N x N).
- **AC3**: body with a text delta and EOF, no terminal event. Assert the
  iterator rejects with `name === 'StreamInterruptionError'` and a message
  naming the missing terminal event.
- **AC3 control**: identical body plus `response.completed` completes normally
  and yields the terminal metadata.

Existing fixtures in the HTTP path that end without a terminal event must be
given a real terminal event (they are simulating a complete response), not
have the check weakened.

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`,
`npm run build`, and
`bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
