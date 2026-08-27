# Plan: Validate auth proxy payloads at IPC boundaries

Plan ID: PLAN-20260826-PROXYVALIDATION

Tracking issue: https://github.com/vybestack/llxprt-code/issues/2197

Generated: 2026-08-26

## Objective

Validate untrusted credential-proxy frames and payloads before they become trusted internal values. Preserve the existing protocol operations, success payloads, error codes, and error text except that malformed successful payloads must now fail instead of being cast or normalized into apparently valid values.

## Current-state findings

- The proxy transport is framed JSON over Unix-domain sockets or Windows named pipes. No proxy HTTP transport exists in the audited directories.
- `ProxySocketClient` already has a handwritten response-frame type guard added after the issue was filed. The implementation still needs schema-first validation and behavioral coverage for valid and malformed frames.
- `OAuthTokenSchema` and `BucketStatsSchema` already exist in `packages/auth/src/types.ts`; Zod is already a direct auth-package dependency.
- `credential-store-factory.ts` no longer contains a proxy or refresh compatibility cast on current `main`. It requires no change unless an in-scope failing behavioral test demonstrates one.
- `proxy-token-store.ts`, `proxy-provider-key-storage.ts`, `credential-proxy-server.ts`, `credential-proxy-oauth-handler.ts`, and `refresh-coordinator.ts` still cast proxy-boundary data to trusted types.
- Existing OAuth flow implementations validate provider HTTP responses separately. This plan does not redesign or duplicate those flow schemas.

## Accepted behavior

### AC1: Validate decoded response envelopes

**Given** bytes decoded into an unknown proxy response frame,
**when** the frame is used for a handshake or a correlated request,
**then** `ok` must be boolean; `data` must be a non-null, non-array object when present; and `error`, `code`, and `retryAfter` must have their protocol types when present.

Malformed handshakes reject with `Malformed handshake response from proxy`. Malformed correlated responses reject with `Malformed response for request <id>` and reset the connection. Frames without a usable correlation ID remain ignored after the handshake, matching current behavior.

### AC2: Validate successful client payloads

Successful response data is parsed before use:

- `get_token`: `OAuthTokenSchema`;
- `list_providers`: `{ providers: string[] }`;
- `list_buckets`: `{ buckets: string[] }`;
- `get_bucket_stats`: `BucketStatsSchema`;
- `get_api_key`: `{ key: string }`;
- `list_api_keys`: `{ keys: string[] }`;
- `has_api_key`: `{ exists: boolean }`.

Valid data is returned unchanged. Missing or malformed successful data throws a stable proxy payload validation error. `NOT_FOUND` and existing non-success messages remain unchanged. Bucket stats are no longer synthesized from malformed token-shaped or partially typed data.

### AC3: Validate inbound credential requests

The credential server parses required and optional request fields before calling its stores. Missing or wrong-typed `provider`, `bucket`, `name`, or `token` values produce the operation's existing `INVALID_REQUEST` message. A valid token is sanitized before merge so an IPC caller cannot replace the host refresh token. Invalid tokens do not reach the token store.

Sandbox authorization checks retain their current ordering and behavior. The change must not expose provider, key, or bucket existence through a different response.

### AC4: Validate inbound OAuth requests

The OAuth handler parses required and optional request fields before looking up flows, sessions, tokens, or refresh coordination. Missing or wrong-typed `provider`, `bucket`, `redirect_uri`, `session_id`, and `code` values produce the existing `INVALID_REQUEST` message selected for that missing field. Valid initiation, exchange, poll, cancellation, and refresh requests retain their existing behavior.

### AC5: Use validated wire-safe token and stats values

A sanitized OAuth token schema omits `refresh_token` while preserving supported OAuth extension fields already accepted by `OAuthTokenSchema`. Outbound token and bucket-stat values pass through schema validation or schema-derived wire types without `as unknown as` compatibility casts. `RefreshResult.token` represents a sanitized token instead of claiming it is a full `OAuthToken`.

### AC6: Scope and compatibility

- No protocol operation, version, frame format, public dependency, lint rule, or type rule changes.
- No unrelated refactor or speculative input hardening.
- No production change to `credential-store-factory.ts` unless an accepted behavioral test fails without one.
- API-key payload parsing is included because it uses the same `ProxyResponse.data` trust boundary and currently casts directly to trusted values.
- Existing non-boundary compatibility casts, including error duck typing, are outside scope.

## Input and boundary matrix

