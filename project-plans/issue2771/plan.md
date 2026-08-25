# Issue 2771 Delivery Plan: Retry Codex Responses request after WebSocket connection limit

Issue: <https://github.com/vybestack/llxprt-code/issues/2771>
Branch: `issue2771`

## Behavior to deliver

When the Codex Responses WebSocket server reports the sixty-minute connection
lifecycle limit, the transport must treat it as a connection lifecycle event
rather than an ordinary terminal error: close and invalidate the expired socket,
open a fresh one, and retry the same request once. The retry is bounded,
never replays after real output has reached the consumer, and never masks an abort.
Unrelated pre-event failures keep the existing sticky HTTP fallback semantics.

## Acceptance criteria

| ID  | Given                                                                                                               | When                                                                          | Then                                                                                                                                                          | Behavioral evidence                                                                                                   |
| --- | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| B1  | The Codex WebSocket server emits a top-level `error` frame with `code` exactly `websocket_connection_limit_reached`     | Before any actual output is yielded and the abort signal is not fired          | The transport closes and invalidates the expired socket, opens a fresh socket, and retries the identical request once, completing without a terminal error     | Transport test opens two sockets, counts two `response.create` sends, drains text + terminal metadata, no rejection     |
| B2  | The same lifecycle-limit signal arrives again on the single retry                                                       | Before any output is yielded                                                            | The request fails with a terminal `StreamInterruptionError`; no further reconnect and no loop                                                                  | Transport test opens exactly two sockets and drain rejects with the provider error                                             |
| B3  | An ordinary top-level error (any other `code`) arrives before output                                                     | The current attempt is active                                                              | No reconnect happens; the error propagates to the fallback orchestrator unchanged (existing A5 sticky HTTP fallback preserved)                                          | Existing "surfaces a top-level error" test stays green; executor A5 test stays green; no new reconnect                        |
| B4  | Real output (an `IContent`) was already yielded before the lifecycle-limit error                                       | The error is observed                                                             | No reconnect and no replay; the request fails as today                                                                                                           | Transport test emits a delta then the lifecycle-limit error; asserts single socket, terminal rejection               |
| B5  | The request is aborted while reconnecting or queued during reconnect                                               | The abort signal fires                                                                  | The request rejects `AbortError`, the expired socket is closed, and a later request can open a fresh socket                                                  | Abort-during-reconnect test rejects `AbortError`, first socket closed by client, subsequent drain opens a new socket |
| B6  | A successful reconnect completes without a terminal error                                                            | The fallback orchestrator is in use                                                          | No `onFallback` fires and the provider is not marked sticky for that turn                                                                                  | Executor-level test completes over WebSocket via real transport; sticky callback never invoked                        |
| B7  | A non-lifecycle pre-event failure occurs                                                                                 | The fallback orchestrator is in use                                                          | Existing one-shot fallback + consecutive-failure stickiness behavior is unchanged                                                                                | Existing A5 executor test stays green unchanged                                                               |
| B8  | The lifecycle behavior is documented                                                                                     | Provider/transport docs are maintained                                                    | A short lifecycle note records detection, one-shot retry, bounding, abort, and no-replay rules                                                                        | Docs file carries the note; `lint:doc-links` and `format:check` pass                                            |

All criteria are implemented only inside `CodexResponsesWebSocketTransport`. No
change to `parseResponsesStream`, the executor, or
`OpenAIResponsesProviderCore`.

## Design

### Detection

A named constant `WEBSOCKET_CONNECTION_LIMIT_CODE =
'websocket_connection_limit_reached'` and a small predicate
`isWebSocketConnectionLimitError(error)` in the transport module. It is true only
when the thrown error carries `details.providerError.code` exactly equal to the
constant (the shared parser already attaches the top-level error payload, including
`code`, at `details.providerError` for `case 'error'`). No message
substrings, no other codes.

### Retry

