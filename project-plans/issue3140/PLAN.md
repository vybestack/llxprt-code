# Issue #3140 — Quota-exhaustion 429s must not be retried like transient rate limits

## Problem

HTTP 429 is treated as unconditionally retryable on the OpenAI Responses path.
That status covers two conditions with opposite correct handling:

- **Transient throttling** (`rate_limit_exceeded`) — retry with backoff is correct.
- **Quota / credit exhaustion** (`insufficient_quota`) — retry can never succeed.

Because the Responses path is stateless, each retry resends the entire
conversation. A captured Codex sequence produced nine full-prompt requests
(~1.13 MB each, ~9.7 MB total) for one logical turn, all failing.

Two additional defects block diagnosis and correct backoff:

- The error thrown by `parseErrorResponse` carries no response headers, so
  `Retry-After` is invisible to every retry layer.
- No error-response dump is written on the Responses path, so the failure body
  is never captured even with `/dumpcontext on`.

## Current behavior (verified against main)

| Location | Current behavior |
| --- | --- |
| `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts:111` | `shouldRetryOnError` returns `true` for any 429; body never consulted. |
| `packages/providers/src/retryDelayPolicy.ts:18` | `shouldRetryError` (used by `RetryOrchestrator.decideRetryOrThrow`) returns `true` for any 429; body never consulted. |
| `packages/providers/src/openai/responsesErrorParsing.ts:84` | `parseErrorResponse` attaches `status` and `code` only. No `response.headers`, no raw body, one fixed 429 prefix `Rate limit exceeded`. |
| `packages/providers/src/openai-responses/openAIResponsesHttpStream.ts:237` | `throwApiError` discards `response.headers`. |
| `packages/providers/src/openai-responses/openAIResponsesHttpStream.ts:246` | `handleStreamRetry` always uses fixed exponential backoff + jitter; `Retry-After` never consulted. |
| `packages/providers/src/openai-responses/openAIResponsesExecutor.ts:648` | `dumpFinalizedRequest` dumps the request only, and only when `shouldDump(mode, false)`. No error-response dump exists anywhere on the Responses path. |

Net effect: a terminal 429 is retried `maxStreamingAttempts` times inside the
HTTP stream **and** again by the outer `RetryOrchestrator`, at full prompt cost
per attempt, with no captured evidence of why.

## Accepted behavior (acceptance criteria)

**AC1 — Terminal quota 429 is not retried, at both retry layers.**
A 429 whose body identifies quota/credit exhaustion is classified terminal by
`OpenAIResponsesProviderBase.shouldRetryOnError` (inner stream loop) and by
`shouldRetryError` (outer `RetryOrchestrator`). Exactly one HTTP request is
issued and the error surfaces immediately.

**AC2 — Throttling 429 is still retried and honors `Retry-After`.**
A 429 whose body identifies transient rate limiting remains retryable. When the
response carries a `Retry-After` header, the inner stream retry waits that
duration (capped) instead of its fixed backoff schedule.

**AC3 — Classification consults the error body, not only the HTTP status.**
The terminal/retryable decision reads the OpenAI error `code`/`type` from the
parsed body, at both the top-level and `error.*` nesting positions.

**AC4 — Error responses are captured when dumping is enabled.**
When `dumpcontext` is `on` or `error`, a non-2xx Responses reply produces a
response dump containing the HTTP status and the raw error body, linked to the
request dump when one exists.

**AC5 — The user-facing message distinguishes quota exhaustion from throttling.**
A quota-exhaustion 429 message states that quota/credit is exhausted and that
retrying will not help. A throttling 429 keeps the existing throttling wording.

**AC6 — Regression coverage.**
Tests cover: quota 429, throttling 429, bare 429 (no body code), 5xx, 400, and
network-transient errors.

### Boundary cases (explicitly decided)

| Input | Decision | Rationale |
| --- | --- | --- |
| 429, no parseable body / no code | **Retryable** (unchanged) | Conservative default; only a positively identified terminal code changes behavior. |
| 429, code `insufficient_quota` | **Terminal** | Named in the issue. Documented OpenAI billing-exhaustion code. |
| 429, code `billing_hard_limit_reached` | **Terminal** | Documented OpenAI billing-exhaustion code; identical user action. |
| 429, code `rate_limit_exceeded` | **Retryable** | Named in the issue. |
| 429, unrecognized code | **Retryable** | Conservative default. |
| `Retry-After` absent or unparseable | Fixed exponential backoff + jitter (unchanged) | Preserves current behavior. |
| `Retry-After` present on a 5xx | Honored by the shared delay helper | Existing `getDelayDuration` semantics; no new branch. |
| Terminal quota error | No dump behavior change beyond AC4 | Dump fires once on the terminal failure, not per attempt. |
| Non-429 statuses (400, 5xx) | Unchanged classification | Out of scope to alter. |