| Boundary | Valid input | Malformed cases | Required result |
| --- | --- | --- | --- |
| Handshake response | boolean `ok`, optional typed envelope fields | missing/string `ok`; array/null `data`; wrong optional field types | existing malformed-handshake rejection |
| Correlated response | typed envelope plus string `id` | malformed envelope with matching string `id` | request rejection and connection reset |
| Token response | complete OAuth token; optional known extensions | missing token; wrong access token, expiry, or token type | proxy payload validation error |
| Lists and API-key data | expected wrapper object and member type | absent wrapper/member; scalar; mixed-type array | proxy payload validation error |
| Bucket stats | string bucket and numeric counters, optional numeric last-used value | partial values; wrong types; token-shaped data | proxy payload validation error |
| Credential request | operation-specific required strings and valid token | wrong-typed truthy fields; malformed token | existing `INVALID_REQUEST` response; no downstream call |
| OAuth request | required strings plus optional strings | wrong-typed truthy fields; missing exchange field | existing field-specific `INVALID_REQUEST` response; no downstream call |
| Outbound sanitized token | valid OAuth token with or without refresh token | unsupported malformed internal token | fail at schema boundary; never emit refresh token |
| Refresh result | merged token saved on host, sanitized token returned | refresh token present in source token | success response omits refresh token |

Zod object schemas will retain the project's current default behavior for unknown object properties. This preserves provider-specific OAuth fields represented as extensions while selecting only schema-supported wire fields where sanitization requires it.

## Test-first implementation phases

### Phase 1: Response envelope and client payloads

1. Add real-socket failing tests for malformed handshakes and correlated frames while retaining valid-frame tests.
2. Add failing tests for valid and malformed token, list, bucket-stat, and API-key successful responses.
3. Add schema definitions in the auth package and parse once at the client boundary and once for each operation-specific `data` payload.
4. Run the auth proxy test files after each red-green cycle.

### Phase 2: Credential request payloads and outbound records

1. Add failing server tests for wrong-typed provider, bucket, name, and malformed token values, including assertions that a subsequent valid request succeeds and unvalidated values do not alter storage.
2. Parse each in-scope credential request with operation-specific schemas while preserving sandbox guard order and existing messages.
3. Validate and emit sanitized tokens and bucket stats without trusted-type compatibility casts.
4. Run the credential proxy server test file after each red-green cycle.

### Phase 3: OAuth requests and refresh results

1. Add failing OAuth handler tests for wrong-typed initiation, exchange, poll, cancellation, and refresh payload fields.
2. Parse payloads before flow or session use while retaining field-specific errors.
3. Add a failing refresh test that proves the returned successful token omits `refresh_token` and retains valid token fields.
4. Type successful refresh results as sanitized tokens and remove the audited outbound casts.
5. Run the OAuth and refresh focused test files after each red-green cycle.

### Phase 4: Verification and review

1. Run all changed focused test files.
2. Compare test-audit scanner findings for the changed tests against `main`.
3. Run `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format`, `npm run build`, and the `stepfun-37` smoke command.
4. Run independent compliance review and no more than two local OCR rounds.
5. Classify every finding as `Blocker-Fix`, `In-scope-Fix`, `Reject`, or `Defer`. Resolve every `Blocker-Fix` and `In-scope-Fix` before creating the pull request.
6. Create the pull request, watch CI to completion, triage all PR review findings with the same classifications, and confirm conflict-free ancestry.

## Behavioral evidence required for completion

- Valid and malformed framed-socket response tests pass through the real `ProxySocketClient`.
- Valid and malformed operation-payload tests pass through real proxy client stores.
- Wrong-typed credential and OAuth request tests pass through the real server dispatch path and return the preserved protocol errors.
- Token sanitization tests prove `refresh_token` is absent from get, exchange, poll, and refresh success payloads where those paths are changed or already covered.
- No audited proxy-boundary `as unknown as` trusted-type cast remains where an accepted schema applies.
- Focused verification, test audit, complete local verification cycle, CI, and reviews pass on the candidate head.
- The pull request is conflict-free and based on current `origin/main`.

## Review finding ledger

