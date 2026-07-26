# Issue 2041 Delivery Plan: Codex Responses WebSocket Support

Issue: https://github.com/vybestack/llxprt-code/issues/2041
Branch: `issue2041`
Base: `e83eb8f12`

## Acceptance matrix

| ID  | Given                                                                                                          | When                                                                            | Then                                                                                                                                                                           | Behavioral evidence                                                                                                      |
| --- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| A1  | The OpenAI Responses provider is operating against the Codex ChatGPT backend                                   | A streaming generation starts                                                   | It first opens `ws://` or `wss://` at the existing `/responses` URL and sends the existing request as a JSON `response.create` message                                         | Provider/executor test observes the WebSocket URL, handshake headers, and request payload                                |
| A2  | A Codex WebSocket handshake is attempted                                                                       | Authentication and provider headers are built                                   | The handshake carries the same Authorization, ChatGPT account, originator, session, and configured custom headers as HTTP, plus `OpenAI-Beta: responses_websockets=2026-02-06` | Transport boundary test inspects all handshake headers without exposing secrets in logs                                  |
| A3  | The WebSocket server emits Responses API JSON events                                                           | Text, reasoning, tool-call, usage, liveness, completion, or error events arrive | Existing Responses event parsing produces the same provider-neutral output and errors as SSE streaming                                                                         | Executor behavioral tests run real Responses parsing over WebSocket event frames                                         |
| A4  | One Codex provider instance completes a WebSocket response and the connection remains open                     | A later generation starts with the same endpoint and authentication context     | The existing connection is reused and requests remain serialized until each `response.completed` event                                                                         | Transport test completes two requests over one connection and observes ordered output                                    |
| A5  | The WebSocket endpoint cannot connect or fails before producing response events                                | The Codex request is still pending                                              | The provider falls back once to the existing HTTP Responses path and keeps HTTP as the sticky transport for that provider instance                                             | Executor/provider test observes one failed WebSocket attempt and successful HTTP output, then no later WebSocket attempt |
| A6  | A request is aborted while connecting or streaming over WebSocket                                              | The invocation abort signal fires                                               | The pending generation rejects with `AbortError`, the unusable connection is closed, and a later request may establish a fresh connection                                      | Abort behavioral test verifies rejection, close, and reconnectability                                                    |
| A7  | The Responses provider is not in Codex mode, including OpenAI Responses routing through `OpenAIProvider`       | A streaming generation starts                                                   | Existing HTTP/SSE behavior is unchanged                                                                                                                                        | Regression test observes HTTP fetch and no WebSocket connector use                                                       |
| A8  | The WebSocket receives non-text data, malformed JSON, a top-level error, or closes before `response.completed` | The frame is processed                                                          | The request fails explicitly; it does not silently report a complete response                                                                                                  | Transport/parser tests verify fail-fast errors                                                                           |

## Decisions

Codex mode automatically uses protocol v2 at `/responses` with flat `response.create` and the dated beta header. A provider owns one serialized, identity-keyed reusable connection. Each turn sends full history; incremental IDs, generic endpoint support, and public transport API are excluded. Pre-event failures cause sticky HTTP fallback; partial responses fail without replay.

## Explicit non-goals

- Realtime audio/voice WebSockets or the OpenAI Realtime API.
- WebSocket support for arbitrary OpenAI-compatible Responses endpoints.
- User-facing transport configuration, feature flags, profile schema, or settings UI.
- Incremental turn payloads, `previous_response_id` optimization, prewarming, connection pools, or concurrent multiplexing.
- Other providers/transports, telemetry, parser refactors beyond adaptation, workflow/memory/quality-tool changes, and unrelated cleanup.

## Bounded vertical slices

1. Protocol selection and handshake (A1, A2, A7).
2. Streaming lifecycle, exclusive reuse, and failures (A3, A4, A8).
3. Sticky fallback and cancellation (A5, A6).
4. Verification, review, and delivery.
   - Run scoped tests after each slice, then all required local gates, reviews, scope review, PR CI, and exact-head checks.

## Expected paths

`dev-docs/plans/issue-2041-websocket-support.md`, provider package/lockfiles, `OpenAIResponsesProviderCore.ts`, `openAIResponsesExecutor.ts`, and new transport, HTTP-stream, and two test files. The HTTP extraction was discovered as necessary to preserve the enforced 800-line executor limit. Total expected: 10 files.
Expected maximum: 10 files, below the 25-file review threshold and 40-file hard stop. The hard budgets remain 25 files/1,500 net lines for mandatory scope review and 40 files/2,500 net lines for an approval stop.

## Actual delivery

All 10 expected paths changed. The discovered `openAIResponsesHttpStream.ts` extraction keeps the executor below the enforced 800-line limit without weakening lint. Final measured scope is 10 files and 1,498 net changed lines, including forced-text lockfile changes and untracked files. Behavioral evidence is 17 focused WebSocket tests plus the passing full root test suite.
The Codex handshake requires bearer/account/custom HTTP headers. Node's global WHATWG `WebSocket` does not accept custom handshake headers. The existing OpenAI SDK's Realtime client authenticates with a Realtime-specific subprotocol and is not a Responses WebSocket transport. `undici` 7.28.0 is already standardized elsewhere in this monorepo and exposes a header-capable `WebSocket`, but `packages/providers` does not declare it. Correct package isolation therefore requires adding `undici` as a direct providers dependency and updating lockfiles.

## Scope ledger

| Entry                                                     | Classification        | Status                  | Notes                                                              |
| --------------------------------------------------------- | --------------------- | ----------------------- | ------------------------------------------------------------------ |
| Acceptance A1-A8                                          | In scope              | Implemented + tested    | 17 focused tests plus full root suite pass                         |
| Upstream Codex v2 beta protocol                           | In scope              | Implemented             | `/responses`, flat `response.create`, beta header dated 2026-02-06 |
| `undici` direct providers dependency                      | Planned approval gate | Approved + added        | `undici ^7.28.0`; lockfiles updated                                |
| HTTP/SSE path extraction (`openAIResponsesHttpStream.ts`) | Discovered necessity  | Added                   | Keeps executor under enforced 800-line limit                       |
| Generic endpoint WebSockets                               | Non-goal              | Excluded                | Would require capability/config design                             |
| Incremental `previous_response_id` payloads               | Non-goal              | Excluded                | Conflicts with bounded stateless scope                             |
| Unrelated refactors/findings                              | Out of scope          | Must be Reject or Defer | Reviewer suggestions do not expand scope                           |

## Review finding classification

Every finding will be recorded as exactly one of:

- **Blocker-Fix**: prevents accepted behavior, safety, correctness, required verification, or mergeability.
- **In-scope-Fix**: improves or corrects implementation inside A1-A8 and expected paths/budget.
- **Reject**: factually incorrect or outside the accepted issue behavior.
- **Defer**: valid but requires a separate issue or explicit approval because it expands scope.

Open Code Review is capped at two local and two PR runs. Total code/design review cycles are capped at two; DeepThinker participates in at least one.

## Review, verification, and completion

DeepThinker found no actionable issue. OCR's nested-payload claim is **Reject** because source sends flat `response.create`. Focused tests (17) and root test/lint/typecheck/format/build pass. Smoke reached the provider but external quota returned HTTP 429; tmux is not applicable. Exact-head completion additionally requires green CI, resolved review threads, correct ancestry, no conflicts, and a clean scope ledger.

- Final `git diff --stat` and numstat remain inside the hard scope budget and every changed path is accounted for in this ledger.
- No optional hardening or cleanup continues after these gates are satisfied.
