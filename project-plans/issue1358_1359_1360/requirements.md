# Requirements (EARS Format)

Issues: #1358 (Credential proxy — Unix socket IPC), #1359 (Host-side OAuth refresh), #1360 (Host-side OAuth login for sandbox)
Parent Epic: #1349 (Unified Credential Management — Phase B)
Depends on: Phase A complete (#1351 KeyringTokenStore, #1352 Wire as Default, #1353 ProviderKeyStorage)

**Terminology:** In this document, "proxy" or "host proxy" refers to the `CredentialProxyServer` running on the host; "inner process" refers to the llxprt-code process inside the Docker/Podman container; "client" refers to `ProxyTokenStore`/`ProxyProviderKeyStorage` in the inner process.

EARS patterns used:
- **Ubiquitous**: The [system] shall [behavior].
- **Event-driven**: When [trigger], the [system] shall [behavior].
- **State-driven**: While [state], the [system] shall [behavior].
- **Unwanted behavior**: If [condition], then the [system] shall [behavior].
- **Optional**: Where [feature/condition], the [system] shall [behavior].

---

## R1: Combined Delivery

### R1.1 — Ubiquitous

Issues #1358, #1359, and #1360 shall ship as a single combined feature. The proxy (#1358) without refresh stripping (#1359) is insecure; host-side login (#1360) requires the proxy.

### R1.2 — Ubiquitous

The system shall continue to volume-mount the settings directory (`~/.llxprt`) into sandbox containers. Removal of this mount (Issue #1357) is out of scope for this delivery.

---

## R2: Detection and Mode Selection

### R2.1 — State-Driven

While `LLXPRT_CREDENTIAL_SOCKET` is set, the system shall use `ProxyTokenStore` and `ProxyProviderKeyStorage` for all credential operations, routing them through the Unix socket.

### R2.2 — State-Driven

While `LLXPRT_CREDENTIAL_SOCKET` is not set, the system shall use `KeyringTokenStore` and `ProviderKeyStorage` directly — identical to pre-Phase-B behavior.

### R2.3 — Ubiquitous

The detection logic shall be centralized in factory functions (`createTokenStore`, `createProviderKeyStorage`). Calling code (`OAuthManager`, auth commands, key commands) shall not know whether it is using a proxy or a direct store (exception: `OAuthManager` checks for proxy mode to skip proactive renewal scheduling per R16.8).

### R2.4 — Ubiquitous

The factory functions shall be called once per process. The returned instances shall be shared across all callers.

---

## R3: Unix Socket Creation and Security

### R3.1 — Ubiquitous

The `CredentialProxyServer` shall create a Unix domain socket at `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock`, where `{tmpdir}` is `fs.realpathSync(os.tmpdir())`, `{uid}` is the current user's UID, `{pid}` is the host process PID, and `{nonce}` is 8 hex characters from `crypto.randomBytes(4)`.

### R3.2 — Ubiquitous

The per-user subdirectory (`{tmpdir}/llxprt-cred-{uid}/`) shall be created with permissions `0o700`.

### R3.3 — Ubiquitous

The socket file shall have permissions `0o600`.

### R3.4 — Ubiquitous

On macOS, the socket path shall use `fs.realpathSync(os.tmpdir())` to resolve symlinks (`/var/` → `/private/var/`). The `os.tmpdir()` volume mount in `sandbox.ts` shall also use the resolved (realpath) path on both sides. Without this, on macOS the mount would be at `/var/folders/.../T` but the socket at `/private/var/folders/.../T`, and the socket path would not exist inside the container.

### R3.5 — Ubiquitous

The socket file shall live within `os.tmpdir()`, which is already volume-mounted into Docker/Podman containers (`sandbox.ts` line 1025). No additional volume mount shall be needed.

### R3.6 — Ubiquitous

The `LLXPRT_CREDENTIAL_SOCKET` environment variable shall be passed to the container via `--env` in the docker/podman args.

---

## R4: Peer Credential Verification

### R4.1 — Event-Driven

When a client connects on Linux, the server shall verify the peer UID via `SO_PEERCRED` matches the server's own UID.

### R4.2 — Event-Driven

When a client connects on macOS, the server shall verify the peer PID via `LOCAL_PEERPID` as best-effort logging (not a security gate, due to PID namespace unreliability across Docker Desktop VM boundaries).

### R4.3 — Event-Driven

When a client connects on a platform where neither `SO_PEERCRED` nor `LOCAL_PEERPID` is available, the server shall log a warning and proceed. Socket permissions (`0o600`) and the cryptographic nonce are the primary defense.

---

## R5: Framing Protocol

### R5.1 — Ubiquitous

All messages shall use length-prefixed framing: 4-byte uint32 big-endian length followed by a JSON payload of exactly that length.

### R5.2 — Ubiquitous

The maximum frame size shall be 64KB (65536 bytes). The length prefix shall be validated against this limit before allocating a buffer.

### R5.3 — Unwanted Behavior

If a frame header is received but the full payload does not arrive within 5 seconds, then the server shall close the connection.

### R5.4 — Unwanted Behavior

If a frame exceeds the 64KB limit, then the server shall close the connection with an error.

---

## R6: Protocol Handshake

### R6.1 — Event-Driven

When a client connects, it shall send a handshake frame: `{"v": 1, "op": "handshake", "payload": {"minVersion": 1, "maxVersion": 1}}`.

### R6.2 — Event-Driven

When the server receives a compatible handshake, it shall respond with: `{"v": 1, "op": "handshake", "ok": true, "data": {"version": 1}}`.

### R6.3 — Unwanted Behavior

If the server receives an incompatible handshake version, then it shall respond with `{"ok": false, "code": "UNKNOWN_VERSION"}` and close the connection.

### R6.4 — Ubiquitous

All post-handshake frames shall carry a client-generated request ID (`id` field) for correlation. The server shall echo the `id` in responses.

### R6.5 — Ubiquitous

The protocol shall be strictly request-response. The server shall never send unsolicited messages.

---

## R7: Request Validation

### R7.1 — Ubiquitous

Each operation shall have a defined request schema (required fields and types) validated on the server side before processing.

### R7.2 — Unwanted Behavior

If a request is malformed (missing fields, wrong types), then the server shall return `INVALID_REQUEST` without touching any credential stores.

### R7.3 — Unwanted Behavior

If `oauth_exchange` is received for a session with `flow_type` other than `pkce_redirect`, or `oauth_poll` is received for a session with `flow_type` of `pkce_redirect`, then the server shall return `INVALID_REQUEST` with a message indicating the operation/flow-type mismatch.

---

## R8: Token Operations via Proxy

### R8.1 — Event-Driven

When `ProxyTokenStore.getToken(provider, bucket)` is called, it shall send a `get_token` request through the socket. The response shall contain sanitized token metadata: `access_token`, `expiry`, `token_type`, `scope` (if present), and provider-specific fields (e.g., Codex `account_id`). The response shall NEVER contain `refresh_token`.

### R8.2 — Event-Driven

When `ProxyTokenStore.saveToken(provider, token, bucket)` is called, it shall send a `save_token` request through the socket.

### R8.3 — Ubiquitous

The `save_token` server handler shall strip any `refresh_token` field from the incoming token payload before processing. The inner process is never authorized to set a `refresh_token` via the proxy — this enforces the trust boundary. After stripping, the server shall acquire the refresh lock via `KeyringTokenStore.acquireRefreshLock(provider, {bucket})`, read the existing stored token, merge (applying all incoming fields but preserving the existing stored `refresh_token`), save the merged result, and release the lock. The `save_token` handler's lock acquisition is only needed for external `save_token` requests from the inner process; the `refresh_token` handler's internal `KeyringTokenStore.saveToken()` call occurs while already holding the lock and does NOT go through the `save_token` handler.

### R8.4 — Event-Driven

When `ProxyTokenStore.removeToken(provider, bucket)` is called, it shall send a `remove_token` request through the socket. The server shall acquire the refresh lock for the provider:bucket (same lock used by `save_token` and `refresh_token` handlers), delete the token via `KeyringTokenStore`, and release the lock. Deletion errors are logged but success is returned to the client (best-effort semantics). The lock acquisition ensures deterministic ordering with concurrent `save_token` and `refresh_token` operations — see R15.1 for the refresh+logout race.

### R8.5 — Event-Driven

When `ProxyTokenStore.listProviders()` is called, it shall send a `list_providers` request. The server shall return the provider list from `KeyringTokenStore`, filtered to allowed providers. If the underlying `KeyringTokenStore.listProviders()` returns an error, the server shall return an empty array (degraded operation).

### R8.6 — Event-Driven

When `ProxyTokenStore.listBuckets(provider)` is called, it shall send a `list_buckets` request. The server shall return the bucket list from `KeyringTokenStore`, filtered to allowed buckets. If the underlying `KeyringTokenStore.listBuckets()` returns an error, the server shall return an empty array (degraded operation).

### R8.7 — Event-Driven

When `ProxyTokenStore.getBucketStats(provider, bucket)` is called, it shall use a `get_token` round-trip. If successful, it shall return placeholder `BucketStats` (`{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`). If `NOT_FOUND`, it shall return `null`. This matches `KeyringTokenStore.getBucketStats()` behavior.

### R8.8 — Ubiquitous

`ProxyTokenStore.acquireRefreshLock(provider, options?)` shall be a no-op that returns `true` (ignoring all parameters). Refresh coordination happens on the host side.

### R8.9 — Ubiquitous

`ProxyTokenStore.releaseRefreshLock(provider, bucket?)` shall be a no-op (ignoring all parameters). Refresh coordination happens on the host side.

---

## R9: API Key Operations via Proxy

### R9.1 — Event-Driven

When `ProxyProviderKeyStorage.getKey(name)` is called, it shall send a `get_api_key` request. The server shall return the key from `ProviderKeyStorage`.

### R9.2 — Event-Driven

When `ProxyProviderKeyStorage.listKeys()` is called, it shall send a `list_api_keys` request. The server shall return the key names from `ProviderKeyStorage`.

### R9.3 — Event-Driven

When `ProxyProviderKeyStorage.hasKey(name)` is called, it shall use a `get_api_key` round-trip and return `true` if non-null.

### R9.4 — Unwanted Behavior

If `ProxyProviderKeyStorage.saveKey()` or `deleteKey()` is called in proxy mode, then it shall throw an error: "API key management is not available in sandbox mode. Manage keys on the host."

### R9.5 — Ubiquitous

`ProviderKeyStorage` is currently a concrete class with no extracted interface. A `ProviderKeyStorageInterface` shall be extracted (or TypeScript structural typing used) so `ProxyProviderKeyStorage` is substitutable at instantiation sites.

---

## R10: Token Sanitization

### R10.1 — Ubiquitous

The `refresh_token` field shall be stripped from ALL data crossing the Unix socket boundary. This includes: `get_token` responses, `refresh_token` operation responses, `oauth_exchange` responses, `oauth_poll` completion responses, error responses, and `save_token` request payloads (incoming direction — see R8.3).

### R10.2 — Ubiquitous

Token sanitization shall be implemented as a single function (`sanitizeTokenForProxy`) at the proxy server response boundary. All socket-crossing token responses shall call this function.

### R10.3 — Ubiquitous

The `sanitizeTokenForProxy` function shall produce `SanitizedOAuthToken`: `Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>`. Provider-specific passthrough fields (`account_id`, `id_token`, `resource_url`) shall be preserved.

### R10.4 — Ubiquitous

The `refresh_token` shall NEVER be logged at any log level, including trace. (See also R28.2 for the broader list of auth artifacts that must not be logged.)

---

## R11: Host-Side Refresh

### R11.1 — Event-Driven

When the proxy receives a `refresh_token` operation, it shall: (1) read the full token from `KeyringTokenStore`, (2) verify a `refresh_token` exists, (3) acquire the file-based advisory lock, (4) double-check (re-read — still expired?), (5) call `provider.refreshToken(currentToken)`, (6) merge new token with stored token per the merge contract (R12), (7) save to `KeyringTokenStore`, (8) release lock, (9) return sanitized token metadata.

### R11.2 — Event-Driven

When the token read in step 1 returns null, the proxy shall return `NOT_FOUND`.

### R11.3 — Unwanted Behavior

If the stored token has no `refresh_token`, then the proxy shall return an error (cannot refresh without a refresh_token).

### R11.4 — Event-Driven

When the double-check (step 4) finds the token is now valid (another process refreshed), the proxy shall release the lock and return the valid token (sans refresh_token).

### R11.5 — Ubiquitous

The `refresh_token` proxy operation shall support all configured OAuth providers. Provider-specific refresh logic is delegated to each provider's `refreshToken()` method. **Gemini exception**: `GeminiOAuthProvider.refreshToken()` currently returns `null` — Gemini relies on `google-auth-library`'s internal `OAuth2Client` refresh mechanism (the library auto-refreshes when the `Credentials` include a `refresh_token`). For Gemini in proxy mode, the host must create an `OAuth2Client`, load stored credentials (including `refresh_token` from `KeyringTokenStore`) via `client.setCredentials(...)`, call `client.getAccessToken()` which triggers the library's internal refresh, then read the refreshed `Credentials` from `client.credentials` and convert to `OAuthToken` format (`Credentials.expiry_date` ms → `OAuthToken.expiry` s, `token_type` defaults to `'Bearer'`; see technical-overview.md §8 Gemini Credentials Conversion). This is a different code path from the other providers (which use `provider.refreshToken(currentToken)`) and must be explicitly implemented in the proxy refresh handler.

---

## R12: Token Merge Contract

### R12.1 — Ubiquitous

When merging a newly received token with the stored token, `access_token` and `expiry` shall always use the new value.

### R12.2 — Ubiquitous

When merging, `refresh_token` shall use the new value if provided and non-empty. If the new value is missing or empty, the existing stored `refresh_token` shall be preserved.

### R12.3 — Unwanted Behavior

If the provider signals revocation (error response indicating the refresh_token is invalid), then the stored `refresh_token` shall be cleared and the user forced to re-auth.

### R12.4 — Ubiquitous

When merging, `scope`, `token_type`, `resource_url`, and provider-specific fields (Codex `account_id`, `id_token`) shall use the new value if provided, otherwise keep the existing value.

### R12.5 — Ubiquitous

The merge logic shall be extracted to a shared utility in `packages/core/src/auth/` (e.g., `token-merge.ts`). Both `OAuthManager` and `CredentialProxyServer` shall import it from there. The existing function operates on `OAuthTokenWithExtras` (= `OAuthToken & Record<string, unknown>`); the extracted utility shall preserve this type to handle provider-specific passthrough fields.

---

## R13: Refresh Retry and Backoff

### R13.1 — Unwanted Behavior

If `provider.refreshToken()` fails with a transient network error, then the proxy shall retry up to 2 times with exponential backoff (1s, 3s).

### R13.2 — Unwanted Behavior

If `provider.refreshToken()` fails with an auth error (401, `invalid_grant`), then the proxy shall NOT retry. The refresh token is invalid; the user must `/auth login` again.

### R13.3 — Unwanted Behavior

If all retries are exhausted, then the proxy shall return `INTERNAL_ERROR` to the inner process.

---

## R14: Refresh Rate Limiting

### R14.1 — Ubiquitous

The proxy shall enforce a maximum of 1 `refresh_token` operation per provider:bucket per 30 seconds.

### R14.2 — Event-Driven

When a refresh is requested within the cooldown period and the current token is still valid, the proxy shall return the current token (sans `refresh_token`).

### R14.3 — Event-Driven

When a refresh is requested within the cooldown period and the current token is expired, the proxy shall return `RATE_LIMITED` with `retryAfter` metadata (seconds remaining in cooldown).

### R14.4 — Event-Driven

When concurrent `refresh_token` requests arrive for the same provider:bucket, the second request shall wait for the first to complete (deduplicated via the lock mechanism).

---

## R15: Refresh + Logout Race

### R15.1 — Event-Driven

When `remove_token` arrives while a refresh is in progress for the same provider:bucket, the `remove_token` shall acquire the same lock (wait for refresh to complete), then delete the token. The user's logout intent wins.

### R15.2 — Unwanted Behavior

If the lock wait for `remove_token` exceeds the per-request timeout (30s), then the operation shall return `INTERNAL_ERROR`.

---

## R16: Proactive Renewal

### R16.1 — Event-Driven

When `get_token` first serves a token to the inner process, the host proxy shall schedule a proactive renewal timer. **Gemini exception**: Proactive renewal for Gemini follows the same scheduling algorithm but uses the `OAuth2Client`-based refresh path (see R11.5 Gemini exception) rather than `provider.refreshToken()`.

### R16.2 — Ubiquitous

The proactive renewal lead time shall be `leadSec = Math.max(300, Math.floor(remainingSec * 0.1))` with jitter `Math.floor(Math.random() * 30)` seconds. The timer fires at `expiry - leadSec - jitterSec`. This matches the existing `OAuthManager.scheduleProactiveRenewal()` algorithm. (Note: diverges from #1359 issue text which specified a fixed 60-second buffer; this uses the actual codebase algorithm.)

### R16.3 — Event-Driven

When a proactive renewal timer fires, the proxy shall re-check actual wall-clock time against token expiry before deciding to refresh. This handles sleep/suspend recovery.

### R16.4 — Event-Driven

When the sandbox exits, all proactive renewal timers shall be cancelled.

### R16.5 — Ubiquitous

Proactive renewal timers shall NOT be persisted across process restarts. On restart, the next `get_token` request triggers a freshness check.

### R16.6 — Event-Driven

When a proactive renewal succeeds, the proxy shall schedule the next timer for the new token's expiry.

### R16.7 — Event-Driven

When a proactive renewal fails, the proxy shall schedule a retry with exponential backoff.

### R16.8 — State-Driven

While `LLXPRT_CREDENTIAL_SOCKET` is set (proxy mode), the inner process's `OAuthManager` shall NOT schedule proactive renewal timers. All refresh triggers in proxy mode use the `refresh_token` proxy operation. Without this, both host and inner would attempt proactive refresh — the inner's attempts would generate unnecessary RPC calls. (Defense-in-depth: even without this check, the inner `OAuthManager` would not schedule renewals because the sanitized token has no `refresh_token`, and `scheduleProactiveRenewal()` exits early when `refresh_token` is absent.)

---

## R17: Host-Side OAuth Login — PKCE Code-Paste Flow

### R17.1 — Event-Driven

When `oauth_initiate` is received for a PKCE code-paste provider (Anthropic or Gemini), the host shall create a fresh provider flow instance for this session and initiate the flow. The initiation step is provider-specific:

- **Anthropic**: Call `new AnthropicDeviceFlow(config)` then `flow.initiateDeviceFlow()` with **no arguments** (uses console callback URI by default). This generates PKCE internally and returns a `DeviceCodeResponse` with `verification_uri_complete` (the auth URL). Do NOT call `flow.buildAuthorizationUrl(redirectUri)` — that method requires a localhost redirect URI (rejects non-localhost at lines 160–167) and is for non-proxy mode. **Security**: The `device_code` field in the response IS the PKCE verifier and MUST NOT be returned to the inner process. Extract only `verification_uri_complete` as the auth URL.
- **Gemini**: Create an `OAuth2Client`, call `client.generateCodeVerifierAsync()` for PKCE generation, then `client.generateAuthUrl({redirect_uri: 'https://codeassist.google.com/authcode', code_challenge_method: 'S256', code_challenge, ...})` to produce the auth URL. This decomposes the `authWithUserCode()` path from `oauth2.ts` (line 259) which is the code path used when `config.isBrowserLaunchSuppressed()` returns true (as it does in sandbox). Do NOT use the monolithic `getOauthClient()` function — it writes to stdout, installs global state (`__oauth_needs_code`, `__oauth_wait_for_code`), uses `ClipboardService`, and expects interactive console input, none of which are appropriate for a background proxy context. **Implementation prerequisite**: The `authWithUserCode()` function is currently monolithic — PKCE generation, URL creation, user input, and code exchange must be decomposed into importable utilities.

The host shall store the flow instance (Anthropic) or OAuth2Client+PKCE verifier (Gemini) in session state and return `{auth_url, session_id, flow_type: "pkce_redirect"}`. Each concurrent login session shall have its own flow/client instance to avoid shared PKCE state.

### R17.2 — Event-Driven

When `oauth_exchange` is received with `{session_id, code}`, the host shall validate the session, then call the session's flow instance to exchange the code for a token. The exchange call is provider-specific:
- **Anthropic**: `flowInstance.exchangeCodeForToken(authCodeWithState)` — takes a single combined `code#state` string. The flow instance holds the PKCE verifier internally.
- **Gemini**: `authWithCode(client, code, codeVerifier, redirectUri)` — takes the `OAuth2Client` instance, code pasted by user, PKCE verifier (type: `{ codeVerifier: string } | undefined` — extracted from `generateCodeVerifierAsync()` result), and redirect URI `'https://codeassist.google.com/authcode'`. **Return type**: `authWithCode()` returns `Promise<boolean>`, NOT credentials directly. On success (`true`), the tokens are side-effected onto the `OAuth2Client` via `client.setCredentials(tokens)`. The proxy reads `client.credentials` to obtain the `Credentials` object. **Conversion**: `Credentials.expiry_date` (milliseconds since epoch) must be converted to `OAuthToken.expiry` (seconds since epoch) via `Math.floor(expiry_date / 1000)`. `token_type` defaults to `'Bearer'` if absent. See technical-overview.md §8 Gemini Credentials Conversion for the full mapping.

The host stores the full token in `KeyringTokenStore` and returns sanitized token metadata. **Error case**: If the code exchange fails (expired code, network error), the session is consumed (single-use) — user must re-initiate login.

### R17.3 — Ubiquitous

The PKCE verifier, challenge, and OAuth state parameter shall NEVER be exposed to the inner process as standalone actionable fields. They are held within provider flow class instances or OAuth2Client objects on the host. **Anthropic caveat**: Anthropic's `initiateDeviceFlow()` embeds the PKCE verifier as the `state` query parameter in `verification_uri_complete` (the auth URL). This URL IS displayed in the inner TUI because the user must open it in their browser to authorize. The verifier is technically visible in the URL string, but is not sent as a standalone field the inner process could act on. Compensating controls (session single-use, peer binding, 10-minute timeout) mitigate the risk of the verifier being extracted from the URL.

### R17.4 — State-Driven

While `LLXPRT_CREDENTIAL_SOCKET` is set (proxy mode), the inner process's `/auth login` command shall use a `ProxyOAuthAdapter` class to drive the login flow via `oauth_initiate`/`oauth_exchange`/`oauth_poll`/`oauth_cancel` proxy operations instead of calling `OAuthManager.login()` directly. The adapter handles TUI display (auth URL, verification URL + user code, "waiting..." messages) and poll loops. `authCommand.ts` detects proxy mode via the env var and dispatches to the adapter. The adapter is a separate class from `ProxyTokenStore` — login is an authentication workflow, not a data-access operation.

### R17.5 — State-Driven

While `LLXPRT_CREDENTIAL_SOCKET` is set (proxy mode), the inner process shall use `ProxyOAuthAdapter.refresh(provider, bucket)` to trigger on-demand token refresh via the `refresh_token` proxy operation, instead of calling `provider.refreshToken(currentToken)` directly. The `TokenStore` interface has no `refreshToken()` method, and the inner's `OAuthProvider.refreshToken()` would fail because the sanitized token contains no `refresh_token`. The `ProxyOAuthAdapter` sends the `refresh_token` proxy operation over the socket; the host performs the actual refresh using the stored `refresh_token` and returns a sanitized token. This is the on-demand complement to proactive renewal (R16) — it is the fallback when the inner process encounters an already-expired token (e.g., timing gap before proactive renewal fires).

---

## R18: Host-Side OAuth Login — Device Code Flow

> _Derived from #1360's "Works for all OAuth providers" acceptance criterion. Issue #1360 describes only the PKCE redirect flow; device code flow requirements are spec additions grounded in codebase analysis. The `oauth_poll` operation is not listed in the original issues; it was added during specification to support device code and browser redirect flows while maintaining the request-response protocol contract._

### R18.1 — Event-Driven

When `oauth_initiate` is received for a device code provider (Qwen, or Codex in fallback mode), the host shall create a device flow instance and initiate:

- **Qwen**: Call `new QwenDeviceFlow(config)` then `flow.initiateDeviceFlow()` — which generates PKCE internally (`code_challenge` + `S256` in the device code request) — and store the flow instance in session state (the PKCE verifier is held internally and needed during `pollForToken()`). Returns `{verification_uri, user_code, device_code}`. (Note: `verification_uri` matches the codebase's `DeviceCodeResponseSchema` and RFC 8628.)
- **Codex (fallback)**: Call `new CodexDeviceFlow()` then `flow.requestDeviceCode()` — returns `{device_auth_id, user_code, interval}`. Store the flow instance in session state. This fallback is used when the host localhost redirect server is unreachable from the browser (e.g., Docker Desktop port forwarding issues, corporate proxy). **Key difference**: Unlike standard device code flows, Codex's device authorization returns `{authorization_code, code_verifier, code_challenge}` from the server — the PKCE verifier is **server-generated**, not client-generated.

The proxy shall return `{verification_url, user_code, session_id, flow_type: "device_code", pollIntervalMs}` to the inner process. **Field name mapping**: providers return `verification_uri` (per RFC 8628); the proxy maps this to `verification_url` in the protocol response. Default `pollIntervalMs` is **5000ms** when the provider omits the `interval` field (Qwen), or `interval × 1000` when present (Codex).

### R18.2 — Event-Driven

When the host receives a device code session, it shall begin polling the token endpoint in the background using the session's stored flow instance:
- **Qwen**: `flow.pollForToken()` — sends `code_verifier: this.pkceVerifier` with each poll.
- **Codex (fallback)**: `flow.pollForDeviceToken(deviceAuthId, userCode, interval)` — polls until user authorizes, then returns `{authorization_code, code_verifier, code_challenge}`. Host then calls `flow.completeDeviceAuth(authorizationCode, codeVerifier, CODEX_CONFIG.deviceAuthCallbackUri)` to exchange for a token.

### R18.3 — Event-Driven

When the inner process sends `oauth_poll` with `{session_id}` and the device code flow is still pending, the proxy shall return `{status: "pending", pollIntervalMs}`.

### R18.4 — Event-Driven

When the device code polling succeeds (user authorized), the host shall store the full token in `KeyringTokenStore` and subsequent `oauth_poll` shall return `{status: "complete"}` with sanitized token metadata (never `refresh_token`), applied via `sanitizeTokenForProxy`.

### R18.5 — Unwanted Behavior

If the device code polling fails (expired, denied), then `oauth_poll` shall return `{status: "error", code, error}`.

### R18.6 — Ubiquitous

The `oauth_poll` operation shall always return a success response (`ok: true`) at the protocol level. The `status` field within the response `data` indicates the OAuth flow outcome: `"pending"`, `"complete"`, or `"error"`. Protocol-level errors (`ok: false`) are reserved for transport/validation failures (malformed request, session not found, etc.), not application-level OAuth flow outcomes.

---

## R19: Host-Side OAuth Login — Browser Redirect Flow

> _Derived from #1360's "Works for all OAuth providers" acceptance criterion. Issue #1360 describes only the PKCE redirect flow; browser redirect flow requirements are spec additions grounded in codebase analysis of `CodexDeviceFlow.buildAuthorizationUrl()` + `exchangeCodeForToken()`. This is the primary Codex login flow; see R18 for the device code fallback._

### R19.1 — Event-Driven

When `oauth_initiate` is received for Codex in browser redirect mode (the primary path), the host shall create a `CodexDeviceFlow` instance, start a temporary localhost HTTP server on the host, then call `flow.buildAuthorizationUrl(redirectUri, state)` (which calls `generatePKCE()` internally and stores the verifier keyed by `state`). The `redirectUri` is `http://localhost:{port}/callback` on the host. The host shall store the flow instance and redirect server state in session state, and return `{auth_url, session_id, flow_type: "browser_redirect"}`.

### R19.2 — Event-Driven

When the user authorizes in the browser, the browser redirects to the host's localhost server. The host captures the authorization code automatically and calls `flow.exchangeCodeForToken(code, redirectUri, state)`. On success, the host stores the full token in `KeyringTokenStore`. When the inner process sends `oauth_poll`, the proxy shall return `{status: "pending"}` until the exchange completes, then `{status: "complete", ...sanitized_token}`.

### R19.3 — Unwanted Behavior

If the browser redirect flow fails (redirect not received within session timeout, exchange error, user cancelled), then `oauth_poll` shall return `{status: "error", code: "EXCHANGE_FAILED"}`.

---

## R20: OAuth Session Management

### R20.1 — Ubiquitous

OAuth session IDs shall be generated with `crypto.randomBytes(16).toString('hex')` — 32 hex characters, 128 bits of entropy.

### R20.2 — Ubiquitous

OAuth sessions shall be single-use. Once `oauth_exchange` succeeds or fails (for PKCE flows) or `oauth_poll` returns `complete` or `error` (for device/browser flows), the session shall be invalidated.

### R20.3 — Ubiquitous

OAuth sessions shall be bound to the authenticated peer identity (UID on Linux, PID on macOS as best-effort). A different peer attempting to use a session shall be rejected.

### R20.4 — Ubiquitous

OAuth sessions shall expire after 10 minutes by default, configurable via `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS`.

### R20.5 — Event-Driven

When an expired session is accessed, the proxy shall return `SESSION_EXPIRED`.

### R20.6 — Event-Driven

When a used session is accessed for exchange or completion, the proxy shall return `SESSION_ALREADY_USED`.

### R20.7 — Ubiquitous

The proxy shall sweep and remove expired/used sessions every 60 seconds (garbage collection).

### R20.8 — Event-Driven

When `oauth_cancel` is received, the proxy shall clean up the session immediately, including stopping any background polling (device code flows) or pending library operations (browser redirect flows).

### R20.9 — Event-Driven

When multiple concurrent `/auth login` attempts start, each shall receive an independent session.

---

## R21: Profile Scoping

### R21.1 — Ubiquitous

The proxy shall restrict credential access to the loaded profile's providers and buckets. The `CredentialProxyServer` shall receive `allowedProviders` and `allowedBuckets` at startup.

### R21.2 — Event-Driven

When a request references a provider or bucket not in the allowed set, the server shall return `UNAUTHORIZED`.

### R21.3 — Event-Driven

When `list_providers` or `list_buckets` is called, results shall be filtered to only include allowed entries.

---

## R22: Global Rate Limiting

### R22.1 — Unwanted Behavior

If more than 60 requests per second arrive on a single connection, then the proxy shall return `RATE_LIMITED` for excess requests.

---

## R23: Error Handling

### R23.1 — Ubiquitous

The proxy shall use the following error codes: `NOT_FOUND`, `INVALID_REQUEST`, `RATE_LIMITED`, `UNAUTHORIZED`, `INTERNAL_ERROR`, `UNKNOWN_VERSION`, `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_ALREADY_USED`, `EXCHANGE_FAILED`, `PROVIDER_NOT_FOUND`.

### R23.2 — Event-Driven

When `RATE_LIMITED` is returned, the response shall include a `retryAfter` field (seconds until retry is allowed).

### R23.3 — Ubiquitous

`ProxyTokenStore` shall translate proxy error codes to match `KeyringTokenStore` error semantics: `NOT_FOUND` on `get_token` returns `null`; `NOT_FOUND` on `remove_token` returns silently; `INTERNAL_ERROR` and `UNAUTHORIZED` throw errors; connection loss throws with message "Credential proxy connection lost. Restart the session."

### R23.4 — Ubiquitous

Provider-specific OAuth error states shall be normalized to stable proxy error codes. Device code `authorization_pending` maps to `oauth_poll` `{status: "pending"}`. Device code `expired_token`/`access_denied`, browser redirect timeouts, and PKCE `invalid_grant` all map to their respective failure responses.

### R23.5 — Ubiquitous

All error responses crossing the socket boundary shall be sanitized to exclude credential material. Provider SDK error objects may contain tokens, secrets, or PKCE verifiers in nested fields (e.g., `error.config.headers.Authorization`, `error.response.data`). Error messages shall be constructed from known-safe fields only (`error.message`, `error.code`, status codes). Raw provider error objects shall never be serialized into socket responses.

---

## R24: Timeout Architecture

### R24.1 — Ubiquitous

Per-request client-side timeout shall be 30 seconds.

### R24.2 — Ubiquitous

Idle connection timeout shall be 5 minutes. When the client-side idle timer fires, the client gracefully closes the connection. On the next operation, the client establishes a fresh connection and performs a new handshake. This is distinct from connection loss (R29.3) — idle reconnection is a client-initiated action at a known-good time, not auto-reconnect after failure.

### R24.3 — Ubiquitous

Host-side request processing timeout shall be 15 seconds per individual operation (keyring read/write/delete/list, API key read/list, each individual provider network call within an OAuth exchange or refresh). The 15s timeout applies to the individual sub-operation, not the entire request — an operation that includes retries (e.g., refresh with 2 retries at 1s, 3s backoff) may span multiple 15s windows but is bounded by the 30s client-side timeout (R24.1). Operations exceeding their timeout shall return `INTERNAL_ERROR`.

### R24.4 — Ubiquitous

Partial frame timeout shall be 5 seconds (frame header received, payload not yet complete).

### R24.5 — Ubiquitous

OAuth session timeout shall be 10 minutes (configurable via `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS`).

### R24.6 — Ubiquitous

Refresh rate limit cooldown shall be 30 seconds per provider:bucket.

---

## R25: Lifecycle and Cleanup

### R25.1 — Event-Driven

When `start_sandbox()` is called, the `CredentialProxyServer` shall be created and begin listening BEFORE the container is spawned.

### R25.1a — Unwanted Behavior

If `CredentialProxyServer` fails to create or bind the socket (permissions error, path too long, port conflict), `start_sandbox()` shall abort with an actionable error before spawning the container.

### R25.2 — Event-Driven

When the sandbox exits normally, the proxy shall close the socket, remove the socket file, cancel all proactive renewal timers, and clean up all PKCE sessions.

### R25.3 — Event-Driven

When SIGINT or SIGTERM is received, the proxy shall perform the same cleanup as normal exit (R25.2). Shutdown shall wait up to 5 seconds for in-flight requests (active refresh, OAuth exchange) to complete before aborting remaining operations. Advisory locks have stale-lock protection via `staleMs`, so aborted lock holders do not permanently block other processes.

### R25.4 — Event-Driven

When the proxy starts and a socket file already exists at the generated path (PID reuse), it shall remove the stale socket before binding.

### R25.5 — Ubiquitous

The proxy connection model shall have no auto-reconnect. Connection loss is a hard error surfaced to the user with an actionable message.

---

## R26: Non-Regression

### R26.1 — Ubiquitous

Non-sandbox mode shall be completely unaffected. When `LLXPRT_CREDENTIAL_SOCKET` is not set, all credential operations shall use direct keyring access exactly as before Phase B.

### R26.2 — Ubiquitous

Seatbelt mode (macOS `sandbox-exec`) shall be completely unaffected. It runs on the host with full keyring and browser access. The `LLXPRT_CREDENTIAL_SOCKET` env var shall NOT be set for seatbelt.

### R26.3 — Ubiquitous

The `--key` flag for API key authentication in non-sandbox mode shall remain unaffected.

---

## R27: Platform Support

### R27.1 — Ubiquitous

The credential proxy shall work with both Docker and Podman sandbox modes.

### R27.2 — Ubiquitous

Unix domain sockets mounted across Docker Desktop macOS VM boundary (VirtioFS) shall be tested before merge. If UDS does not traverse the boundary, a fallback transport shall be designed and implemented before Phase B ships.

### R27.3 — Ubiquitous

The proxy shall work on Linux (Docker native, Podman native) and macOS (Docker Desktop, Podman machine), with the platform test matrix passing before merge.

---

## R28: Audit Logging

### R28.1 — Ubiquitous

All credential operations through the proxy shall be logged at debug level: operation type, provider, bucket — no secret values.

### R28.2 — Ubiquitous

The following auth artifacts shall NEVER appear in full in any log output at any level, including trace: `refresh_token`, authorization codes, PKCE code verifiers, PKCE code challenges, OAuth state parameters, device codes (`device_code`, `device_auth_id`), and full session IDs. Debug/trace logs may reference operations by provider:bucket and **truncated** identifiers for correlation (e.g., first 8 characters of a session ID hex string, truncated token hashes) but must not include the full secret values.

---

## R29: Connection Management

### R29.1 — Ubiquitous

`ProxyTokenStore` shall connect to the Unix socket lazily on first operation.

### R29.2 — Ubiquitous

`ProxyTokenStore` shall maintain a single persistent connection per instance.

### R29.3 — Event-Driven

When a proxy connection is lost (host crash, socket error), `ProxyTokenStore` shall throw an error to the caller. No auto-reconnect.

### R29.4 — Event-Driven

When the idle connection timeout (5 minutes) is reached, the CLIENT shall initiate a graceful close. On the next operation, the client establishes a fresh connection and performs a new handshake. This is distinct from connection loss (R29.3): idle reconnection is a client-initiated action at a known-good time (the client is in control and no failure occurred), not auto-reconnect after a server crash or socket error (where reconnecting could reach a spoofed socket).


---

## Appendix: Acceptance Criteria Traceability Matrix

Maps each acceptance criterion (AC) from the original GitHub issues to the requirement(s) that cover it.

### Issue #1358 — Credential Proxy (Unix Socket IPC)

| # | Acceptance Criterion | Requirement(s) |
|---|---|---|
| 1 | Host process creates and listens on Unix socket before container starts | R3.1, R3.2, R3.3, R25.1 |
| 2 | Inner process can request tokens and API keys through the socket | R8.1, R8.2, R9.1, R9.2 |
| 3 | `ProxyTokenStore` implements full `TokenStore` interface via socket | R2.1, R2.2, R8.1, R8.2, R8.3, R8.4 |
| 4 | `ProxyProviderKeyStorage` implements provider key interface via socket | R2.1, R9.5 |
| 5 | Protocol version handshake on connection, incompatible versions rejected | R6.1, R6.2, R6.3 |
| 6 | Length-prefixed framing handles messages correctly (no newline sensitivity) | R5.1 |
| 7 | Max message size enforced (64KB) with bounds check before allocation | R5.2 |
| 8 | Partial frame timeout (5s) prevents resource exhaustion | R5.3, R24.4 |
| 9 | Per-operation request schema validation on server side | R7.1 |
| 10 | Socket path includes cryptographic nonce | R3.1 |
| 11 | Socket cleaned up on normal exit, SIGINT, and SIGTERM | R25.2, R25.3 |
| 12 | Stale socket files cleaned up on startup | R25.4 |
| 13 | Peer credential verification on Linux (SO_PEERCRED) and macOS (LOCAL_PEERPID), documented fallback | R4.1, R4.2, R4.3 |
| 14 | Profile scoping enforced — cannot request credentials outside loaded profile | R21.1, R21.2 |
| 15 | Rate limiting: 60 req/s per connection | R22.1 |
| 16 | Per-request timeout: 30s | R24.1 |
| 17 | Error handling for: socket connection failure, malformed requests, timeout, rate limiting | R23.1, R23.2, R23.3, R29.3 |
| 18 | Works with both Docker and Podman sandbox modes | R27.1 |
| 19 | Non-sandbox mode is unaffected | R26.1 |
| 20 | Hard error on proxy connection loss (no silent failures, no auto-reconnect) | R25.5, R29.3 |

### Issue #1359 — Host-Side OAuth Refresh

| # | Acceptance Criterion | Requirement(s) |
|---|---|---|
| 1 | `get_token` responses return sanitized token metadata — never refresh_token | R10.1, R10.2 |
| 2 | `refresh_token` op triggers host-side refresh and returns sanitized token metadata | R11.1, R11.2 |
| 3 | Token merge contract implemented explicitly | R12.1, R12.2, R12.3, R12.4, R12.5 |
| 4 | Refresh retry with backoff: 2 retries on transient errors, no retry on auth errors | R13.1, R13.2 |
| 5 | Refresh lock prevents concurrent refreshes across proxy instances | R11.1 (step 3), R14.4 |
| 6 | Double-check pattern prevents unnecessary refreshes | R11.4 |
| 7 | Proactive renewal timer runs on host side with jittered scheduling | R16.1, R16.2, R16.3 |
| 8 | Proactive renewal timer cancelled on sandbox exit | R16.4 |
| 9 | Sleep/suspend recovery: timer re-checks wall-clock time on fire | R16.3 |
| 10 | Rate limiting on refresh: max 1 per provider:bucket per 30 seconds | R14.1, R14.2, R14.3 |
| 11 | Concurrent refresh requests for same provider:bucket deduplicated | R14.4 |
| 12 | Concurrent refresh + logout: logout wins after refresh completes | R15.1 |
| 13 | refresh_token never in data crossing socket boundary | R10.1 |
| 14 | refresh_token never logged at any level | R28.2 (broadened: all auth artifacts) |
| 15 | Works for all OAuth providers (Anthropic, Gemini, Qwen, Codex) | R11.5 |
| 16 | Non-sandbox mode unaffected | R26.1 |

### Issue #1360 — Host-Side OAuth Login for Sandbox

| # | Acceptance Criterion | Requirement(s) |
|---|---|---|
| 1 | `/auth login` in Docker/Podman sandbox completes successfully via proxy | R17.1, R18.1, R19.1 |
| 2 | Auth URL displayed in inner TUI, user can paste code back | R17.1, R17.4 |
| 3 | Code exchange happens on host side, tokens stored in host keyring | R17.2, R17.3 |
| 4 | PKCE state + OAuth state verified during exchange | R17.2 |
| 5 | Inner receives only sanitized token metadata (no refresh_token) | R10.1, R10.2 |
| 6 | PKCE verifier/challenge never exposed to inner process | R17.3 |
| 7 | Session IDs cryptographically random (128 bits) | R20.1 |
| 8 | Session IDs single-use (replay prevention) | R20.2 |
| 9 | Session IDs bound to authenticated client identity (peer credential) | R20.3 |
| 10 | Session timeout 10 minutes (configurable) | R20.4, R20.5 |
| 11 | Expired sessions return `SESSION_EXPIRED` | R20.5 |
| 12 | Reused sessions return `SESSION_ALREADY_USED` | R20.6 |
| 13 | Stale session GC runs periodically and prevents memory leaks | R20.7 |
| 14 | Multiple concurrent login attempts get independent sessions | R20.9 |
| 15 | `oauth_cancel` cleans up session immediately | R20.8 |
| 16 | Works for all OAuth providers (Anthropic, Gemini, Qwen, Codex) | R17.1, R18.1, R19.1 |
| 17 | Seatbelt mode unaffected | R26.2 |
| 18 | Non-sandbox mode unaffected | R26.1 |