`streamResponse()` wraps acquisition/send/iterate for the current request in a
loop capped at two attempts. A shared per-request state object tracks
`completed`, `retryUsed`, and `contentYielded` (set only when an `IContent`
message is yielded to the consumer). Each attempt delegates to a private
`attemptResponse()` generator; its catch consults the module-level
`decideLifecycleRetry()` policy — aborts and post-output errors surface
unchanged, a second lifecycle-limit rejection fails with a terminal wrapped
`StreamInterruptionError`, otherwise the expired socket is invalidated via the
existing `invalidate` and `'retry'` is returned so the loop reacquires a fresh
connection under the same request turn and resends the identical payload. The
outer `finally` invalidation and turn release stay as-is. The helper split also
keeps the method within the repo's nesting and function-size lint budgets.

## Scope ledger

| Entry                                       | Classification | Status   | Notes                                                     |
| ------------------------------------------- | ------------- | -------- | --------------------------------------------------------- |
| B1-B5 transport retry behavior              | In scope      | Done     | `openAIResponsesWebSocketTransport.retry.test.ts` (new suite), 5/5 green |
| B6 no sticky fallback after successful reconnect | In scope   | Done     | New executor test in `openAIResponsesExecutor.websocket.test.ts` (`@issue:2771` describe), green |
| B7 non-lifecycle failure keeps A5 semantics | In scope      | Done     | Existing A5 executor test unchanged and green; no new test needed |
| B8 lifecycle documentation                  | In scope      | Done     | Transport module doc comment (detection, one-shot retry, bounding, abort, no-replay, no sticky fallback) |
| `WEBSOCKET_CONNECTION_LIMIT_CODE` constant   | In scope      | Done     | Named-code convention, exact match                           |
| Periodic proactive socket rotation               | Non-goal      | Excluded | No 60-minute timer                                      |
| General retry after partial output               | Non-goal      | Excluded | No replay after real output (B4)                        |
| `previous_response_id` incremental optimization | Non-goal      | Excluded | Untouched                                              |
| HTTP/SSE retry changes                       | Non-goal      | Excluded | `streamOverHttp` untouched                    |
| Parser, executor, provider-core changes          | Non-goal      | Excluded | Retry stays inside the transport                        |
| Reviewer suggestions                        | Out of scope   | Reject/Defer | No scope expansion                                |

## Expected paths

`packages/providers/src/openai-responses/openAIResponsesWebSocketTransport.ts`,
its test, the executor-level WebSocket test, one docs file, and this plan. Under
the 25-file / 1,500-net-lines budget.

## Non-goals (repeated from issue)

No periodic rotation, no general partial-output retry, no
`previous_response_id` optimization, no HTTP/SSE retry changes.

## Verification

- RED: new transport tests fail without the implementation; GREEN after.
- Providers workspace suite: 580/580 isolated test files pass (includes the new
  retry suite and the modified executor test). In-process `bun test <dir>` runs
  of the whole directory cross-contaminate via Bun's process-wide mocks; the
  per-file runner (`npm test --workspace @vybestack/llxprt-code-providers`) is
  the source of truth. A HEAD stash baseline confirmed the directory-run
  failures are pre-existing and identical without this change.
- Root `typecheck` exit 0; root `build` exit 0; scoped ESLint clean on all
  five touched files; Prettier check clean.
- Smoke `stepfun-37`: CLI startup, profile load, and auth all work; the run
  fails with `API Error: 400 you have no active step plan subscription` — an
  account-level rejection from the stepfun provider, unrelated to this diff
  (HTTP transport, not the WebSocket path changed here).
- Open Code Review: round 1 found two items, both fixed in scope — (1) B5's
  recovery half now reuses the ORIGINAL transport after a mid-reconnect abort
  (locks in turn-lock release and active-socket bookkeeping), and (2) the
  terminal second-rejection error now preserves the original
  `details.providerError` and `cause` (B2 asserts the surviving payload).
  Round 2 found one low item, fixed — `SocketHarness.appendScript` owns a
  mutable private copy instead of casting a `ReadonlyArray`. Both local rounds
  used; every finding triaged In-scope-Fix, none Reject/Defer.
- PR, CI watched to green, CodeRabbit triaged. No self-merge.
