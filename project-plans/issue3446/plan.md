# Issue #3446 — Codex WebSocket lifecycle retry must not replay a connection-scoped parent

## Problem restated

`openAIResponsesStateful.ts` documents that a Codex `previous_response_id`
resolves only on the WebSocket connection that minted it. The #2771
lifecycle retry in `openAIResponsesWebSocketTransport.ts` (the `for (;;)`
loop in `streamResponse`) replays the SAME request object on a brand-new
connection. When that request is stateful, the replayed `previous_response_id`
is dead on arrival on the fresh socket.

The compound effect: the resulting parent rejection is absorbed by the broad
pre-output HTTP fallback in `streamOverWebSocketOrFallback`, so the
executor's `markStatefulParentRejected()` never observes it. The dead id is
never retired, every later turn rediscovers it, fails WebSocket, and falls
back to full-history HTTP; after three such failures `webSocketStickToHttp`
disables WebSocket for the provider instance.

Trigger: a stateful Codex socket hits its lifecycle limit
(`websocket_connection_limit_reached`), closes between turns, or a resumed
session loads markers from an earlier connection.

## Acceptance criteria

### AC1 — Transport never replays a connection-scoped parent (new verdict)

When the #2771 retry decision fires for a request carrying
`previous_response_id`, `streamResponse` must NOT open a second connection
and must NOT re-send the request. It fails the turn with a distinguishable
`StreamInterruptionError` verdict (exported predicate
`isStatefulConnectionRenewalError`; `details` carries the retired parent id;
`cause` is the original lifecycle-limit error), after invalidating the dead
socket. Stateless requests (no `previous_response_id`) keep the existing
single replay exactly (#2771 tests B1–B5 semantics unchanged).

### AC2 — Streaming layer renews statefully over WebSocket, not HTTP

The WebSocket branch of `streamResponses` (openAIResponsesStreaming.ts)
handles the AC1 verdict before the generic HTTP fallback can absorb it:

- call `deps.markStatefulParentRejected(retiredParentId)` (when provided),
- rebuild the turn via the existing `rebuildStateless` seam (full history,
  no `previous_response_id`),
- stream the rebuilt request over the SAME WebSocket transport (which opens
  the fresh connection),
- finish the rebuilt context's media lifecycle (success or failure),
- no HTTP fetch occurs, `onWebSocketFallback` is NOT invoked, and
  `onWebSocketSuccess` fires when the renewed stream completes.

If the verdict cannot be handled (no parent id on the request, or no
`rebuildStateless` seam), it propagates unchanged to existing error paths.

### AC3 — Chain re-establishes; no sticky-HTTP degradation

After AC2 recovery, the recovery response is stamped stored (statefulness
stays enabled), and the NEXT turn chains from the id minted on the fresh
connection (`previous_response_id` = new id, trimmed input), still on
WebSocket. A mid-chain renewal does not increment the consecutive-fallback
counter and cannot trip `webSocketStickToHttp`.

### AC4 — Parent-not-found over WebSocket reaches the executor's recovery

A pre-output WebSocket error that the existing
`isPreviousResponseNotFoundError` (openAIResponsesStatefulRecovery.ts)
classifies is RETHROWN by `streamOverWebSocketOrFallback` instead of being
absorbed into the HTTP fallback (no `fallbackStream()` invocation, no
`onFallback()` call). The executor's existing #3134 recovery then observes
it: dead id retired, one retry over WebSocket with full history, next turn
chains from the recovery's response id. AbortError-first and
post-content-no-replay behavior unchanged.

### AC5 — Invariants preserved (non-goals)

- No change to stateless lifecycle-retry semantics (one retry, terminal wrap
  on a second limit, abort handling).
- No session-wide statefulness switch; recovery stays per-id (#3134 design).
- No `store: true` on Codex; no change to request building,
  `computeStatefulConversation`, or the provider's sticky-fallback policy.
- Existing suites green (B1–B5 retry tests, #3134 stateful recovery tests,
  #2041/#3034 sticky tests).

## Boundary cases

- Lifecycle limit arriving AFTER content yielded: unchanged (no retry, no
  renewal; the turn already yielded).
- Abort during renewal: AbortError still wins everywhere (transport rethrow
  and wrapper rethrow unchanged).
- Second lifecycle limit after the stateless rebuild: the rebuilt request is
  stateless, so the ordinary bounded #2771 retry applies.
- Dead parent + LIVE socket (resumed `--continue` session): AC4 path, not
  AC1 (no lifecycle event); recovery reuses the live socket over WS.
- Renewal verdict when `rebuildStateless` is unavailable: propagate (same
  optional-dependency semantics as the executor's other deps).

## Design

### 1. Transport (`openAIResponsesWebSocketTransport.ts`)

- Extend `LifecycleAttemptState` with the lifecycle error (threaded from
  `decideLifecycleRetry`'s retry outcome) so the verdict can carry it as
  `cause`.
- Add `createStatefulConnectionRenewalError(parentId, cause)` +
  `isStatefulConnectionRenewalError(error)` (mirror the existing
  `isWebSocketConnectionLimitError` shape: `details.statefulConnectionRenewal
  === true`, `details.retiredParentId`).
- In `streamResponse`'s loop, after `attemptResponse` returns `'retry'` and
  the dead socket is dropped: if `request.previous_response_id !==
  undefined`, throw the renewal verdict; else loop to reconnect as today.
- In `streamOverWebSocketOrFallback`'s catch, rethrow pre-output errors for
  which `isPreviousResponseNotFoundError` is true (before `onFallback`),
  with the same comment style as the AbortError branch.

### 2. Streaming layer (`openAIResponsesStreaming.ts`)

- Wrap the initial WS attempt: on the renewal verdict with a resolvable
  parent + `rebuildStateless`, retire the id, rebuild, and stream the
  rebuilt request through `streamOverWebSocketOrFallback` again (fresh
  connection happens inside the transport), finishing the rebuilt media
  lifecycle. The initial attempt's HTTP fallback closure stays
  `streamOverHttpWithoutStatefulness` (stateful semantics for the original
  context); the renewed attempt's closure is plain `streamOverHttp` for the
  rebuilt (already stateless) context.

### 3. No executor/provider changes

The executor already exposes `markStatefulParentRejected`, `rebuildStateless`,
`onWebSocketFallback`, `onWebSocketSuccess` through `StreamResponsesDeps`.

## Tests (TDD; bun:test, colocated)

- T1 (new `openAIResponsesWebSocketTransport.statefulConnectionScope.test.ts`):
  stateful request + lifecycle-limit frame on socket 1 → rejects with the
  renewal verdict (predicate true, retiredParentId carried), exactly ONE
  socket opened, closed by client. Includes the negative: stateless request
  still reconnects and succeeds (existing retry tests already cover; one
  contrast case here ties the branch to the parent id).
- T2 (same file): wrapper rethrows a pre-output previous-response-not-found
  error; fallback stream NOT invoked; `onFallback` NOT called.
- T3 (`openAIResponsesExecutor.websocket.test.ts`, new `@issue:3446` block
  using the existing harness): lifecycle limit on socket 1 with a stateful
  parent → recovery streams over socket 2: fetch NOT called,
  `markStatefulParentRejected(deadId)` observed, `onWebSocketFallback` NOT
  called, socket-2 envelope has NO `previous_response_id` and carries FULL
  history; turn completes with content and stored-response id.
- T4 (same block): the turn AFTER T3 sends `previous_response_id` = the id
  minted on socket 2 with trimmed input, and stays on WebSocket (no fetch).
- T5 (same block): dead parent on a LIVE socket (resumed-session shape) →
  parent-not-found frame → executor's #3134 recovery re-serves over the SAME
  WebSocket (fetch NOT called, second envelope on socket 1: no dead parent,
  full history), dead id marked rejected; next turn chains from the recovery
  response id.

## Verification

Full cycle per the issue workflow: `npm run test`, `npm run lint`,
`npm run typecheck`, `npm run format`, `npm run build`, then the startup
smoke test. Review: deepthinker compliance review (max 2 rounds). OCR is
skipped for this effort per standing instruction (disabled until
re-enabled).

## Related

- #2771 (lifecycle retry), #2772 (merge counterpart), #3134 (per-id parent
  rejection recovery), #2041/#3034 (sticky fallback policy).
