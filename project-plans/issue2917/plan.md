# Issue #2917 — A 403 from an OpenAI-compatible provider presents as an indefinite hang

## Problem

Crusoe (`https://api.inference.crusoecloud.com/v1`) rejects a request in 0.18s with:

```
403  {"errors":["Request blocked: parameter 'reasoning' is not allowed"]}
```

llxprt produced no output and no exit for 60+ seconds. By contrast, Friendli's `422`
on the same class of request surfaced immediately as a clean error.

## Root cause (measured, not inferred)

A `403` is classified as retryable **by HTTP status** in two independent retry layers:

| Location                                             | Code                                       |
| ---------------------------------------------------- | ------------------------------------------ |
| `packages/core/src/utils/retry.ts:21`                | `RETRYABLE_STATUS_CODES = new Set([401, 403, 429])` |
| `packages/providers/src/retryDelayPolicy.ts:41`      | `if (status === 401 \|\| status === 403) return true;` |

A `422` matches none of the retryable branches in `shouldRetryError`, so it throws on
the first attempt — which is exactly why 422 looks correct and 403 does not.

### Measured transport-attempt counts

Instrumented `RetryOrchestrator` with a provider that always throws a status error,
`maxAttempts: 6`:

| Status | Transport attempts (before fix) |
| ------ | ------------------------------- |
| 400    | 1                               |
| 422    | 1                               |
| 403    | **6** (entire retry budget)     |

At production defaults (`initialDelayMs: 5000`, `maxDelayMs: 30000`) six attempts means
delays of 5s + 10s + 20s + 30s + 30s ≈ **95 seconds of complete silence** at the
`RetryOrchestrator` layer alone.

That is then **compounded** by a second, outer retry layer:
`packages/agents/src/core/StreamProcessor.ts:253` wraps the orchestrator in
`retryWithBackoff(...)` whose `shouldRetryOnError` calls core `isRetryableError`, which
also treats 403 as retryable. `createRetriesExhaustedError` propagates the effective
`status`, so the outer layer sees 403 again and restarts the whole inner budget.
Nested, this is many minutes of silence — indistinguishable from a hang.

## Non-goals (explicitly out of scope)

- `401` retry behavior. The issue is about 403. 401 ("credentials not accepted") is the
  genuine token-refresh case and stays retryable.
- `packages/tools/src/utils/retry.ts:192` (`RETRYABLE_STATUSES`) — tool-side HTTP retry,
  not on the provider request path.
