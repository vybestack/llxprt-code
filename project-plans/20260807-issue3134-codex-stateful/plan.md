# Issue #3134 — Codex statefulness: stop resending full history

## Direction

1. **The point is to not send all of history.** That is what statefulness is for.
2. **Statefulness must be available for Codex and ON BY DEFAULT.**

The working hypothesis was that `previous_response_id` is an API-level parameter
and therefore orthogonal to the transport, so it should work on Codex over HTTP as
well as WebSocket. **Live testing against the real backend disproved that**, and the
implementation follows the evidence.

### Verified backend contract (chatgpt.com/backend-api/codex, 2026-08-08)

| Request | Result |
|---|---|
| `store: true` | **400** `{"detail":"Store must be set to false"}` |
| `previous_response_id` over HTTP | rejected — nothing is stored server-side |
| `store: false` + `previous_response_id` over **WebSocket** | **accepted**; turn sends only the new items |

So Codex continuation state is held by the live WebSocket connection, not by durable
storage. Statefulness on Codex is therefore transport-bound — enforced by the
backend, not chosen by us. `store` stays `false` for Codex always.

Measured on a real session: turn 1 sent 1 item, turns 2 and 3 sent **1 and 3 items**
respectively instead of the whole conversation.

## Accepted behavior

### B1 — Codex is no longer force-disabled
`computeStatefulConversation` / `applyStatefulConversation`
(`packages/providers/src/openai-responses/openAIResponsesStateful.ts`) currently
refuse statefulness whenever `isCodex` is true. That blanket refusal is removed.

### B2 — Statefulness defaults ON for Codex
For non-Codex the existing opt-in via the `responses-stateful` ephemeral /
model-behavior key is unchanged. For Codex, statefulness is enabled unless the user
explicitly opts out.

### B3 — Explicit user opt-out still wins
`store === false` supplied through request overrides disables statefulness and
strips `previous_response_id`, for Codex exactly as for non-Codex.

### B4 — History is trimmed to the delta
When a parent is found (latest `ai` entry with `metadata.responsesStored === true`
and a non-empty `metadata.id`), the request carries only the content *after* that
entry, plus `previous_response_id = <parent id>`. The parent turn and everything
before it are not resent.

### B5 — No parent means full history and no parent id
If no usable parent exists, or the trimmed remainder is empty, the request carries
the full history and no `previous_response_id`. Never "full history *and*
`previous_response_id`" — that would duplicate context.

### B6 — Responses must be marked stored for the next turn to chain
`responsesStored` must be true on the Codex path so `parseResponsesStream` stamps
`metadata.responsesStored` / `metadata.id` on the completion `IContent`. Without
this the parent lookup in B4 can never succeed and the feature is inert.

### B7 — Transport demotion and reconnect must not strip context
Sticky WebSocket -> HTTP fallback and WebSocket reconnect must not leave a request
that was trimmed against state the new transport/connection cannot resolve. If a
trimmed request cannot be honoured, the full history must be sent.

### B8 — Non-Codex behavior is unchanged
Every existing non-Codex assertion in the stateful suites keeps passing untouched.

## Known risk to resolve during implementation

`previous_response_id` continuation state may be scoped to a single WebSocket
connection: `openai/codex` clears its `last_request` / `last_response_rx` whenever
`websocket_connection()` decides `needs_new`, and wipes the whole `WebsocketSession`
in `try_switch_fallback_transport()`. Our parent id is derived from conversation
history metadata, which survives reconnects, so a stale parent could be sent to a
fresh socket. B7 exists to cover this; the implementation must decide and test the
reset semantics rather than assume the id stays valid.

## Test-first plan (behavioral, per dev-docs/RULES.md — no mock theater)

Rewrite, do not delete, the existing regression suite
`__tests__/OpenAIResponsesProvider.codex.stateless.test.ts`, which currently asserts
the behavior being replaced.

| # | Behavior | Where |
|---|---|---|
| T1 | Codex request with a stored parent sends `previous_response_id` and omits the parent turn and everything before it | rewritten codex stateless suite |
| T2 | Codex request with no stored parent sends full history and no `previous_response_id` | rewritten codex stateless suite |
| T3 | Codex statefulness is active with no `responses-stateful` ephemeral set (default ON) | rewritten codex stateless suite |
| T4 | Explicit `store=false` override disables statefulness and strips `previous_response_id` on Codex | rewritten codex stateless suite |
| T5 | A completed Codex response stamps `metadata.responsesStored` + `metadata.id` so the next turn can chain | executor/provider suite |
| T6 | Sticky WebSocket->HTTP fallback does not send a trimmed request the HTTP path cannot resolve | `OpenAIResponsesProvider.websocketFallback.test.ts` |
| T7 | WebSocket reconnect does not reuse a parent id from a dead connection | `openAIResponsesExecutor.websocket.test.ts` |
| T8 | Non-Codex stateful and stateless behavior unchanged | existing `__tests__/OpenAIResponsesProvider.stateful.test.ts` |

## Out of scope

- Removing the synthetic `AGENTS.md` injection (issue #3131, separate PR). `main`
  will be merged in before this PR is finalized to pick it up.
- Any change to non-Codex OpenAI Responses behavior.
- Prompt-cache-key derivation (already matches upstream).

## Guardrails

- No new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No lint severity downgrades, no complexity/size threshold increases.
- Tests are Bun + `bun:test` only.
