# Pseudocode 001 — Turn retry policy (`turnAbortHelpers.ts`)

Plan ID: `PLAN-20260806-ISSUE3048`
Target file: `packages/agents/src/core/turnAbortHelpers.ts`
Requirements: REQ-3048-002, REQ-3048-003, REQ-3048-004
Referenced by: plan phase **P04**

---

## Interface contracts

```ts
// INPUTS
interface StreamAttemptContext {
  readonly hasYieldedOutput: boolean; // attempt already emitted model output
}
shouldRetryStreamAttempt(
  error: unknown,
  params: SendMessageParams,
  attempt: number,
  context: StreamAttemptContext,
): boolean

applyRetryTemperature(
  params: SendMessageParams,
  attempt: number,
): SendMessageParams

// OUTPUTS
//  shouldRetryStreamAttempt -> true iff the turn may be restarted
//  applyRetryTemperature    -> params (attempt 0) or params with bumped temperature

// DEPENDENCIES (all already imported by this module or trivially importable)
//  INVALID_CONTENT_RETRY_OPTIONS  @vybestack/llxprt-code-core/core/chatSessionTypes.js
//  InvalidStreamError, EmptyStreamError            (same module)
//  isNetworkTransientError        @vybestack/llxprt-code-core/utils/retry.js
//  isTerminalRetryError, isAbortError              (local, unchanged)
```

## Integration points (line by line)

```
Line 20: READ INVALID_CONTENT_RETRY_OPTIONS.maxAttempts
         - the ONLY retry bound; do not introduce a second budget constant
Line 24: CALL isTerminalRetryError(error)
         - agents-local predicate (`isRetryable === false`); catches the
           provider's RetriesExhaustedError aggregate
Line 30: CALL isAbortError(error, params)
         - must be evaluated on BOTH branches; never short-circuited away
Line 33: CALL isNetworkTransientError(error)
         - the centralized classifier; do NOT re-implement phrase matching here
```

## Anti-pattern warnings

```
DO NOT: delete the post-output distinction and let InvalidStreamError /
        EmptyStreamError restart after output — see spec AD-3 / preflight F8.
DO NOT: add a second retry-budget constant. maxAttempts is the bound.
DO NOT: swallow the error or return a "best effort" default. Fail fast.
DO NOT: reorder so isAbortError is skipped when hasYieldedOutput is false —
        the pre-output branch must stay bit-for-bit identical to today.
```

---

## Numbered pseudocode

```
010: FUNCTION shouldRetryStreamAttempt(error, params, attempt, context)
011:   SET withinBudget = attempt < INVALID_CONTENT_RETRY_OPTIONS.maxAttempts - 1
012:   IF NOT withinBudget
013:     RETURN false                     // bounded budget (REQ-3048-003)
014:   IF isTerminalRetryError(error)
015:     RETURN false                     // provider already declared it terminal
016:   IF context.hasYieldedOutput
017:     // Discard-and-restart: the whole attempt is abandoned, so a verdict
018:     // about the CONTENT we are discarding is not a reason to restart.
019:     // Only a transport condition qualifies (REQ-3048-002 / AD-3).
020:     RETURN isNetworkTransientError(error) AND NOT isAbortError(error, params)
021:   // Pre-output path: unchanged from before issue #3048.
022:   IF error IS InvalidStreamError OR error IS EmptyStreamError
023:     RETURN true
024:   RETURN isNetworkTransientError(error) AND NOT isAbortError(error, params)
025: END FUNCTION

030: FUNCTION applyRetryTemperature(params, attempt)
031:   // Relocated verbatim from TurnProcessor._applyRetryTemperature so that
032:   // TurnProcessor.ts stays under max-lines (preflight F3). Behaviour is
033:   // byte-for-byte identical; only the home module changes.
034:   IF attempt EQUALS 0
035:     RETURN params
036:   SET baselineTemperature = MAX(params.config?.temperature ?? 1, 1)
037:   SET newTemperature = MIN(MAX(baselineTemperature + attempt * 0.1, 0), 2)
038:   RETURN { ...params, config: { ...params.config, temperature: newTemperature } }
039: END FUNCTION
```

## Behaviour table (the tests in P03 enumerate exactly these rows)

| `hasYieldedOutput` | error | `attempt` | aborted? | result |
|---|---|---|---|---|
| false | `InvalidStreamError` | 0 | no | `true` (unchanged) |
| false | `EmptyStreamError` | 0 | no | `true` (unchanged) |
| false | `Connection error.` | 0 | no | `true` (unchanged) |
| false | `status: 400` | 0 | no | `false` (unchanged) |
| **true** | `Connection error.` | 0 | no | **`true` (new)** |
| **true** | `Connection error.` | 1 | no | `false` (budget) |
| **true** | `status: 400` | 0 | no | `false` |
| **true** | `InvalidStreamError` | 0 | no | `false` (AD-3) |
| **true** | `EmptyStreamError` | 0 | no | `false` (AD-3) |
| true | `name: 'AbortError'` | 0 | — | `false` |
| true | `code: 'ABORT_ERR'` | 0 | — | `false` |
| true | `terminated` | 0 | **yes** | `false` |
| true | `isRetryable: false` aggregate | 0 | no | `false` |
