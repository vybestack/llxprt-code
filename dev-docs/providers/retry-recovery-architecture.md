# Retry, Recovery, and Failover Architecture

This document describes the unified request-scoped retry architecture in
`packages/providers` (issue #2532): one failure taxonomy, one aggregate
attempt budget, one guarded-stream primitive, and one irreversible commit
state that together govern retry, auth recovery, credential-bucket rotation,
and load-balancer failover.

## Ownership model

| Concern                                                  | Owner                                               | Not owner                                |
| -------------------------------------------------------- | --------------------------------------------------- | ---------------------------------------- |
| Decode provider errors into the taxonomy                 | Provider adapters (Anthropic, OpenAI, ...)          | RetryOrchestrator, LoadBalancingProvider |
| Observe terminal protocol events (`message_stop` et al.) | Provider adapters                                   | RetryOrchestrator                        |
| Set the commit flag before every outward event           | Guarded stream (`guardedStream.ts`)                 | Adapters                                 |
| Close losing iterators on timeout/cancel                 | Guarded stream                                      | Callers                                  |
| Retry / backoff / auth repair / bucket rotation policy   | `RetryOrchestrator`                                 | Adapters                                 |
| Target selection and failover policy                     | `LoadBalancingProvider`                             | Adapters                                 |
| Aggregate attempt budget accounting                      | `TransportAttemptBudget` shared via request context | Any single layer                         |

Adapters never decide retries. They throw decoded failures (including
in-band HTTP-200 SSE errors) and let shared policy decide. Shared policy
never inspects provider wire formats; it consumes the taxonomy.

## Failure taxonomy

`retryFailureTaxonomy.ts` decodes any thrown error into:

```text
phase: connect | headers | stream | protocol | auth | tool | cancellation
kind: timeout | network | rate_limit | overload | server | auth | payment |
      malformed | truncated | invalid_request | cancelled | unknown
status?: number
retryAfterMs?: number
providerCode?: string
cause: unknown
```

Mapping highlights (single source of truth in `decodeRetryFailure`):

- HTTP 429 → `rate_limit`; Anthropic `overloaded_error` → `overload`;
  both are retryable before exposure.
- `api_error` body type or 5xx status → `server`.
- 401/403 → `auth`; 402 → `payment`; 400/404/422 → `invalid_request`
  (terminal, no retry).
- Network transients → `network`; timeout errors → `timeout`;
  AbortError → `cancelled`.
- `StreamTruncatedError` (EOF without a terminal event) → `truncated`;
  `MalformedStreamEventError` (structural protocol violation) → `malformed`.
  Both are retryable before exposure and terminal after it.
- `providerCode` carries the provider's own error type (e.g. Anthropic's
  nested `error.error.error.type`).

## Request budget

Every logical request gets a `TransportAttemptBudget` created in
`resolveRetryRequestContext` and shared through
`options.metadata._retryRequestContext`:

- `RetryOrchestrator` counts one unit per raw provider attempt for ordinary
  providers (`transportAttemptOwnership` unset).
- Providers that own their transport attempts (`transportAttemptOwnership:
'provider'`, currently `LoadBalancingProvider`) consume units themselves as
  they rotate backends; the orchestrator does not double-count them.
- Retry-After delays are normalized (`retryDelayPolicy`, capped) and honored
  within the same budget; attempts, not wall-clock time, bound the budget.
- On exhaustion the request fails with a `RetriesExhaustedError` carrying the
  decoded category.

### SDK-level retries against the budget

- Anthropic and OpenAI SDK clients are constructed with `maxRetries: 0`, so
  every HTTP attempt is visible to and counted by the orchestrator: one
  budget unit per HTTP attempt.
- The `openai-vercel` provider forwards the `retries` ephemeral (default 2)
  into the AI SDK, which retries HTTP requests beneath one orchestrator
  attempt. Those under-the-wire retries are NOT individually visible to the
  budget: one budget unit can cover up to `1 + retries` HTTP requests. Set
  the `retries` ephemeral to `0` for exact budget-to-HTTP-attempt equality.
  This is documented rather than defaulted to zero to avoid changing
  existing profile behavior (issue #2532 keeps retry capability intact).

## Commitment

`retryRequestContext.ts` attaches a commit state to the same request
context:

- `committed: boolean` — irreversible once true.
- `exposure: 'none' | 'metadata' | 'content' | 'tool_call'` — strongest
  output that has escaped; metadata alone counts as exposure.
- `terminalSeen: boolean` — set by adapters when a terminal protocol event
  (e.g. Anthropic `message_stop`) is observed.

The guarded stream sets `committed` immediately before every outward yield.
Mandatory policy after commitment, enforced in `retryCommitGate.ts` and the
load-balancer failover path:

- No replay of the request (no retry, no second backend, no new HTTP call
  with the same logical request).
- No credential-bucket rotation for this request.
- Auth repair may run once to prepare future requests (token refresh, cache
  invalidation) but never replays this one.
- The failure surfaces to the caller with the partial output already
  delivered; the agents layer decides whether to restart the turn.

## Guarded stream

`guardedStream.ts` is the single primitive that wraps raw provider streams
for both `RetryOrchestrator` (normal and first-chunk-timeout paths) and
`LoadBalancingProvider` (via `loadBalancing/streamTimeout.ts`, which
delegates to it). It owns:

- commit-before-yield (exposure classification per chunk)
- post-yield failure marking (errors after output are terminal)
- first-chunk timeout racing that aborts the attempt controller and closes
  the losing iterator
- iterator cleanup on every incomplete path

## Provider obligations (adapter contract)

Adapters that stream must:

1. Construct SDK clients with zero hidden retries where the SDK permits it.
2. Let in-band errors (HTTP 200 + SSE `event: error`) surface as thrown
   errors; the taxonomy decodes them (e.g. `overloaded_error` → overload).
3. Observe terminal events and set `terminalSeen`; on EOF without one,
   throw `StreamTruncatedError`.
4. Throw `MalformedStreamEventError` for deterministic structural
   violations (e.g. `input_json_delta` with no open `tool_use` block). Do
   not classify benign events (`ping`, unknown-but-ignorable types) as
   malformed.

## Telemetry

`AttemptEndInfo` (see `logging/attemptLifecycle.ts`) carries additive
optional fields for every raw attempt: `failureKind`, `failurePhase`,
`committed`, `exposure`, `budgetUsed`, `budgetLimit`. No secrets
(tokens/credentials) are included — only decoded taxonomy, booleans, and
budget counters.

## History integrity

Because replays never occur after commitment, partial output is never
duplicated or mixed across attempts. Tool-call identity
(`normalizeToHistoryToolId` with a process-level sequence) and thinking
stream ids (per-call epochs) remain stable per attempt; a turn-level restart
by the agents layer produces a fresh request context with a fresh budget and
commit state, so ids cannot collide with the aborted attempt's output.