### Explicitly out of scope

- The statelessness of the Responses path (#3134).
- The randomized synthetic `call_id` (#3131).
- Unifying retry/recovery/failover budgets (#2532).
- Chat-Completions transport retry classification.
- WebSocket transport error dumps.
- Any change to `packages/core/src/utils/retry.ts` classification.

## Design

### D1 — Terminal-quota predicate (new internal module)

`packages/providers/src/utils/quotaExhaustion.ts`

```
export function isQuotaExhaustionError(error: unknown): boolean
```

Returns `true` only when the error is a 429 **and** an OpenAI error code/type
in the terminal set is found at `error.code`, `error.error.code`,
`error.error.type`, or `error.type`. Terminal set: `insufficient_quota`,
`billing_hard_limit_reached`.

Not exported from `packages/providers/src/index.ts`. Internal helper, consumed
by exactly two call sites.

### D2 — `parseErrorResponse` enrichment

`packages/providers/src/openai/responsesErrorParsing.ts`

- New optional 4th parameter `headers?: Record<string, string>` (lowercase keys).
- Attach `(error as ...).response = { status, headers, body }` where `body` is
  the raw response text. This is the single seam that makes both `Retry-After`
  and the error-response dump payload available downstream.
- 429 prefix becomes code-aware:
  - terminal quota code → `Quota exhausted` prefix plus a trailing clause
    stating retrying will not help and that quota/billing must be resolved.
  - otherwise → `Rate limit exceeded` (unchanged).
- All other statuses unchanged.

`getErrorStatus` already prefers `error.status`, so adding `response.status`
does not change status resolution.

### D3 — `throwApiError` passes headers

`openAIResponsesHttpStream.ts` converts `response.headers` to a lowercase-keyed
plain record and passes it to `parseErrorResponse`.

### D4 — Inner-loop classification and delay

- `OpenAIResponsesProviderBase.shouldRetryOnError`: for status 429, return
  `false` when `isQuotaExhaustionError(error)`; otherwise unchanged.
- `handleStreamRetry`: replace the inline jitter computation with the existing
  `getDelayDuration(error, currentDelay)` from `retryDelayPolicy.ts` (honors
  `Retry-After`, caps at 5 minutes, falls back to jittered backoff). When
  `hasRetryAfterHeader(error)` is true, reset the next delay to the initial
  delay rather than doubling — matching `RetryOrchestrator` semantics.

### D5 — Outer-loop classification

`retryDelayPolicy.shouldRetryError`: in the existing `status === 429` branch,
return `false` when `isQuotaExhaustionError(error)`. Required for AC1
end-to-end; without it the orchestrator re-retries the terminal error.

### D6 — Error-response dump

- `dumpFinalizedRequest` returns the request dump `baseId` (or `undefined`).
- `baseId` and the resolved `dumpMode` are threaded into `StreamResponsesParams`.
- `streamOverHttp` wraps its delegation to `fetchStreamWithRetries` in
  `try/catch`. On a thrown error, when `shouldDumpSDKContext(dumpMode, true)`:
  - if a request `baseId` exists → `dumpSDKResponseContext(baseId, provider, payload, true)`
  - otherwise → `dumpSDKErrorRequestResponse(provider, '/responses', request, payload, baseURL)`
  Then rethrow. Best-effort: a dump failure must never mask the API error.
- Dump payload: `{ status, headers, body }` extracted from `error.response`, or
  `{ error: String(error) }` for non-HTTP failures.
- Response headers are redacted for `set-cookie` and `authorization` before
  being written, because this path newly writes response headers to a
  user-shareable file.
- Fires once per turn on the terminal failure, not once per retry attempt.

## Test plan (RED first)

All tests use `bun:test`.

### T1 — `packages/providers/src/utils/quotaExhaustion.test.ts` (new)
- 429 + `{"error":{"code":"insufficient_quota"}}` → `true`
- 429 + `{"error":{"type":"insufficient_quota"}}` → `true`
- 429 + `{"error":{"code":"billing_hard_limit_reached"}}` → `true`
- 429 + `{"error":{"code":"rate_limit_exceeded"}}` → `false`
- 429 + no code → `false`
- 402/500 + `insufficient_quota` → `false` (status gate)
- non-object / `undefined` → `false`

### T2 — `packages/providers/src/openai/parseResponsesStream.test.ts` (extend)
- quota 429 message contains quota-exhaustion wording and states retrying will
  not help; does **not** read as plain throttling.
- throttling 429 message keeps `Rate limit exceeded` wording.
- `error.response.headers['retry-after']` is populated when headers are passed.
- `error.response.body` holds the raw body text.
- existing assertions unchanged.

### T3 — `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.retryClassification.test.ts` (new)

Behavioral, driven through the real provider with a stubbed `fetch`:
- 429 `insufficient_quota` → exactly **1** fetch call; rejects with the
  quota-exhaustion message. (AC1)
- 429 `rate_limit_exceeded` → more than one fetch call, then succeeds. (AC2)
- 429 `rate_limit_exceeded` with `Retry-After: 1` → the observed inter-attempt
  wait tracks the header rather than the configured `retrywait`. (AC2)
- 429 with no body code → still retried. (boundary)
- 500 → still retried. (AC6)
- `TypeError('fetch failed')` → still retried. (AC6)
- 400 → not retried. (AC6)

### T4 — `packages/providers/src/retryDelayPolicy` coverage (extend or new)
- `shouldRetryError` returns `false` for a quota-exhaustion 429 and `true` for
  a throttling 429, a bare 429, and a 5xx. (AC1/AC6)

### T5 — Error-response dump (new test alongside the executor tests)
- With `dumpcontext: 'on'` and a non-2xx Responses reply, a response dump is
  written containing the status and the raw error body, linked to the request
  dump. (AC4)
- With `dumpcontext: 'error'`, both a request and a linked error-response dump
  are written. (AC4)
- With `dumpcontext: 'off'`, no dump is written.
- A dump failure does not change the error surfaced to the caller.
- `set-cookie` / `authorization` response headers are not present in the dump.

## Files changed

| File | Change |
| --- | --- |
| `packages/providers/src/utils/quotaExhaustion.ts` | new — terminal-quota predicate |
| `packages/providers/src/utils/quotaExhaustion.test.ts` | new — T1 |
| `packages/providers/src/openai/responsesErrorParsing.ts` | headers/body attachment, code-aware 429 prefix |
| `packages/providers/src/openai/parseResponsesStream.test.ts` | T2 |
| `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts` | 429 body classification |
| `packages/providers/src/openai-responses/openAIResponsesHttpStream.ts` | pass headers, `getDelayDuration`, error dump |
| `packages/providers/src/openai-responses/openAIResponsesExecutor.ts` | return/thread dump `baseId` + `dumpMode` |
| `packages/providers/src/retryDelayPolicy.ts` | outer-loop 429 classification |
| `packages/providers/src/retryDelayPolicy.test.ts` (or existing) | T4 |
| `packages/providers/src/openai-responses/__tests__/OpenAIResponsesProvider.retryClassification.test.ts` | new — T3 |
| `packages/providers/src/openai-responses/openAIResponsesExecutor.errorDump.test.ts` | new — T5 |

## Policy invariance

- No new `eslint-disable*`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`.
- No ESLint severity downgrades, no `ignores:` additions.
- No increase to any complexity or size threshold (`max-lines` 800,
  `max-lines-per-function` 80, `complexity` 25, `sonarjs/cognitive-complexity` 30).
- New tests use Bun + `bun:test`. No Vitest/Node test suites added or modified.
- Fix the underlying cause; never silence a rule.

## Review triage

Reviews performed: one architecture review and one Open Code Review, both on
the full staged change. Every finding was classified.

### Blocker — fixed

| ID | Finding | Resolution |
| --- | --- | --- |
| B1 | Lifting the body's `type` onto the thrown `Error` collided with the key `isOverloadError` reads, making a Responses 403/404 carrying `type: api_error` retryable and reversing the "403 is never retried" invariant (#2917). | Renamed to `providerErrorType`; `findTerminalQuotaCode` reads that position. Two regression tests added, both proven to fail when the rename is reverted. |
| B2 | The error-dump test wrote to and blanket-deleted from the real user cache directory, leaking full-prompt request files. | Sandboxed `LLXPRT_CONFIG_HOME` to a per-pid tmpdir before `Storage.getGlobalCacheDir()` is evaluated, matching `dumpContext.test.ts`; the sandbox is removed in `afterAll`. |

### In-scope — fixed

| ID | Finding | Resolution |
| --- | --- | --- |
| F1 | `\|\| isNetworkTransientError(error)` let message-substring heuristics re-open a terminal classification (provider prose "account terminated" matches the transient phrase "terminated"). | A definite HTTP status is now authoritative; the heuristic applies only when no status is present. |
| F2 | The Codex/ChatGPT backend wraps errors in a `detail` envelope the classifier did not read. | Added `detail.code` / `detail.type` as structural positions. No speculative code strings were added — see "Known limitation". |
| F3 | `billing_hard_limit_reached` is returned as HTTP 400, so the quota wording never fired for it. | The quota prefix is now selected by error code rather than status. The retry gate stays at 429. |
| F4a / OCR-3 | Two divergent implementations of the code/type position walk. | `quotaExhaustion.ts` owns the position list; `responsesErrorParsing.ts` reads the same set. |
| F4b / OCR-4 | Response-header redaction disagreed with request-header redaction. | Single `redactSensitiveHeaders` in `dumpContext.ts` covering `authorization`, `proxy-authorization`, `x-api-key`, `api-key`, `cookie`, `set-cookie`, used by both. |
| F5 | `dumpFinalizedRequest` hand-rolled best-effort handling. | Uses the shared `bestEffortDump`. |
| F6 | Redundant non-object guard in `isQuotaExhaustionError`. | Removed; `getErrorStatus` already covers it. |
| F7 | No test proved AC1 through the outer `RetryOrchestrator`. | Added `RetryOrchestrator.quotaExhaustion.test.ts`, proven to fail when the outer-layer fix is removed. |
| F8 | The "dump failure does not mask the error" test exercised the success path. | Now induces a real `fs.mkdir` failure and asserts the original error survives verbatim. |
| F9 / OCR-2 | The Retry-After test had no lower bound; the dump test never asserted `retry-after` survived redaction. | Added both assertions. |
| OCR-1 | `shouldRetryOnError` JSDoc still claimed all 429s are retried. | Updated. |

### Second review round (PR)

| Source | Finding | Resolution |
| --- | --- | --- |
| CodeRabbit | Quota wording fired on a 5xx echoing a terminal code, claiming "retrying will not help" while both layers correctly retry it. | Gated on the 4xx range rather than an explicit `400 \|\| 429` list — the invariant that matters is "only say retrying will not help when it genuinely will not be retried". Regression test added and verified load-bearing. |
| CodeRabbit | `x-goog-api-key` was not redacted. | Added, plus coverage of every name in the set including a mixed-case form and a blanket "no secret substring" assertion. |
| OCR (×2) | The dump test mutated `process.env` at module scope, so the override was live from import until `afterAll`. | Moved to `beforeEach` with a fresh `mkdtemp` per test, following `liveness.test.ts`. Starting from an empty directory also let the snapshot/diff helpers and the blanket `afterEach` delete go away. |

### CI-unblocking fix (outside issue scope)

`packages/agents` shard failed on `PROP setModel: for any non-empty model
string`. The property generates with `fc.string({ minLength: 1 })`, which is
non-empty by *length* and so includes whitespace-only strings, while
`resolveModelForSystemPrompt` (added by #3141 for issue #3138, merged to main
immediately before this branch rebased) fails fast when `config.getModel()`
trims to empty. The two contracts disagree, so the property fails whenever the
generator emits a blank string — seed-dependent, which is why the same code
passed on the previous head. Reproduced deterministically by pinning the
generator to `fc.constant(' ')`, which yields the identical error. Fixed by
filtering blanks from the generator.

### Deferred (out of scope for this issue)

- Bucket failover may still fire on a terminal quota 429 when a throttling 429
  preceded it in the same turn. Arguably correct — a different bucket has a
  different quota — and it belongs to #2532's territory.
- `response.body` retains the raw body uncapped; the dump needs it in full, so a
  retention cap is a separate design question.
- A quota 429 still carries the structured category `rate_limit` rather than
  `quota`; no user-facing text derives from the category.
- Successful responses are still not dumped on the Responses path. AC4 is scoped
  to error responses.
- Neither `getRetryAfterDelayMs` implementation reads OpenAI's `retry-after-ms`.

## Known limitation

The incident that motivated this issue came from the Codex backend, and the
issue marks the specific error code **UNVERIFIED** because no error-response
dump existed to capture it. This change reads the `detail` envelope the Codex
backend uses, but only for the two documented OpenAI terminal codes. If Codex
reports exhaustion under a different code string, that case remains retryable —
deliberately, because misclassifying a throttle as terminal fails a recoverable
turn, whereas missing a quota code merely preserves today's behavior. The
error-response dump added here (AC4) is what makes the real body observable so
the code can be confirmed and added.

## Verification

```
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
bun scripts/start.ts --profile-load stepfun-37 "write me a haiku and nothing else"
```