| Source | Finding | Classification | Resolution |
| --- | --- | --- | --- |
| OCR round 1 | Existing INVALID_REQUEST text can describe a wrong-typed optional field as missing provider | Reject | The accepted behavior requires the existing operation messages; field-specific new text would change the protocol contract. |
| OCR round 1 | Empty bucket names were normalized differently in the sandbox stats short-circuit | In-scope-Fix | Restored the previous empty-string behavior and added a failing compatibility test before the fix. |
| OCR round 2 | Outbound token and stats validation occurs after the success audit entry | Defer | Audit sequencing is outside the accepted payload and protocol behavior. Track separately rather than expand this issue into audit-log behavior. |
| OCR round 2 | Sandbox stats can echo a malformed non-string bucket | Reject | The implementation normalizes non-string buckets to `default`; validation remains after the sandbox guard to preserve the required security ordering. |
| Review finding 1 | OAuth tokens returned by exchangeCodeForToken, pollForToken, and refreshFn are persisted before schema validation. Malformed flow results can mutate the host store; a malformed refresh marks a cooldown and rate-limits a later valid refresh. | Blocker-Fix | Added failing real-socket tests for exchange and poll, plus coordinator coverage proving a malformed token is not stored and a malformed refresh does not set a cooldown. Then parsed with the extension-preserving OAuthTokenDataSchema before saveToken and before lastRefreshMap.set in credential-proxy-oauth-handler.ts and refresh-coordinator.ts. |
| Review finding 2 | Malformed response envelope evidence is incomplete: missing ok, null data, wrong-typed error, code, and retryAfter, plus malformed OAuth token expiry and token_type, and missing/scalar operation wrappers where the accepted matrix requires it. | In-scope-Fix | Added focused named framed-socket/client tests in proxy-socket-client.test.ts and proxy-token-store.test.ts (handshake missing ok, null data, wrong-typed error/code/retryAfter; token expiry and token_type; missing requestCount member and scalar bucket-stats data; scalar provider and bucket list wrappers). All pass against the real client and ProxyResponseSchema. |
| Review finding 3 | save_token parses and sanitizes the nested token twice: SaveTokenRequestSchema accepts raw token, then the server calls sanitizeTokenForProxy again on the parsed value. | In-scope-Fix | SaveTokenRequestSchema now transforms the nested token to a SanitizedOAuthToken at the IPC boundary. The server consumes the parsed value directly with no second sanitizeTokenForProxy call. Split the pre-existing aggregate save tests into named cases proving extension preservation and host refresh_token merge behavior. |
| Review finding 4 | New aggregate tests violate the repository one-behavior/single-assertion guidance: the credential-proxy-payload-validation table and newly added OAuth wrong-type tests assert several behaviors in one case. | In-scope-Fix | Split the new aggregate cases into named tests in credential-proxy-payload-validation.test.ts, oauth-exchange.spec.ts, oauth-poll.spec.ts, and oauth-initiate.spec.ts. Added coordinator coverage for malformed refresh cooldown behavior. Removed the duplicated assertion in proxy-provider-key-storage.test.ts flagged by the test-audit scanner. Assertions are behavior-focused with no mock-interaction checks. |
| Review finding 5 | The remediation pass deleted named pre-existing tests from oauth-poll.spec.ts (session lifecycle and provider integration describe blocks) and refresh-flow.spec.ts (response schema describe block). The remediation rules forbid deleting or moving unrelated tests: every pre-existing test must stay in its original file and original describe section, and the file-size ceiling only permits moving newly added issue #2197 tests. | Blocker-Fix | Restored `session lifecycle` (session deleted after successful completion, can poll multiple times while pending, invalid session returns SESSION_NOT_FOUND, expired session todo) and `provider integration` (calls flow.pollForToken with device_code from session) in oauth-poll.spec.ts, and `response schema` (success structure, rate_limited retryAfter, error fields) in refresh-flow.spec.ts. Both files are again pure additions with the extension-wire behavior already covered by oauth-exchange.spec.ts and refresh-coordinator.test.ts. |
| Review finding 6 | The oauth-exchange store-failure test relies on `as unknown as TokenStore` plus a private server-options mutation, both forbidden trusted-double casts and private implementation access. The rule requires a configured save-error behavior on the existing InMemoryTokenStore fixture set before starting the real server, then proving the real handler returns EXCHANGE_FAILED. | In-scope-Fix | Added a public `saveError: string | null` field to the existing InMemoryTokenStore fixture in oauth-exchange.spec.ts. The test `reports EXCHANGE_FAILED when persisting the parsed token throws` now sets `backingStore.saveError = 'host storage unavailable'` in the beforeEach-created server, drives a real oauth_exchange through the real socket handler, and asserts EXCHANGE_FAILED with no stored token. No `as unknown as TokenStore`, no `server as unknown as { options }`, and no private-options mutation. |
| Review finding 7 | The remediation pass also restored the pre-existing sandbox save_token FORBIDDEN test to its original request payload, and kept pre-existing aggregate cases intact instead of splitting unrelated tests, as the one-behavior rule applies only to newly added tests. | In-scope-Fix | Restored the original sandbox save_token FORBIDDEN request payload in credential-proxy-server.test.ts and the original "Send 3 concurrent requests" comment in proxy-socket-client.test.ts. Reworked the existing proxy-token-store bucket-stats case in place to use valid stats, then added a malformed-data rejection case. Restored the proxy-provider-key-storage connection assertions. No unrelated tests were removed or moved. |
| Review finding 8 | Refresh validation used the stripping OAuthTokenSchema, removing provider extension fields before merge, persistence, and response sanitization. | Blocker-Fix | Replaced it with the extension-preserving OAuthTokenDataSchema and added coordinator behavior proving a new extension reaches the stored merged token and sanitized success result. |
| Review finding 9 | Exchange and poll validated a sanitized clone but persisted the raw provider-returned token instead of the parsed boundary value. | In-scope-Fix | Parse each provider result once with OAuthTokenDataSchema, persist that parsed token, and derive the sanitized wire token from the parsed value. Exchange and poll tests prove host refresh-token and extension preservation while the wire value omits refresh_token. |
| Review finding 10 | oauth_exchange persistence failures escaped the operation-level handler and changed from EXCHANGE_FAILED to INTERNAL_ERROR. | In-scope-Fix | Restored the operation-level try/catch around exchange, parse, persistence, and response emission. A configured infrastructure-store failure now proves the real socket handler returns EXCHANGE_FAILED without private-state mutation or trusted double casts. |
