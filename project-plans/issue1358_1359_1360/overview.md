# Functional Specification: Credential Proxy for Sandbox

**Issues**: #1358 (Credential proxy — Unix socket IPC), #1359 (Host-side OAuth refresh), #1360 (Host-side OAuth login for sandbox)
**Epic**: #1349 — Unified Credential Management, Phase B
**Depends on**: Phase A complete (#1351 KeyringTokenStore, #1352 Wire as Default, #1353 ProviderKeyStorage)
**Status**: Specification — describes WHAT the system does, not how to build it
**Codebase verified against**: commit `9e02ee8b5` on branch `issue1358-1360`. Line numbers and signatures referenced in this document were verified at this commit; they may drift as the codebase evolves.

---

## Project Principles

- **Combined delivery.** Issues #1358, #1359, and #1360 are delivered as one feature. Individually they are valueless — a proxy without refresh stripping is insecure, and host-side login without a proxy has nowhere to run.
- **Refresh tokens never cross the boundary.** The `refresh_token` field is stripped from every response that crosses the Unix socket. The inner process never sees it, logs it, or stores it.
- **No auto-reconnect.** If the proxy connection drops, the inner process surfaces an error. The user must restart the sandbox session. This is a security decision — auto-reconnect could reconnect to a spoofed socket.
- **Non-sandbox mode is unaffected.** When `LLXPRT_CREDENTIAL_SOCKET` is absent, all credential operations use direct keyring access exactly as they do today. No code paths change for non-sandbox usage.
- **Seatbelt mode is unaffected.** macOS seatbelt (`sandbox-exec`) runs on the host with full keyring access and browser availability. It does not use the proxy.
- **#1357 (stop mounting credential files) is separate.** This spec assumes the settings directory is still mounted. Removing that mount is a follow-up after the proxy is proven.

---

## 1. Problem Statement

After Phase A, OAuth tokens and API keys are stored securely in the OS keyring (or encrypted fallback) on the host. But in Docker/Podman sandbox mode, the inner process cannot access the host OS keyring — there is no `@napi-rs/keyring` backend inside the container, and the encrypted fallback files are only accessible because the entire `~/.llxprt` settings directory is mounted into the container.

This means:
- The inner process can currently read credential files because they are volume-mounted. If a sandbox escape occurs, the attacker gains access to all credentials — including long-lived refresh tokens.
- The inner process cannot write tokens back to the keyring (e.g., after a refresh or login), only to fallback files.
- There is no boundary between the host's credential store and the container — the inner process has the same credential access as the host process.

A credential proxy provides a controlled channel: the inner process requests credentials through a Unix socket, and the host process decides what to serve, what to strip, and what operations to allow.

## 2. What Changes for Users

### Sandbox Users (Docker/Podman)

When running in sandbox mode, credential operations are transparently proxied to the host. From the user's perspective:

- **Token reads** work the same — API calls succeed, tokens are valid.
- **Token refresh** happens automatically on the host. The user sees no difference.
- **`/auth login`** works inside the sandbox. The user sees an authorization URL, opens it in their host browser, pastes the auth code back into the sandbox TUI. The code exchange and token storage happen on the host — the inner process never handles the refresh token or PKCE secrets.
- **`/auth logout`** works inside the sandbox. The token is removed from the host keyring.
- **`/auth status`** works inside the sandbox. Status information is read from the host.
- **API key reads** work through the proxy — `/key` operations retrieve keys from the host.

### Non-Sandbox Users

No change. All credential operations use direct keyring access as before.

### Seatbelt Users (macOS)

No change. Seatbelt runs on the host with full keyring and browser access. The existing OAuth flow works unchanged.

## 3. Credential Lifecycle in Sandbox Mode

### Startup

1. Host process (`start_sandbox()`) creates a `CredentialProxyServer` before spawning the container.
2. A Unix socket is created in a per-user subdirectory with a cryptographic nonce: `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock`.
3. The socket is volume-mounted into the container.
4. The environment variable `LLXPRT_CREDENTIAL_SOCKET` is set inside the container, pointing to the socket path.
5. Container starts. The inner process detects `LLXPRT_CREDENTIAL_SOCKET` and uses proxy implementations (`ProxyTokenStore`, `ProxyProviderKeyStorage`) instead of direct keyring access.
6. On first connection, the client sends a version handshake. If the server and client protocol versions are incompatible, the connection is rejected.

### Token Read

1. Inner process needs a token (e.g., to make an API call).
2. `ProxyTokenStore.getToken(provider, bucket)` sends a `get_token` request through the socket.
3. Host proxy reads the full token from `KeyringTokenStore` (including refresh_token).
4. Host proxy strips `refresh_token` from the response.
5. Inner process receives: `access_token`, `expiry`, `token_type`, `scope` (if present), plus any provider-specific fields like Codex `account_id`.
6. Inner process uses `access_token` for API calls.

### Token Refresh (Host-Side)

When the inner process detects an expired or near-expiry token:

1. Inner sends `refresh_token` operation to proxy (this is the operation name — the refresh_token value is NOT sent).
2. Host proxy reads the full token (with refresh_token) from `KeyringTokenStore`.
3. Host proxy acquires file-based advisory lock.
4. Host proxy double-checks: re-reads token — still expired? (Another process may have refreshed.)
5. Host proxy calls the provider's refresh endpoint with the stored refresh_token.
6. Host proxy merges the new token with the stored token (see merge contract below).
7. Host proxy saves the merged token to `KeyringTokenStore`.
8. Host proxy releases the lock.
9. Host proxy returns only sanitized token metadata to inner: `access_token`, `expiry`, `token_type`, `scope`.

### Token Merge Contract

When merging a newly received token from the provider with the previously stored token:

| Field | Merge Rule |
|---|---|
| `access_token` | Always use the new value |
| `expiry` | Always use the new value |
| `refresh_token` | Use new if provided and non-empty. If new is missing/empty, keep existing. If provider signals revocation (error response), clear and force re-auth. |
| `scope`, `token_type`, `resource_url` | Use new if provided, keep existing otherwise |
| Provider-specific (Codex `account_id`, `id_token`) | Use new if provided, keep existing otherwise |

This contract matches the existing `mergeRefreshedToken()` behavior in `OAuthManager` but makes it explicit.

### Proactive Renewal (Host-Side)

1. When a token is first served to the inner process, the host proxy schedules a proactive renewal timer.
2. Timer fires at `expiry - (leadTime + jitter)` where `leadTime = max(300s, remainingLifetime × 0.1)` and jitter is 0–30 seconds (random per timer). This matches the existing `OAuthManager.scheduleProactiveRenewal()` algorithm — for a 1-hour token, renewal fires ~6.5 minutes before expiry; the 300-second floor ensures short-lived tokens still get a reasonable renewal window.
3. On timer fire, the host re-checks actual wall-clock time against token expiry before deciding to refresh. This handles sleep/suspend recovery — if the machine was suspended and the timer fires late, the token may have already expired, so refresh immediately. If another process already refreshed (double-check pattern), skip.
4. Timer is cancelled when the sandbox exits.
5. Timer is NOT persisted across process restarts. On restart, the next `get_token` request triggers a freshness check.
6. **Gemini exception**: `GeminiOAuthProvider.refreshToken()` returns `null` — Gemini relies on `google-auth-library`'s internal `OAuth2Client` refresh mechanism. Proactive renewal for Gemini follows the same scheduling algorithm but uses an `OAuth2Client`-based refresh path (load stored credentials, call `client.getAccessToken()`) rather than `provider.refreshToken()`. See technical-overview.md §6 for details.

### Login (Host-Side OAuth)

When the user runs `/auth login <provider>` inside a Docker/Podman sandbox:

1. Inner process sends `oauth_initiate` to proxy with `provider` and `bucket`.
2. Host proxy delegates to the provider's existing auth machinery on the host. The response varies by provider flow type:

**PKCE code-paste flow (Anthropic, Gemini):**
1. Host generates PKCE via the provider's flow class. For Anthropic, `initiateDeviceFlow()` (called with **no arguments**) returns `verification_uri_complete` as the auth URL. For Gemini, the host decomposes `authWithUserCode()` into separate steps: generates PKCE via `OAuth2Client.generateCodeVerifierAsync()`, creates auth URL via `client.generateAuthUrl()` with the PKCE challenge and Google's code callback redirect (`https://codeassist.google.com/authcode`).
2. Proxy returns `{auth_url, session_id, flow_type: "pkce_redirect"}` to inner.
3. Inner displays the authorization URL in the TUI. User opens in host browser, authorizes.
4. For Anthropic, the user receives the auth code directly. For Gemini, Google's callback page displays the verification code.
5. User pastes the auth code back into the TUI.
6. Inner sends `oauth_exchange` to proxy with `{session_id, code}`.
7. Host validates session, exchanges code with stored PKCE verifier, stores full token in `KeyringTokenStore`.
8. Proxy returns sanitized token metadata (no refresh_token, no PKCE secrets). **Error case**: If the code exchange fails (expired code, network error), the session is consumed — user must re-initiate login. Inner shows a clear error with instructions to retry.

**Device code flow (Qwen; Codex fallback):**
1. Host creates a device flow instance and initiates: For Qwen, `QwenDeviceFlow.initiateDeviceFlow()` generates PKCE internally (`code_challenge` + `S256`) and returns `{verification_uri, user_code, device_code}`. For Codex fallback, `CodexDeviceFlow.requestDeviceCode()` returns `{device_auth_id, user_code, interval}`.
2. Proxy returns `{verification_url, user_code, session_id, flow_type: "device_code", pollIntervalMs}` to inner. Default `pollIntervalMs` is 5000ms when the provider omits the `interval` field (Qwen) or derived from `interval × 1000` (Codex).
3. Inner displays the verification URL and user code in the TUI. User visits URL, enters code.
4. Host begins polling the token endpoint in the background (Qwen: `pollForToken()` with PKCE verifier; Codex: `pollForDeviceToken()` → `completeDeviceAuth()` with server-generated PKCE verifier).
5. Inner polls for completion via `oauth_poll` with `{session_id}` — returns `{status: "pending", pollIntervalMs}` while polling, `{status: "complete", access_token, expiry, token_type, scope}` on success, or `{status: "error", code, error}` on failure.
6. On success, host stores full token in `KeyringTokenStore`. Inner receives sanitized metadata.

**Browser redirect flow (Codex primary):**
1. Host creates a `CodexDeviceFlow` instance and calls `buildAuthorizationUrl(redirectUri, state)`, which generates PKCE internally. Host starts a temporary localhost HTTP server to receive the redirect.
2. Proxy returns `{auth_url, session_id, flow_type: "browser_redirect"}` to inner. Inner displays the auth URL.
3. User opens URL in host browser, authorizes. Browser redirects to host localhost; host captures the code automatically and calls `exchangeCodeForToken(code, redirectUri, state)`.
4. Inner polls for completion via `oauth_poll` with `{session_id}` — same response semantics as device code flow.
5. On success, host stores full token. Inner receives sanitized metadata.

**Key protocol property:** All flows use only request/response operations — the server never sends unsolicited messages. For device code and browser redirect flows, the inner process polls via `oauth_poll` rather than waiting for a server push. The `oauth_poll` "pending" response includes a `pollIntervalMs` field (derived from the RFC 8628 `interval` for device code flows, or a 2000ms default for browser_redirect flows) so the inner process knows how frequently to poll.

**Inner-side adapter:** In proxy mode, the inner process's `/auth login` command uses a `ProxyOAuthAdapter` class instead of calling `OAuthManager.login()` directly. The adapter drives the multi-step proxy protocol (initiate → display URL → exchange/poll → return token) while presenting the same TUI experience as direct-mode login. See the technical specification §10a for details.

**Note on `save_token` interaction**: After login completes (via `oauth_exchange` or `oauth_poll`), the host proxy stores the full token directly. The inner process's `OAuthManager` may subsequently call `ProxyTokenStore.saveToken()` as part of its normal post-login flow — since the token it holds is already sanitized (no refresh_token), this is a harmless idempotent write. The `save_token` handler enforces the trust boundary by stripping any `refresh_token` from the incoming payload before processing, then merges the remaining fields (preserving the existing stored `refresh_token`). This avoids requiring changes to `OAuthManager`'s post-login logic in proxy mode.

### Logout

1. Inner sends `remove_token` to proxy.
2. Host proxy deletes the token from `KeyringTokenStore` (best-effort).
3. Inner receives acknowledgment.

### API Key Read

1. Inner sends `get_api_key` to proxy with key name.
2. Host proxy reads the key from `ProviderKeyStorage`.
3. Host proxy returns the key value.

### Shutdown

1. Sandbox exits (normal exit, SIGINT, or SIGTERM).
2. Host proxy closes the socket, removes the socket file.
3. Proactive renewal timers are cancelled.
4. Ephemeral PKCE sessions are cleaned up.
5. Stale socket files are removed on startup (PID reuse protection).

## 4. User-Visible Behaviors

### Successful Operations

| Action | Sandbox User Experience |
|---|---|
| API call requiring OAuth | Token retrieved transparently via proxy. No visible difference from non-sandbox. |
| Token near expiry | Host refreshes automatically. Inner receives new access_token. No user interaction. |
| `/auth login anthropic` | Authorization URL displayed in sandbox TUI. User opens in host browser, authorizes, pastes code. "Successfully authenticated." |
| `/auth status` | Shows provider, auth state, expiry countdown. Same output as non-sandbox. |
| `/auth logout gemini` | "Logged out of gemini." Token removed from host keyring. |
| `--key` flag (API key auth) | API key retrieved from host via proxy. No visible difference. |

### Error Scenarios

| Scenario | User Experience |
|---|---|
| Proxy connection lost (host crash, socket error) | Error: "Credential proxy connection lost. Restart the session." No auto-reconnect — this is a security decision (reconnecting could reach a spoofed socket). **Idle-timeout reconnect is distinct**: when the 5-minute idle timer fires with no error, the CLIENT initiates a graceful close. On the next operation, the client establishes a fresh connection with a new handshake. This is safe because the client is in control and the close was expected — unlike a server crash or socket error where reconnecting could reach a spoofed socket. |
| Socket file missing/inaccessible at startup | Error: "Cannot connect to credential proxy. Ensure sandbox was started correctly." |
| Version mismatch (client/server from different builds) | Error: "Credential proxy version mismatch. Restart the session." |
| Token refresh fails (transient network error) | **On-demand retry** (for `refresh_token` proxy operations): Host retries up to 2 times with exponential backoff (1s, 3s). If all fail, inner receives `INTERNAL_ERROR`. **Proactive renewal retry** (for background scheduled renewals): uses longer backoff (base 30s, doubling up to 30min cap, max 10 consecutive failures per `scheduleProactiveRetry` in OAuthManager) since the user isn't blocking on the result. These are distinct mechanisms. |
| Token refresh fails (auth error: 401, invalid_grant) | No retry. Force re-auth: user must `/auth login` again. |
| Login session timeout (10 minutes) | Error: "Login session expired. Run `/auth login` again." |
| Login session reuse attempt | Error: "Login session already used." Prevents replay attacks. |
| Provider not configured for profile | Error: "Provider not available for this profile." (Profile scoping.) |
| Rate limited (> 60 req/s) | Error with `RATE_LIMITED` code. Temporary — operations succeed after brief pause. |
| Host keyring locked | Error: "Keyring is locked. Unlock your keyring on the host and retry." |

## 5. Detection Mechanism

The proxy mode is activated by a single environment variable:

| Condition | Behavior |
|---|---|
| `LLXPRT_CREDENTIAL_SOCKET` is set | Use `ProxyTokenStore` and `ProxyProviderKeyStorage` — all credential operations go through the Unix socket |
| `LLXPRT_CREDENTIAL_SOCKET` is not set | Use `KeyringTokenStore` and `ProviderKeyStorage` directly — same as today |

This detection happens at the credential store instantiation sites. The calling code (OAuthManager, auth commands, key commands) does not know whether it's talking to a proxy or a real store — it programs against the `TokenStore` and provider key interfaces.

## 6. Security Model

### What the Proxy Defends Against

| Threat | Mitigation |
|---|---|
| Refresh token theft via container escape | refresh_token never crosses the socket boundary. Inner process never sees it. |
| PKCE secret theft | PKCE verifier/challenge generated and consumed on host only. Never sent to inner as standalone fields. **Anthropic caveat**: Anthropic's `initiateDeviceFlow()` embeds the PKCE verifier as the `state` query parameter in `verification_uri_complete` (see `anthropic-device-flow.ts` L74-75: `this.state = verifier`). The auth URL IS displayed in the inner TUI (the user must open it), so the verifier is visible in the URL string. However, it is not sent as an actionable field — the inner process has no API to extract or use the verifier from the URL. Compensating controls: session single-use, peer binding, 10min timeout. |
| Socket hijacking by another process | Socket permissions `0o600`, dedicated subdirectory with `0o700` permissions (`/tmp/llxprt-cred-{uid}/`), cryptographic nonce in path. On Linux: `SO_PEERCRED` provides strong UID verification. On macOS: `LOCAL_PEERPID` provides best-effort PID verification (weak across VM boundaries — see tech spec); compensated by nonce, socket perms, single-use sessions, and short session TTL. |
| Cross-sandbox credential leakage | Socket is per-sandbox-instance with unique PID+nonce path. |
| Replay attack on login sessions | Session IDs are single-use and bound to authenticated peer identity (strong on Linux via UID, best-effort on macOS via PID — see tech spec for compensating controls). |
| Refresh token abuse via rapid refresh requests | Rate limiting: max 1 refresh per provider:bucket per 30 seconds. Concurrent requests deduplicated. |
| Slowloris resource exhaustion | Partial frame timeout: 5 seconds after receiving frame header without payload. |
| Memory exhaustion from abandoned logins | Stale session garbage collection every 60 seconds. Sessions expire after 10 minutes. |
| Credential requests for unauthorized providers | Profile scoping: proxy only serves credentials for providers/buckets allowed by the loaded profile. |

### What the Proxy Does NOT Defend Against

- Inner process can make API calls using a valid access_token (this is by design — the inner process needs to call APIs).
- Inner process can request fresh access_tokens via the proxy (mitigated by rate limiting and audit logging). The damage window is limited to the access_token lifetime (~1 hour for most providers).
- On macOS, a same-user process that guesses the socket path (PID + 4-byte nonce = 32-bit entropy) could connect. Compensating controls: `0o600`/`0o700` perms (same-user only), no persistent sessions (attacker can read tokens but not obtain refresh_tokens), rate limiting, audit logging. Accepted risk — same-user isolation is an OS-level concern.
- Inner process can overwrite `access_token` and `expiry` via `save_token` (refresh_token is stripped, so the high-value credential is safe). This means a compromised container could rotate an access_token to one it controls — impact is limited to the remaining token lifetime and is visible in audit logs.
- A full API proxy (host makes ALL provider calls on behalf of inner) would provide complete isolation — that is future work beyond this epic.

### Audit Logging

All credential operations are logged at debug level: operation type, provider, bucket — no secret values. Auth artifacts — refresh_token, authorization codes, PKCE verifiers/challenges, OAuth state parameters, device codes, and full session IDs — are NEVER logged at any level, even trace. Debug/trace logs may reference operations by provider:bucket and **truncated** identifiers (e.g., first 8 characters of a session ID hex string, truncated token hashes) for correlation, but never the full secret values.

## 7. Protocol Overview

Communication uses length-prefixed framed JSON over a Unix domain socket. Each frame is: 4 bytes (uint32 big-endian length) followed by the JSON payload. Maximum message size: 64KB.

### Handshake

On connection, the client sends a version handshake. The server responds with the negotiated version or rejects incompatible versions.

### Operations

| Operation | Purpose | Response Contains |
|---|---|---|
| `get_token` | Read OAuth token for provider+bucket | Sanitized token: access_token, expiry, token_type, scope, provider-specific fields. Never refresh_token. |
| `save_token` | Store token after auth | Acknowledgment |
| `remove_token` | Delete token (logout) | Acknowledgment |
| `list_providers` | Enumerate authenticated providers | String array of provider names |
| `list_buckets` | Enumerate buckets for a provider | String array of bucket names |
| `get_api_key` | Read API key by name | Key value string |
| `list_api_keys` | Enumerate stored API key names | String array of key names |
| `refresh_token` | Trigger host-side refresh | Sanitized token metadata (same as get_token). Never refresh_token. |
| `oauth_initiate` | Start host-side OAuth login | Session ID + flow-type-specific fields: `auth_url` (PKCE, browser redirect), `verification_url` + `user_code` + `pollIntervalMs` (device code). Always includes `flow_type`. Note: the proxy protocol uses `verification_url` (matching the `oauth_initiate` response schema); the underlying RFC 8628 / provider responses use `verification_uri`. The proxy maps between the two. |
| `oauth_exchange` | Complete PKCE login with auth code | Sanitized token metadata. Never refresh_token, never PKCE secrets. Only for `pkce_redirect` flows. |
| `oauth_poll` | Poll for login completion | Always `ok: true` at protocol level. Response `data` contains `status` discriminator: `"pending"` (includes `pollIntervalMs` — recommended client poll interval), `"complete"` (includes access_token, expiry, token_type, scope — never refresh_token), or `"error"` (includes code, error). For device code and browser redirect flows. |
| `oauth_cancel` | Cancel an in-progress login session | Acknowledgment |

**Flow type / operation validation:** `oauth_exchange` is valid only for sessions with `flow_type: "pkce_redirect"`. `oauth_poll` is valid only for sessions with `flow_type: "device_code"` or `"browser_redirect"`. If a client sends the wrong operation for a session's flow type (e.g., `oauth_poll` on a `pkce_redirect` session, or `oauth_exchange` on a `device_code` session), the server returns `INVALID_REQUEST` with a message indicating the operation/flow-type mismatch.

**Error channel note for `oauth_poll`:** This operation uses two distinct error channels. A protocol-level error (`ok: false`) indicates a proxy infrastructure problem (session not found, rate limited, etc.) and carries an error code. An application-level error (`ok: true, data.status: "error"`) indicates the underlying OAuth flow failed (user denied, device code expired, etc.) — the poll request itself succeeded, but the thing being polled for has failed. This is analogous to HTTP 200 with an application-level error body.

### Error Codes

| Code | Meaning |
|---|---|
| `NOT_FOUND` | Requested credential does not exist |
| `INVALID_REQUEST` | Malformed request (missing fields, wrong types) |
| `RATE_LIMITED` | Too many requests (60 req/s global, 1 refresh/30s per provider:bucket) |
| `UNAUTHORIZED` | Requested provider/bucket not allowed by loaded profile |
| `INTERNAL_ERROR` | Host-side operation failed (keyring error, network error during refresh) |
| `UNKNOWN_VERSION` | Protocol version mismatch |
| `SESSION_NOT_FOUND` | OAuth session ID doesn't exist |
| `SESSION_EXPIRED` | OAuth session timed out (10 minutes) |
| `SESSION_ALREADY_USED` | OAuth exchange already attempted for this session |
| `EXCHANGE_FAILED` | Provider code exchange failed |
| `PROVIDER_NOT_FOUND` | Requested provider is not configured |

## 8. Timeout Taxonomy

| Timeout | Duration | Purpose |
|---|---|---|
| Per-request (client-side) | 30 seconds | Limits how long inner waits for any single proxy response |
| Idle connection | 5 minutes | Closes connection after inactivity, re-established on next request |
| Host-side request processing | 15 seconds | Limits simple host-side operations (keyring read/write/delete/list, API key read/list) before returning `INTERNAL_ERROR`. OAuth exchanges and refresh operations also use 15s per individual network call, but the overall operation (including retries) may take longer — bounded by the 30s client-side timeout. |
| Partial frame | 5 seconds | Closes connection if frame header received but payload doesn't arrive |
| OAuth session | 10 minutes | Login sessions expire (configurable via `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS`) |
| Refresh rate limit | 30 seconds | Minimum interval between refreshes for the same provider:bucket. If token still valid during cooldown, returns current token. If token expired during cooldown, returns `RATE_LIMITED` with `retryAfter` seconds. |

## 9. Multi-Instance Behavior

### Multiple Sandbox Sessions

Each sandbox gets its own `CredentialProxyServer` with a unique socket (different PID, different nonce). There is no cross-instance communication. Both proxies talk to the same underlying `KeyringTokenStore` on the host, which uses file-based advisory locks for refresh coordination.

### Sandbox + Non-Sandbox Coexistence

A sandbox proxy and a non-sandbox CLI instance running simultaneously both access the same `KeyringTokenStore`. The existing file-based advisory lock mechanism prevents concurrent refresh races between them.

## 10. Acceptance Criteria (from Issues)

### From #1358 (Credential Proxy)

- Host process creates and listens on Unix socket before container starts
- Inner process requests tokens and API keys through the socket
- `ProxyTokenStore` implements full `TokenStore` interface via socket
- `ProxyProviderKeyStorage` implements provider key interface via socket
- Protocol version handshake on connection; incompatible versions rejected
- Length-prefixed framing handles messages correctly (no newline sensitivity)
- Max message size enforced (64KB) with bounds check before allocation
- Partial frame timeout (5s) prevents resource exhaustion
- Per-operation request schema validation on server side
- Socket path includes cryptographic nonce
- Socket cleaned up on normal exit, SIGINT, and SIGTERM
- Stale socket files cleaned up on startup
- Peer credential verification on Linux (SO_PEERCRED) and macOS (LOCAL_PEERPID), documented fallback
- Profile scoping enforced — cannot request credentials outside loaded profile
- Rate limiting: 60 req/s per connection
- Per-request timeout: 30s
- Error handling for: socket connection failure, malformed requests, timeout, rate limiting
- Works with both Docker and Podman sandbox modes
- **Decision gate — platform support matrix**: The following must pass before merge:

  | Platform | Container Runtime | UDS Status | Gate |
  |---|---|---|---|
  | Linux | Docker | Native UDS | Must pass |
  | Linux | Podman | Native UDS | Must pass |
  | macOS | Docker Desktop (VirtioFS) | UDS across VM boundary — may not work | Must pass OR fallback transport designed and implemented |
  | macOS | Podman (podman machine) | UDS across VM boundary | Must pass OR fallback transport designed and implemented |

  If macOS Docker Desktop UDS does not work, the fallback options are: (a) TCP localhost with TLS + auth token, or (b) a dedicated socket-forwarding shim similar to SSH agent forwarding in `sandbox.ts`. The fallback must be chosen and prototyped before Phase B ships.
- Non-sandbox mode is unaffected
- Hard error on proxy connection loss (no silent failures, no auto-reconnect)

### From #1359 (Host-Side OAuth Refresh)

- `get_token` responses never contain refresh_token
- `refresh_token` operation triggers host-side refresh and returns sanitized token metadata
- Token merge contract implemented explicitly
- Refresh retry with backoff: 2 retries on transient errors, no retry on auth errors
- Refresh lock prevents concurrent refreshes across proxy instances
- Double-check pattern prevents unnecessary refreshes
- Proactive renewal timer runs on host side with jittered scheduling
- Proactive renewal timer cancelled on sandbox exit
- Sleep/suspend recovery: timer re-checks wall-clock time on fire
- Rate limiting on refresh: max 1 per provider:bucket per 30 seconds
- Concurrent refresh requests for same provider:bucket deduplicated
- Concurrent refresh + logout: logout wins after refresh completes
- refresh_token never present in any data crossing the socket
- Auth artifacts (refresh_token, auth codes, PKCE secrets, device codes, session IDs) never logged at any level
- Works for all OAuth providers (Anthropic, Gemini, Qwen, Codex)
- Non-sandbox mode unaffected

### From #1360 (Host-Side OAuth Login)

- `/auth login` in Docker/Podman sandbox completes via proxy
- Auth URL displayed in inner TUI; user pastes code back
- Code exchange on host side; tokens stored in host keyring
- PKCE state + OAuth state parameter verified during exchange
- Inner process receives only sanitized token metadata
- PKCE verifier/challenge never exposed to inner process
- Session IDs are cryptographically random (128 bits)
- Session IDs are single-use (replay prevention)
- Session IDs bound to authenticated client identity (peer credential)
- Session timeout: 10 minutes (configurable)
- Expired sessions return `SESSION_EXPIRED`
- Reused sessions return `SESSION_ALREADY_USED`
- Stale session GC runs periodically; prevents memory leaks
- Multiple concurrent login attempts get independent sessions
- `oauth_cancel` cleans up session immediately
- Works for all OAuth providers
- Seatbelt mode unaffected
- Non-sandbox mode unaffected

## 11. Deliberate Divergences from Issue Text

| Issue Claim | Spec Correction | Reason |
|---|---|---|
| #1358: Socket path `/tmp/llxprt-cred-{pid}-{nonce}.sock` | Spec uses `{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock` with per-user `0o700` subdirectory | Adds UID-based directory isolation as defense-in-depth. Prevents other users from listing/guessing socket paths. Uses `{tmpdir}` (via `realpathSync`) instead of hardcoded `/tmp/` for macOS compatibility. |
| #1359: "Calls `provider.refreshToken(currentToken.refresh_token)` against the token endpoint" | Spec says `provider.refreshToken(currentToken)` — full OAuthToken, not just the refresh_token string | The actual `OAuthProvider.refreshToken()` signature takes a full `OAuthToken` object, not a bare string. See `oauth-manager.ts` line 206. |
| #1358: Error codes list (6 codes) | Spec adds 5 additional session/OAuth error codes: `SESSION_NOT_FOUND`, `SESSION_EXPIRED`, `SESSION_ALREADY_USED`, `EXCHANGE_FAILED`, `PROVIDER_NOT_FOUND` | Issue #1358's error list covers only the proxy transport layer. The additional codes come from #1360's session management requirements. Combined delivery means the error taxonomy covers all three issues. |
| #1358/#1360: Login flow described as pure PKCE | Spec distinguishes three provider flow types: PKCE code-paste (Anthropic, Gemini), device code (Qwen, Codex fallback), and browser redirect (Codex primary). Adds `oauth_poll` operation (not in issues) for device code and browser redirect flows. | Each provider uses a different OAuth mechanism. Anthropic uses `initiateDeviceFlow()` for PKCE code-paste. Codex has two flows: `buildAuthorizationUrl()` + host localhost redirect (primary), and `requestDeviceCode()` + `pollForDeviceToken()` device authorization (fallback when localhost unreachable). Qwen uses device code flow WITH PKCE (`code_challenge` + `S256` in device request, `code_verifier` during polling). Gemini in sandbox uses `authWithUserCode()` (decomposable PKCE code-paste) — NOT the monolithic `getOauthClient()` which writes to stdout, installs globals, and manages browser interaction. The `oauth_poll` operation maintains the protocol's strictly request/response contract — no server push needed. |
| #1359: Proactive renewal "buffer" | Spec uses `max(300s, remainingLifetime × 0.1) + jitter` instead of a fixed buffer | Matches the actual `OAuthManager.scheduleProactiveRenewal()` algorithm at `oauth-manager.ts` lines 1247–1256. A fixed 60s buffer would be too aggressive for 1-hour tokens. |
| #1359: "Second request within [rate limit] window returns cached result" | Spec returns current token if still valid, but returns `RATE_LIMITED` with `retryAfter` if token is expired | Prevents the inner process from entering a tight retry loop requesting refresh of an expired token. Returning an expired token would cause the caller to immediately request another refresh. |
| (Implicit) API key management in sandbox | `ProxyProviderKeyStorage` is **read-only**: `saveKey()` and `deleteKey()` throw with "API key management is not available in sandbox mode. Manage keys on the host." Only `getKey()`, `listKeys()`, and `hasKey()` are proxied. | API key management (save/delete) is an administrative action that should happen on the host. The inner process only needs to read keys. Making write operations throw prevents accidental or malicious key modification from within the sandbox. |
