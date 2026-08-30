# Issue #2772 — Codex Responses WebSocket connection metadata and idle timeout

Follow-up to #2041 / PR #2750 / PR #3047. Goal: parity with the open-source
OpenAI Codex client (pinned reference `openai/codex@f21dc4638803f40046c9e294b0349782928f6b36`)
for (a) WebSocket handshake connection metadata and (b) an established-stream
idle timeout.

## Upstream evidence (pinned commit f21dc46)

Handshake headers (`codex-rs/core/src/client.rs` `build_websocket_headers` +
`build_session_headers` in `codex-api/src/requests/headers.rs` + auth in
`model-provider/src/auth.rs` + `codex-login` `default_headers`):

- `session-id` and `thread-id` are **hyphenated only**. History: underscore
  forms were introduced (a9862351, 2026-05-06), both forms sent temporarily
  (bd8fc9ad / #21757, 2026-05-08), then underscore forms were dropped
  (7c7b4861 / #22193, 2026-05-13) because `_` is rejected by some proxies.
- `x-client-request-id` = `thread_id` verbatim (thread-scoped, NOT a fresh
  per-request UUID).
- `originator: codex_cli_rs`, `OpenAI-Beta: responses_websockets=2026-02-06`.
- Auth: `Authorization`, `ChatGPT-Account-ID` (optional `X-OpenAI-Fedramp`).
- Upstream always sends a Codex `User-Agent` via vacant-only default headers.

Idle timeout (`codex-rs/codex-api/src/endpoint/responses_websocket.rs`):

- Default 300000 ms (`stream_idle_timeout_ms` in
  `codex-rs/model-provider-info/src/lib.rs`).
- Applied around the request send ("idle timeout sending websocket request")
  and around every wait for the next frame ("idle timeout waiting for
  websocket"). Expiry yields `ApiError::Stream` → the socket is dropped and
  the ordinary stream-retry path runs.
- No proactive client ping; the idle timeout is the sole stall detector.

## Decisions

1. **Identity mapping.** The provider layer receives exactly one stable
   conversation identity: `invocation.runtimeId` (fallback
   `options.runtime?.runtimeId`), the value already sent today as
   `session_id`. LLxprt has no separate thread branching at the provider
   layer (`AgentRuntimeState.sessionId` is not plumbed to providers;
   per-turn `prompt_id` changes every turn and would defeat socket reuse,
   since `connectionIdentity` hashes the header map). Therefore:
   - `session-id` = resolved runtimeId
   - `thread-id` = resolved runtimeId
   - `x-client-request-id` = resolved runtimeId (mirrors upstream setting it
     equal to the thread id)
   All three are guarded: only set when the resolved value is a non-empty
   string, and dropped together otherwise. The identity value set is
   unchanged, so socket reuse across turns is preserved.
2. **Header forms.** Hyphenated only. The underscore `session_id` the WS
   handshake sends today is replaced (AC #4: no duplicate legacy/current
   forms without evidence both are required; current upstream sends
   hyphenated only). The HTTP/SSE path (`openAIResponsesHttpStream.ts`) and
   the codex image backend keep their existing underscore `session_id` for
   now — changing their wire behavior is outside this issue's scope and is
   noted as a follow-up.
3. **User-Agent.** Preserve current behavior: no synthesized Codex UA. No
   evidence the live service requires one (both LLxprt transports work
   without it); users can set one via custom headers, which already flow
   into the handshake through `getCustomHeaders`.
4. **Idle timeout placement.** A single timer inside `RequestFrameSource`,
   sibling to the existing handshake timeout lifecycle:
   - Armed when the frame source is constructed (immediately before the
     request send), which covers upstream's send-side wrap (undici `send`
     is synchronous, so only the first-frame wait can actually stall) and
     the wait for the first frame.
   - Reset on every valid inbound text frame (the same point that queues
     the frame). Ping/pong never surface as message events in undici, so
     they cannot reset the timer — matching upstream semantics where the
     idle timeout is the sole stall detector. Binary/malformed frames fail
     the stream outright rather than resetting.
   - Cleared on: terminal frame intake, `fail()` (abort/close/error/
     malformed/idle itself), and `detach()` (normal completion, consumer
     cancellation).
   - Expiry: `fail(createStreamInterruptionError('Codex Responses WebSocket
     idle timeout'))` — a non-AbortError retry-transient error. The
     existing `streamResponse` finally-block invalidates the socket, so the
     next request reconnects; `streamOverWebSocketOrFallback` rethrows once
     any `IContent` was yielded (no partial-output replay) and takes the
     one-shot HTTP fallback otherwise, reporting it via `onWebSocketFallback`
     (the provider's existing threshold-based sticky demotion — three
     consecutive pre-output failures — is unchanged) (AC #5–#7).
5. **Configuration.** `STREAM_IDLE_TIMEOUT_MS = 300_000` module constant,
   matching upstream's default; injectable as `streamIdleTimeoutMs` on the
   transport config (same pattern as the injectable `handshakeTimeoutMs`
   from #3047) so tests exercise the path quickly. `<= 0` disables the
   timer. No user-facing setting is added (non-goal: the separately tracked
   configurable WS selection #2756).

## Behavioral tests (RED first)

Transport-level (`openAIResponsesWebSocketTransport.*.test.ts`, real transport
+ `SocketHarness`/`FakeSocket`, real timers with small injected timeouts —
the repo is bun-test based, no fake-timer API):

1. Handshake header passthrough covers the new identity header forms, and a
   changed identity header forces a reconnect (split into
   `openAIResponsesWebSocketTransport.handshakeHeaders.test.ts`; the main
   transport test file sits at the 800-effective-line lint ceiling, so the
   header concern moved to its own file rather than growing it).
2. A silent established stream rejects with `StreamInterruptionError`
   (idle), closes the socket, and the next request opens a fresh socket.
3. Frames arriving within the idle window reset the timer: a stream whose
   total duration exceeds the idle timeout completes successfully.
4. Abort while idle-waiting rejects `AbortError`; waiting past the idle
   window afterwards does not change the settled outcome.
5. After a completed response, waiting past the idle window leaves the
   socket reusable (terminal cleanup).
6. Pre-first-frame idle takes the one-shot HTTP fallback for the request
   (and reports the fallback event to the provider); idle after yielded
   content rethrows without fallback (partial-output safety).

Executor-level (`openAIResponsesExecutor.websocket.test.ts`, end-to-end
through `executeOpenAIResponsesRequest` + `SocketHarness`):

7. Exact handshake header set on the recorded connector headers:
   `Authorization`, `ChatGPT-Account-ID`, `originator`, `session-id`,
   `thread-id`, `x-client-request-id` (all = the invocation runtimeId),
   `OpenAI-Beta`, plus merged custom headers.
8. When no runtime identity resolves, none of the three identity headers
   are sent.

Docs: new `### OpenAI Codex (ChatGPT Plus/Pro)` section with a WebSocket
transport subsection in `docs/providers/quick-reference.md` documenting the
header contract, identity mapping, handshake timeout, and idle-timeout
behavior.

## Non-goals (per issue)

- Sixty-minute `websocket_connection_limit_reached` recovery.
- Configurable regular OpenAI Responses WebSocket selection (#2756).
- Multiplexing / connection pools / realtime audio.
- Changing the HTTP/SSE or image-backend `session_id` header forms.
