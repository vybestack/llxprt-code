# Issue #3034 — Codex Responses WebSocket closed before response.completed

## Symptom

A session using the Codex Responses WebSocket transport terminated the agentic
loop with:

    ✕ [API Error: Codex Responses WebSocket closed before response.completed]

The message has no `Provider retries exhausted after N transport attempts:`
prefix, which means it was classified as a TERMINAL (post-output) error by
`RetryOrchestrator` and therefore never retried. `AgenticLoop` treats
`AgentEventType.Error` as a terminal stream outcome, so the loop stopped
("loopbreak").

## Root causes (in `packages/providers/src/openai-responses/openAIResponsesWebSocketTransport.ts`)

1. **Terminal-state mismatch with the parser.** `TERMINAL_EVENT_TYPES` omits
   `response.done`, and `completed` is only set for `response.completed`.
   `parseResponsesStream` treats `response.completed`, `response.done` and
   `response.incomplete` alike as completion-shaped terminals
   (`packages/providers/src/openai/parseResponsesStream.ts` dispatch for those
   three event types). A legitimate `response.incomplete` (or `response.done`)
   followed by a server close therefore surfaces as a generic transport
   interruption, and because the parser already yielded terminal metadata
   `IContent`, the failure is classified post-output and is never retried.

2. **Last-failure-wins.** `RequestFrameSource.fail()` overwrites any previously
   recorded failure while `completed` is false, so a later socket close can
   replace an `AbortError` or a specific socket error with the generic
   "closed before response.completed" message.

3. **Known failures do not stop buffered output.** `next()`/`drain()` deliver
   queued frames before checking `failure`, so frames buffered before a close
   can still be parsed and yielded downstream. That converts a recoverable
   pre-output interruption into an unrecoverable post-output one.

4. **Wrong recovery boundary.** `streamOverWebSocketOrFallback` refuses the HTTP
   fallback as soon as ANY protocol frame was parsed (`onResponseEvent`), even
   though no `IContent` has crossed to the consumer. A `response.created`
   followed by a close is safely recoverable but is not recovered.

5. **Caller callback clobbered.** The same function overwrites
   `streamOptions.onResponseEvent` with its own tracker, discarding any caller
   instrumentation.

6. **Handshake socket ownership.** Handshake `onError` settles the promise
   without closing the socket, so an erroring socket can be orphaned;
   `fail()` closes the socket before settling, letting a synchronous close
   dispatch win over the intended timeout/abort error; the abort listener is
   registered without a post-registration `aborted` recheck.

7. **No close diagnostics.** `TransportSocket.onClose` discards the WebSocket
   close code/reason/`wasClean`, so this class of report cannot be triaged.

## Design

Keep the fix transport-local. The only safe recovery boundary without a
cross-package "discard partial output" protocol is the point at which an
`IContent` is yielded downstream.

- Model protocol terminal state explicitly:
  - accepted terminal (completion-shaped): `response.completed`,
    `response.done`, `response.incomplete`;
  - terminal protocol failure: `response.failed`, top-level `error` — these
    stay queued so the parser produces its specific error.
  - The first terminal frame wins: a later close/error must not replace it.
- First failure wins: `AbortError` and socket errors are never replaced by a
  later close.
- A recorded failure is delivered before any still-queued non-terminal frame,
  and is re-checked immediately before every downstream `yield`, so buffered
  content cannot cross the output boundary after the failure is known.
- `streamOverWebSocketOrFallback` decides on ACTUAL yielded `IContent`:
  - `AbortError` → always rethrow;
  - any `IContent` already yielded → rethrow unchanged (no replay, ever);
  - otherwise → one-shot sticky HTTP fallback exactly as today.
  The caller's `onResponseEvent` is passed through untouched.
- Close diagnostics (`code`, `reason`, `wasClean`) flow through the
  `TransportSocket` abstraction into the stream-interruption error details and
  debug logging. The public message stays stable.
- Handshake hardening: settle before closing; `onError` closes the socket;
  recheck `aborted` after registering the abort listener.

### Explicitly NOT in scope

- Replay after any `IContent` has been yielded (conflicts with the anti-mixing
  rule in `RetryOrchestrator` and with issue #2771's stated non-goals).
- A stream reset/discard protocol across core/agents/CLI.
- Treating an interrupted partial response as a success.
- Nested WebSocket retry budgets, idle-age socket eviction, heartbeats or an
  established-stream idle timeout (issues #2771 / #2772).
- The HTTP/SSE mid-stream retry inconsistency and the HTTP abrupt-EOF
  acceptance (separate follow-up issue).

## Behavioral tests (RED first)

In `packages/providers/src/openai-responses/openAIResponsesWebSocketTransport.test.ts`,
driving the real transport, the real parser and the existing fake-socket
harness (no assertions on mock call choreography):

1. `response.incomplete` (with usage/status/id), optionally followed by a
   server close, completes the stream, preserves earlier text, emits terminal
   metadata and does not throw.
2. `response.done` behaves the same way.
3. A control frame (`response.created`) followed by a close falls back to HTTP
   and yields the fallback content instead of throwing.
4. A non-terminal frame buffered together with a close is discarded: the
   fallback content is what the consumer sees, with no WebSocket text mixed in.
5. A socket error followed by a close rejects with the socket-error message,
   not the close message.
6. An abort followed by a close rejects with `AbortError`.
7. After a real `IContent` has been delivered, a close still throws and the
   fallback is NOT used and the request is NOT re-sent (anti-replay invariant).
8. `response.failed` / top-level `error` followed by a close still surface the
   parser's specific provider error.
9. A handshake error closes the socket.
10. The caller's `onResponseEvent` is still invoked through
    `streamOverWebSocketOrFallback`.
11. Close diagnostics are attached to the interruption error details.
12. Existing invariants stay green: request serialization, queued-request
    abort, connection identity/reuse, sticky HTTP fallback.

## Follow-ups to file

- HTTP/SSE `fetchStreamWithRetries` retries after partial output and
  concatenates attempts into one provider iterator.
- `parseResponsesStream` accepts an abrupt HTTP EOF with no terminal event as a
  successful (truncated) response.