- Any change to the reasoning-dialect fan-out (that was #2896 / PR #2915).
- Any change to bucket failover policy or `failoverSettings.ts`.

## Acceptance criteria

**AC1 — A persistent provider 403 surfaces as an error without burning the retry budget when no recovery is possible.**
With `maxAttempts: 6`, a provider that always returns 403:
- with **no** auth-error handler and **no** bucket-failover handler: RetryOrchestrator makes
  **exactly 1** transport attempt and rethrows immediately — identical to 422/400/404.
- with an `onAuthError` handler configured: **exactly 2** attempts (the single auth-refresh
  allowance) and the handler is invoked once.
- with a `bucketFailoverHandler` configured: refresh retry then failover (unchanged).

The caller receives a rejected stream, not a stall.

**AC1-composed — The nested two-layer composition is bounded.**
`StreamProcessor._executeStreamApiCall` (packages/agents/src/core/StreamProcessor.ts:253) wraps
the provider's `RetryOrchestrator` in core `retryWithBackoff`. Across **both** layers, a
persistent 403 with no recovery handlers costs a bounded number of transport invocations
(measured: **2** — the outer `onPersistent429`-driven refresh retry is preserved per issue #1123,
then failover-returns-null → throw). Before this remediation it was **4** (each layer granted
its own auth-refresh retry). A 422 through the same composition costs **1**.

**AC2 — The surfaced error preserves the provider's status and body text.**
The error thrown to the caller must still carry `status === 403` and the provider's
message (e.g. `Request blocked: parameter 'reasoning' is not allowed`), so a user can
tell a configuration problem from a quota problem.

**AC3 — The existing one-shot auth-refresh retry on 403 is preserved.**
`retryWithBackoff` must still invoke `onAuthError` exactly once for a 403 and retry
exactly once, so OAuth token-revocation recovery (issue1861) keeps working. This must
hold even when `onPersistent429` is **not** supplied — today that path only works by
accident, via blind status-based retryability.

**AC4 — Bucket failover on repeated 403 is preserved.**
Two consecutive 403s with a failover handler configured must still trigger failover
(issue1123, SB-06).

**AC5 — Non-auth statuses are unaffected.** 400/404/422 still fail on the first attempt;
429 and 5xx still retry through the full budget.

## Design

Two production edits, both removing *blind status-based* retryability of 403 while
keeping the *explicitly modeled* auth-recovery paths intact.

### Edit 1 — `packages/providers/src/retryDelayPolicy.ts`

```diff
-  if (status === 401 || status === 403) {
+  if (status === 401) {
     return true;
   }
```

`RetryOrchestrator.decideRetryOrThrow` throws when
`!shouldRetryError && !shouldAttemptRefreshRetry`. `maybeRefreshAuth` still grants the
first auth error one retry, so 403 → 2 attempts then a clean throw of the **raw**
provider error (not a `RetriesExhaustedError`), which satisfies AC2.

### Edit 2 — `packages/core/src/utils/retry.ts`

```diff
-const RETRYABLE_STATUS_CODES = new Set([401, 403, 429]);
+const RETRYABLE_STATUS_CODES = new Set([401, 429]);
```

This alone would regress AC3: in `handleRetryFailure` the refresh-retry allowance is
gated on `canAttemptFailover = options?.onPersistent429 !== undefined`. Callers that
supply only `onAuthError` (see `retry.onAuthError.test.ts`) would lose both the retry
and the `onAuthError` invocation. So the gate must also recognise an auth handler:

```diff
     classified.is500,
-    context.options?.onPersistent429 !== undefined,
+    context.options?.onPersistent429 !== undefined ||
+      context.options?.onAuthError !== undefined,
     context.failoverThreshold,
```

and the corresponding `updateErrorCounters` parameter is renamed
`canAttemptFailover` → `canRecoverFromAuthError`, since it now means "some auth-recovery
mechanism exists", not specifically "failover is possible".

### Remediation edits (remove the no-recovery auth-refresh retry)

A deep review found that Edits 1+2 alone still left a persistent 403 with **no** auth
handler and **no** failover handler costing **4** transport attempts and ~15s backoff in
the real `StreamProcessor` composition (each layer grants its own auth-refresh retry even
though no refresh can occur). Two coordinated edits close that gap:

### Edit 3 (R1a) — `packages/providers/src/RetryOrchestrator.ts`, `maybeRefreshAuth`

Only grant the auth-refresh retry when a recovery mechanism that can change the outcome is
actually configured, via the shared `hasAuthRecoveryHandler(options)` helper
(`packages/providers/src/retryConfigHandlers.ts`, which checks both
`getOnAuthErrorHandlerFromOptions` and `getBucketFailoverHandlerFromOptions`):

```diff
   if (!(isAuthError && consecutiveAuthErrors === 1 && attempt < maxAttempts))
     return false;
+  if (!hasAuthRecoveryHandler(options)) return false;
   await this.invokeAuthErrorHandler(error, options, errorStatus, signal);
   return true;
```

Effect: isolated RetryOrchestrator, persistent 403, no handlers → **1** attempt (was 2).

### Edit 4 (R1b) — `packages/core/src/utils/retry.ts`, the `canRecoverFromAuthError` expression

Budget-guard the `onAuthError`-driven allowance to match the guard
`invokeAuthErrorCallback` already applies (`attempt >= maxAttempts` → skip). The
`onPersistent429`-driven branch is left identical (issue #1123 depends on it):

```diff
     context.options?.onPersistent429 !== undefined ||
-      context.options?.onAuthError !== undefined,
+      (context.options?.onAuthError !== undefined &&
+        state.attempt < context.maxAttempts),
```

## Test plan (write these first; confirm RED before editing production code)

All tests are behavioral: real `RetryOrchestrator` / real `retryWithBackoff`, driven by a
fake provider/transport that throws real status-bearing errors. No mocking of the unit
under test, no assertions on mock call plumbing beyond counting real transport calls.

### T1 (AC1) — `packages/providers/src/__tests__/RetryOrchestrator.forbidden.test.ts` *(new)*

Real `RetryOrchestrator`, `maxAttempts: 6`, fake provider that always throws a 403
carrying Crusoe's body text. Count transport invocations.

- **no handler**: asserts transport called exactly **1** time (RED before R1(a): 2). The
  orchestrator rethrows immediately — identical to 422/400/404.
- **`onAuthError` handler configured**: asserts transport called exactly **2** times and the
  handler invoked once (refresh allowance preserved).
- **`bucketFailoverHandler` configured**: asserts refresh-then-failover (3 attempts, bucket
  switches) — unchanged.

### T2 (AC2) — same file

Asserts the rejection carries `status: 403` and a message containing
`Request blocked: parameter 'reasoning' is not allowed`.

### T3 (AC5) — same file

Table-driven over `[400, 404, 422]` → exactly 1 transport attempt; over `[429, 503]` →
retries beyond 2 attempts. Guards against over-correcting.

### T-composed (AC1-composed) — `packages/providers/src/__tests__/RetryOrchestrator.forbidden-composed.test.ts` *(new)*

Composes core `retryWithBackoff` around a **real** `RetryOrchestrator`, mirroring the
options `StreamProcessor.ts:253` passes (`onPersistent429` returning null, the
`shouldRetryOnError` predicate combining `EmptyStreamError`/`isTerminalRetryError`/
`isRetryableError`). The isolated per-layer tests cannot detect the nested duplication, so
this exercises the real composition.

- persistent 403, no recovery handlers: asserts **2** total transport invocations across both
  layers (RED before R1(a): 4) and that the surfaced error preserves status 403 + body text.
- 422 contrast through the same composition: asserts **1** transport invocation — the issue's
  literal acceptance ("surfaces as an error the same way a 422 does").

### T4 (AC3) — `packages/core/src/utils/retry.onAuthError.test.ts` *(extend)*

The existing 403 test already asserts `onAuthError` called once and the function called
twice, but it passes today only because of blind status retryability. Add an explicit
case that pins the intent: a 403 with `onAuthError` supplied and **no** `onPersistent429`
retries exactly once and then rejects with the original error. RED after Edit 2 alone,
GREEN with the `canRecoverFromAuthError` change.

Also add: a 403 with **neither** `onAuthError` nor `onPersistent429` must call the
function exactly **once** (no pointless backoff). RED today (calls it up to `maxAttempts`).

### T5 (AC4) — existing suites must stay green, unmodified

- `packages/core/src/utils/retry.test.ts` — "should retry once on 403 before bucket failover"
- `packages/providers/src/__tests__/RetryOrchestrator.failover.test.ts` — "should failover on 401/403 after one retry"
- `packages/providers/src/__tests__/RetryOrchestrator.onAuthError.test.ts` — 403 onAuthError
- `packages/providers/src/auth/__tests__/behavioral/single-bucket.behavioral.spec.ts` — SB-06

### Measured results (final, this remediation)

Transport-attempt counts, instrumented with a counting fake provider/transport:

| Scenario                                           | Before fix | After fix |
| -------------------------------------------------- | ---------- | --------- |
| Isolated RetryOrchestrator, 403, no handlers       | 2          | **1**     |
| Isolated RetryOrchestrator, 403, `onAuthError` set | 2          | **2**     |
| Isolated RetryOrchestrator, 403, `bucketFailover`  | 3          | **3**     |
| Isolated RetryOrchestrator, 422                    | 1          | **1**     |
| **Composed** (core `retryWithBackoff` ⊃ RetryOrchestrator), 403, no handlers | **4** (~15s) | **2** |
| **Composed**, 422                                  | 1          | **1**     |

The composed 403 path still spends one outer `onPersistent429`-driven refresh retry (issue
#1123) before failover-returns-null → throw; that is intentional and protected by
`packages/core/src/utils/retry.test.ts` "should retry once on 403 before bucket failover".

### Suite results

- `packages/core`: `retry.test.ts` 53/53, `retry.onAuthError.test.ts` 8/8 pass
- `packages/providers`: `RetryOrchestrator.{basic,failover,failover5xx,onAuthError,forbidden,forbidden-composed}.test.ts` + `LoadBalancingProvider.failover.retryable.test.ts` + `single-bucket.behavioral.spec.ts` — 101/101 pass
- `packages/providers/src/openai/OpenAIProvider.shouldRetry.test.ts` fails to load under
  vitest (`vi.importActualSync` requires Bun) — **pre-existing**, unrelated, runs under `bun test`

## Verification

`npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`,
and `bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"`.
