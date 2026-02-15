# Technical Specification: Credential Proxy for Sandbox

**Issues**: #1358 (Credential proxy — Unix socket IPC), #1359 (Host-side OAuth refresh), #1360 (Host-side OAuth login for sandbox)
**Epic**: #1349 — Unified Credential Management, Phase B
**Depends on**: Phase A complete (#1351 KeyringTokenStore, #1352 Wire as Default, #1353 ProviderKeyStorage)
**Status**: Specification — describes the technical design, not implementation steps
**Codebase verified against**: commit `9e02ee8b5` on branch `issue1358-1360`. Line numbers and signatures referenced in this document were verified at this commit; they may drift as the codebase evolves.

---

## Project Principles

- **Combined delivery.** #1358, #1359, #1360 ship together. The proxy (#1358) without refresh stripping (#1359) is insecure; host-side login (#1360) requires the proxy.
- **Refresh tokens never cross the boundary.** Stripping happens at the proxy server layer, not in the storage layer.
- **No auto-reconnect.** Proxy connection loss is a hard error.
- **Non-sandbox and seatbelt modes are unaffected.**
- **#1357 is separate.** Settings directory is still mounted; removing that mount is follow-up work.

---

## 1. Architecture

```
Host process                                    Container process
┌─────────────────────────────┐                ┌─────────────────────────────┐
│       start_sandbox()       │                │     Inner llxprt-code       │
│                             │                │                             │
│  ┌───────────────────────┐  │   Unix socket  │  ┌───────────────────────┐  │
│  │ CredentialProxyServer │◄─┼────────────────┼──┤ ProxyTokenStore       │  │
│  │                       │  │   framed JSON  │  │ (TokenStore impl)     │  │
│  │ ┌─ KeyringTokenStore  │  │                │  └───────────────────────┘  │
│  │ ┌─ ProviderKeyStorage │  │                │                             │
│  │ ┌─ OAuthProvider[]    │  │                │  ┌───────────────────────┐  │
│  │ ┌─ PKCESessionStore   │  │                │  │ ProxyProviderKey      │  │
│  │ ┌─ RefreshCoordinator │  │                │  │ Storage               │  │
│  │ ┌─ ProactiveScheduler │  │                │  └───────────────────────┘  │
│  └───────────────────────┘  │                │                             │
└─────────────────────────────┘                └─────────────────────────────┘
                                                env: LLXPRT_CREDENTIAL_SOCKET
```

The proxy creates a clean trust boundary: the inner process programs against the same `TokenStore` and provider key interfaces, but all operations are mediated by the host proxy which enforces token stripping, profile scoping, rate limiting, and session management.

## 2. Detection and Instantiation

### Environment Variable

```
LLXPRT_CREDENTIAL_SOCKET={tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock
```

When this variable is set, credential store instantiation sites create proxy implementations instead of direct-access stores.

### Current Instantiation Sites (from Phase A)

These sites currently create `KeyringTokenStore` or use `getProviderKeyStorage()`:

| File | Current Code | Proxy Mode |
|---|---|---|
| `packages/cli/src/ui/commands/authCommand.ts` (lines 37, 659) | `new KeyringTokenStore()` | `new ProxyTokenStore(socketPath)` |
| `packages/cli/src/providers/providerManagerInstance.ts` (line 242) | `new KeyringTokenStore()` | `new ProxyTokenStore(socketPath)` |
| `packages/cli/src/runtime/runtimeContextFactory.ts` (lines 262–263) | `new KeyringTokenStore()` | `new ProxyTokenStore(socketPath)` |
| `packages/cli/src/ui/commands/profileCommand.ts` (lines 100, 347) | `new KeyringTokenStore()` | `new ProxyTokenStore(socketPath)` |
| `packages/cli/src/ui/commands/keyCommand.ts` | `getProviderKeyStorage()` | `new ProxyProviderKeyStorage(socketPath)` |

### Factory Pattern

A factory function centralizes the detection logic:

```typescript
function createTokenStore(): TokenStore {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (socketPath) {
    return new ProxyTokenStore(socketPath);
  }
  return new KeyringTokenStore();
}
```

Similarly for provider key storage (using the extracted interface):

```typescript
function createProviderKeyStorage(): ProviderKeyStorageInterface {
  const socketPath = process.env.LLXPRT_CREDENTIAL_SOCKET;
  if (socketPath) {
    return new ProxyProviderKeyStorage(socketPath);
  }
  return getProviderKeyStorage();
}
```

The factory functions are called once per process. The returned instances are shared across all callers (same shared-instance pattern as today's `KeyringTokenStore`).

## 3. Unix Socket IPC

### Socket Path

```
{tmpdir}/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock
```

- `{tmpdir}`: `fs.realpathSync(os.tmpdir())` — resolves macOS symlinks
- `{uid}`: current user's UID — ensures per-user isolation
- `{pid}`: host process PID (for human debugging, not security)
- `{nonce}`: 8 hex characters from `crypto.randomBytes(4)` — prevents PID-guessing attacks

### Socket Permissions

| Path | Permissions | Purpose |
|---|---|---|
| `/tmp/llxprt-cred-{uid}/` | `0o700` | Per-user subdirectory — only owning user can list/traverse |
| Socket file (inside subdirectory) | `0o600` | Only owning user can connect |

The socket lives in a per-user subdirectory of `os.tmpdir()`: `/tmp/llxprt-cred-{uid}/llxprt-cred-{pid}-{nonce}.sock`. The subdirectory is created with `mkdirSync(dir, { mode: 0o700, recursive: true })` and the socket permissions are set with `fs.chmodSync(socketPath, 0o600)`. On startup, if a socket file already exists at the generated path (PID reuse), it is removed before binding (stale socket cleanup).

### Socket Mounting

The socket file lives in a subdirectory of `os.tmpdir()`, which is already volume-mounted into the container (see `sandbox.ts` line 1025: `args.push('--volume', \`${os.tmpdir()}:${getContainerPath(os.tmpdir())}\`)`). No additional volume mount is needed. The `LLXPRT_CREDENTIAL_SOCKET` env var contains the host-side path (e.g., `/private/var/folders/.../llxprt-cred-{uid}/...`). This path is accessible inside the container because the host's `os.tmpdir()` directory is volume-mounted at the same absolute path (on macOS/Linux where `getContainerPath` is identity). The container process's own `os.tmpdir()` call would return `/tmp`, which is a different path — but the inner process reads the socket path from the env var, not from `os.tmpdir()`.

The `LLXPRT_CREDENTIAL_SOCKET` env var is passed to the container via `args.push('--env', \`LLXPRT_CREDENTIAL_SOCKET=${socketPath}\`)`.

**macOS path resolution** (**required code change**): On macOS, `os.tmpdir()` may return a path through `/var/` which is a symlink to `/private/var/`. To ensure the host-side socket path matches the container-side mount path, use `fs.realpathSync(os.tmpdir())` when constructing the socket path. **Additionally**, the existing `os.tmpdir()` volume mount in `sandbox.ts` (line 1025) must ALSO be changed to use `fs.realpathSync(os.tmpdir())` for both host and container path arguments — otherwise the container's mount would be at `/var/folders/.../T` but the socket at `/private/var/folders/.../T`, and the resolved path would not exist inside the container. This is a prerequisite code change to `sandbox.ts`, not just a new-code concern.

**Docker Desktop macOS VM boundary**: On macOS, Docker Desktop runs Linux containers in a VM (using VirtioFS or gRPC FUSE for file sharing). Unix domain sockets mounted across this VM boundary may not work depending on the Docker Desktop version and file sharing backend. This is a known limitation. Validation on Docker Desktop macOS is a required test matrix dimension. If Unix sockets do not traverse the VM boundary, a dedicated socket-forwarding volume mount or a TCP localhost fallback may be needed (similar to how SSH agent forwarding works in `sandbox.ts`). Podman on macOS has similar VM boundary considerations.

### Peer Credential Verification

After a client connects, the server verifies the peer identity using platform-specific socket options:

| Platform | Mechanism | Verified Field | Strength |
|---|---|---|---|
| Linux | `SO_PEERCRED` on the socket fd | UID matches server's UID | Strong — UID is reliable across PID namespaces |
| macOS | `LOCAL_PEERPID` on the socket fd | PID is a known container process | **Weak** — PID namespace translation across VM boundary (Docker Desktop) makes this unreliable. Treated as best-effort logging, not a security gate. |
| Other | N/A — log warning, proceed | None | Socket perms are the sole defense |

Peer credential verification is defense-in-depth, not a primary security boundary. On **all platforms**, the primary defenses are: (1) socket file permissions `0o600` in a `0o700` subdirectory, (2) cryptographic nonce in the socket path, (3) single-use session IDs for login flows, (4) short session TTL (10min). On **macOS specifically**, the weak PID-based verification means session binding guarantees rely on these compensating controls rather than peer identity matching.

## 4. Framing Protocol

### Wire Format

Each message is a frame: 4-byte uint32 big-endian length prefix, followed by a JSON payload of exactly that length.

```
┌──────────┬──────────────────────┐
│ 4 bytes  │   N bytes            │
│ uint32BE │   JSON payload       │
│ (N)      │                      │
└──────────┴──────────────────────┘
```

### Size Limits

- Maximum frame size: 64KB (65536 bytes)
- Before allocating a buffer for an incoming frame, the length prefix is validated against this limit. Oversized frames cause the connection to be closed with an error.

### Partial Frame Protection

If a frame header (4 bytes) is received but the full payload doesn't arrive within 5 seconds, the connection is closed. This prevents slowloris-style resource exhaustion.

### Handshake

The first frame on a new connection is a version handshake:

**Client → Server:**
```json
{"v": 1, "op": "handshake", "payload": {"minVersion": 1, "maxVersion": 1}}
```

**Server → Client (success):**
```json
{"v": 1, "op": "handshake", "ok": true, "data": {"version": 1}}
```

**Server → Client (incompatible):**
```json
{"v": 1, "op": "handshake", "ok": false, "error": "Unsupported version", "code": "UNKNOWN_VERSION"}
```

After a failed handshake, the server closes the connection.

### Request/Response Format

All post-handshake frames carry a request ID for correlation:

**Request (client → server):**
```json
{"v": 1, "id": "req-001", "op": "<operation>", "payload": {...}}
```

**Success response (server → client):**
```json
{"v": 1, "id": "req-001", "ok": true, "data": {...}}
```

**Error response (server → client):**
```json
{"v": 1, "id": "req-001", "ok": false, "error": "Human-readable message", "code": "ERROR_CODE"}
```

Request IDs are client-generated. The server echoes them in responses. The protocol is strictly request-response — the server never sends unsolicited messages.

## 5. Operations

### Token Operations

| Operation | Payload | Response `data` | Notes |
|---|---|---|---|
| `get_token` | `{provider, bucket}` | `{access_token, expiry, token_type, scope?, ...}` | **Never** includes `refresh_token`. Includes provider-specific fields (e.g., Codex `account_id`). |
| `save_token` | `{provider, bucket, token}` | `{}` | Accepts tokens from inner. **Security invariant**: The `save_token` handler strips any `refresh_token` field from the incoming token payload before processing — the inner process is never authorized to set a `refresh_token` via the proxy. After stripping, the proxy acquires the refresh lock for the provider:bucket, reads the existing stored token, merges (applying all incoming fields but preserving the existing stored `refresh_token`), saves the merged result, and releases the lock. This lock acquisition prevents races with concurrent `refresh_token` operations and `remove_token` (logout). **Lock note**: This lock acquisition is only for external `save_token` requests from the inner process; the `refresh_token` handler's internal `KeyringTokenStore.saveToken()` call occurs while already holding the lock and does NOT go through the `save_token` handler — it calls `KeyringTokenStore.saveToken()` directly. This ensures `OAuthManager`'s post-login `saveToken()` calls are harmless — the host already stored the full token during `oauth_exchange`, and a subsequent save of the sanitized token preserves that refresh_token. **Edge case**: If `save_token` is called for a provider:bucket with no existing stored token, the incoming (sanitized) token is stored as-is — with no `refresh_token`. This produces a usable but non-refreshable token. In practice, this edge case does not occur: tokens only enter the system via login (`oauth_exchange`/`oauth_poll` stores the full token on the host first) or via direct keyring access (non-proxy mode). |
| `remove_token` | `{provider, bucket}` | `{}` | Best-effort deletion. Errors logged but success returned. |
| `list_providers` | `{}` | `{providers: string[]}` | Returns empty array on storage errors (degraded). |
| `list_buckets` | `{provider}` | `{buckets: string[]}` | Returns empty array on storage errors (degraded). |
| `refresh_token` | `{provider, bucket}` | `{access_token, expiry, token_type, scope?, ...}` | Triggers host-side refresh (see §6). **Never** includes `refresh_token`. |

### API Key Operations

| Operation | Payload | Response `data` | Notes |
|---|---|---|---|
| `get_api_key` | `{name}` | `{key: string}` | Returns `NOT_FOUND` if key doesn't exist. |
| `list_api_keys` | `{}` | `{keys: string[]}` | Returns empty array on storage errors. |

### OAuth Login Operations (Host-Side)

| Operation | Payload | Response `data` | Notes |
|---|---|---|---|
| `oauth_initiate` | `{provider, bucket}` | `{session_id, flow_type, auth_url?, verification_url?, user_code?, pollIntervalMs?}` | Returns `flow_type` ("pkce_redirect", "device_code", or "browser_redirect"). PKCE code-paste flows (Anthropic, Gemini) include `auth_url`. Device code flows (Qwen, Codex fallback) include `verification_url` + `user_code` + `pollIntervalMs`. Browser redirect flows (Codex primary) include `auth_url`. Session ID is 32 hex chars (128 bits). |
| `oauth_exchange` | `{session_id, code}` | `{access_token, expiry, token_type, scope?, ...}` | For `pkce_redirect` flows only. Host validates session, exchanges code with stored PKCE verifier, stores token. **Never** includes `refresh_token` or PKCE secrets. |
| `oauth_poll` | `{session_id}` | `{status, pollIntervalMs?, access_token?, expiry?, token_type?, scope?, code?, error?}` | For `device_code` and `browser_redirect` flows. Returns `status: "pending"` with `pollIntervalMs` (recommended client poll interval, from RFC 8628 `interval` field for device code flows, or 2000ms default for browser_redirect) while host is polling/waiting, `status: "complete"` with sanitized token metadata on success, or `status: "error"` with error details on failure. **Never** includes `refresh_token`. |
| `oauth_cancel` | `{session_id}` | `{}` | Cleans up session state immediately. Works for all flow types. |

### Request Schema Validation

Each operation has a defined request schema (required fields and types) validated on the server side before processing. Malformed requests return `INVALID_REQUEST` without touching any credential stores.

### Flow Type / Operation Validation

`oauth_exchange` and `oauth_poll` are each valid only for specific flow types:

| Operation | Valid flow types | Invalid flow types |
|---|---|---|
| `oauth_exchange` | `pkce_redirect` | `device_code`, `browser_redirect` |
| `oauth_poll` | `device_code`, `browser_redirect` | `pkce_redirect` |

If a client sends the wrong operation for a session's flow type (e.g., `oauth_poll` on a `pkce_redirect` session), the server returns `INVALID_REQUEST` with error message: "Operation {op} is not valid for flow type {flowType}. Use {correct_op} instead." This catches client-side bugs early rather than producing confusing downstream errors.

## 6. Host-Side Refresh (CredentialProxyServer)

### Refresh Flow

When the proxy receives a `refresh_token` operation:

1. Read full token (including `refresh_token`) from `KeyringTokenStore.getToken(provider, bucket)`.
2. If token is null → return `NOT_FOUND`.
3. If token has no `refresh_token` → return error (cannot refresh without refresh_token).
4. Acquire file-based advisory lock via `KeyringTokenStore.acquireRefreshLock(provider, {bucket})`.
5. Double-check: re-read token after lock. If token is now valid (another process refreshed) → release lock, return the valid token (sans refresh_token).
6. Call `provider.refreshToken(currentToken)` using the provider registry. **Note on delegation chain**: The proxy calls the `OAuthProvider.refreshToken(currentToken: OAuthToken)` interface method — NOT the raw device flow classes. Each provider's `OAuthProvider` implementation wraps the device flow class and extracts `currentToken.refresh_token` before calling the flow's `refreshToken(refreshToken: string)` method. This wrapping layer already exists (e.g., in the OAuth provider implementations). The proxy does not need to know about the inner delegation. **Gemini exception**: `GeminiOAuthProvider.refreshToken()` returns `null` — Gemini relies on `google-auth-library`'s internal `OAuth2Client` refresh mechanism. For Gemini, the proxy refresh handler must: (a) create an `OAuth2Client` and load stored credentials (including `refresh_token`) from `KeyringTokenStore` via `client.setCredentials(...)`, (b) call `client.getAccessToken()` which triggers the library's internal refresh when the access token is expired, (c) read the refreshed `Credentials` from `client.credentials` and convert to `OAuthToken` format using the Gemini Credentials Conversion rules in §8 (`expiry_date` ms → `expiry` s, defaults for `token_type`, etc.). This is a distinct code path from the other three providers and requires its own handler branch.
7. Merge new token with stored token per the Token Merge Contract subsection in overview.md §3.
8. Save merged token to `KeyringTokenStore.saveToken(provider, mergedToken, bucket)`.
9. Release lock.
10. Return sanitized token metadata (access_token, expiry, token_type, scope, provider-specific fields — never refresh_token).

### Refresh Retry and Backoff

If `provider.refreshToken()` fails:
- **Transient network error**: Retry up to 2 times with exponential backoff (1s, 3s).
- **Auth error (401, `invalid_grant`)**: Do NOT retry. The refresh_token is invalid. Return error to inner. User must `/auth login` again.
- **All retries exhausted**: Return `INTERNAL_ERROR` to inner.

### Refresh Rate Limiting

- Max 1 refresh per provider:bucket per 30 seconds.
- If inner requests refresh within the cooldown period:
  - **Token still valid**: Return the current token (sans refresh_token) — no refresh needed.
  - **Token expired**: Return `RATE_LIMITED` error with `retryAfter` metadata (seconds remaining in cooldown). This prevents the inner process from entering a tight retry loop requesting refresh of an expired token. The caller can either wait the indicated time or surface the error to the user.
- Concurrent refresh requests for the same provider:bucket are deduplicated: the second request waits for the first to complete rather than issuing a duplicate refresh. This is a natural consequence of the lock-based approach.

### Refresh + Logout Race

The `remove_token` proxy handler wraps the delete in lock acquisition — it acquires the advisory lock (via `acquireRefreshLock`) before calling `KeyringTokenStore.removeToken()`, then releases the lock. This ensures deterministic ordering with concurrent refresh operations.

If `remove_token` arrives while a refresh is in progress for the same provider:bucket:

1. Refresh holds the advisory lock.
2. `remove_token` handler attempts to acquire the same lock (waits for refresh to complete).
3. Refresh finishes — saves new token, releases lock.
4. `remove_token` handler acquires lock, deletes the token, releases lock.
5. Result: user's logout intent wins — the token is removed.

This is the normative algorithm. The lock-based ordering guarantees deterministic behavior without flags or race-prone heuristics. The only edge case is if the lock wait exceeds the per-request timeout (30s), in which case the `remove_token` operation returns `INTERNAL_ERROR` and the user retries.

### Token Sanitization

The `refresh_token` field is stripped from all responses that cross the socket:
- `get_token` responses
- `refresh_token` operation responses
- `oauth_exchange` responses
- Error responses (no token context included in errors)
- Debug log output (auth artifacts — refresh_token, authorization codes, PKCE verifiers/challenges, OAuth state parameters, device codes, and **full** session IDs — are NEVER logged, even at trace level; debug/trace logs may use **truncated** identifiers for correlation — e.g., first 8 characters of a session ID hex string, truncated token hashes — but never the full secret values)

**Error response sanitization**: In addition to token stripping, all error responses crossing the socket must be sanitized. Provider SDK error objects (e.g., from `axios`, `node-fetch`, or `google-auth-library`) can contain tokens, PKCE secrets, or authorization headers in nested fields like `error.config.headers.Authorization` or `error.response.data`. The proxy constructs error messages from known-safe fields only (`error.message`, `error.code`, HTTP status codes) and never serializes raw provider error objects into socket responses.

Stripping is implemented at the proxy server response boundary — a single function that takes a full `OAuthToken` and returns a sanitized copy:

```typescript
/**
 * SanitizedOAuthToken is OAuthToken with refresh_token removed, but ALL other
 * fields preserved — including provider-specific passthrough fields like
 * Codex account_id/id_token, Qwen resource_url, and any future extensions.
 *
 * Note: The OAuthToken TypeScript type (from z.infer<typeof OAuthTokenSchema>)
 * does not include provider-specific fields at the type level. However, at
 * runtime, KeyringTokenStore uses OAuthTokenSchema.passthrough().parse() which
 * preserves unknown fields. The runtime destructuring { refresh_token, ...rest }
 * preserves these extra properties. The & Record<string, unknown> reflects
 * this runtime reality.
 *
 * The type is: Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>
 */
type SanitizedOAuthToken = Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>;

function sanitizeTokenForProxy(token: OAuthToken): SanitizedOAuthToken {
  const { refresh_token, ...sanitized } = token;
  return sanitized;
}
```

This function is the ONLY place where token responses are constructed for the socket. All paths (get_token, refresh_token, oauth_exchange, oauth_poll) call it. Provider-specific fields (`account_id`, `id_token`, `resource_url`, etc.) are preserved by the destructuring spread — only `refresh_token` is removed.

## 7. Proactive Renewal (Host-Side)

### Scheduling

When `get_token` serves a token to the inner process, the proxy schedules a proactive renewal timer on the host (for providers that support refresh — see Gemini exception below):

- Lead time: `leadSec = Math.max(300, Math.floor(remainingSec * 0.1))` — 10% of remaining token lifetime with a 300-second floor. Jitter: `Math.floor(Math.random() * 30)` seconds (0–30s, random per timer).
- Fire time: `expiry - leadSec - jitterSec`. For a 1-hour token, this fires ~6.5 minutes before expiry. For a 10-minute token, this fires ~5 minutes before expiry (300s floor).
- This matches the existing `OAuthManager.scheduleProactiveRenewal()` algorithm (see `oauth-manager.ts` lines 1247–1256).
- Uses the same `setProactiveTimer` / `runProactiveRenewal` pattern as `OAuthManager` (see `oauth-manager.ts` lines 1175–1380). Timer cancellation uses `clearTimeout` on the stored timer reference, similar to `OAuthManager.clearAllTimers()` which clears all active proactive renewal timers (there is no standalone `clearProactiveRenewal` function — cancellation is inline `clearTimeout`).
- **Gemini exception**: Proactive renewal for Gemini tokens uses the `OAuth2Client`-based refresh path (see §6 Gemini exception) rather than `provider.refreshToken()`. The scheduling algorithm is identical; only the refresh execution path differs.

### Timer Lifecycle

| Event | Action |
|---|---|
| `get_token` serves a token | Schedule timer if not already scheduled for this provider:bucket |
| Timer fires | Re-check wall-clock time vs. expiry. If expired/near-expiry → refresh. If already refreshed → skip. |
| Successful refresh | Schedule next timer for the new expiry |
| Refresh failure | Schedule **proactive** retry with exponential backoff (base 30s, doubling up to 30min cap, max 10 consecutive failures — same as `scheduleProactiveRetry` in OAuthManager). This is distinct from the **on-demand** retry in §6 (2 retries, 1s/3s backoff) which applies to synchronous `refresh_token` proxy operations where the user is blocking on the result. |
| Sandbox exit | Cancel all timers |
| Machine sleep/suspend then wake | Timer fires late. Re-check wall-clock time. If token already expired → refresh immediately. If another process refreshed → skip. |

### Relationship to OAuthManager's Proactive Renewals

In non-sandbox mode, `OAuthManager` manages proactive renewals directly. In sandbox mode, the proxy takes over this responsibility.

**Hard rule**: When `LLXPRT_CREDENTIAL_SOCKET` is set (proxy mode), the inner process's `OAuthManager` MUST NOT schedule proactive renewal timers. All refresh triggers in proxy mode use the `refresh_token` proxy operation. The inner `OAuthManager` still calls `ProxyTokenStore.getToken()` which returns tokens, but it must skip the `scheduleProactiveRenewal()` call that normally follows a token read. This can be implemented by: (a) checking the env var in `OAuthManager` and skipping scheduling, or (b) having `ProxyTokenStore` return a flag that tells OAuthManager not to schedule, or (c) checking `tokenStore instanceof ProxyTokenStore`. Option (a) is simplest.

Without this rule, both the host proxy AND the inner OAuthManager would attempt proactive refresh — the inner's attempts would fail (lock no-ops, no refresh_token) but would generate unnecessary `refresh_token` RPC calls.

## 8. Host-Side OAuth Login (PKCESessionStore)

### Session Lifecycle

When `oauth_initiate` is received:

1. Look up the provider in the provider registry.
2. Create a **fresh provider flow class instance** for this session. Each session gets its own instance to avoid shared PKCE state between concurrent logins.
3. Initialize the flow — the provider's flow class generates PKCE internally:
   - **Anthropic**: Call `new AnthropicDeviceFlow(config)` then `flow.initiateDeviceFlow()` with **NO arguments** (uses console callback URI by default). Generates PKCE internally and returns a `DeviceCodeResponse` containing the auth URL in `verification_uri_complete`. Do NOT call `buildAuthorizationUrl(redirectUri)` — that method requires localhost redirectUri (rejects non-localhost at lines 160–167). **Security**: `device_code` field in the response IS the PKCE verifier — MUST NOT be returned to inner. Extract only `verification_uri_complete` as the auth URL.
   - **Codex (primary — browser_redirect)**: Call `new CodexDeviceFlow()` then `flow.buildAuthorizationUrl(redirectUri, state)` which calls `this.generatePKCE()` internally and stores the verifier keyed by `state`. The proxy starts a localhost HTTP server on the host; `redirectUri` is `http://localhost:{port}/callback`. Start background task to listen for redirect callback.
   - **Codex (fallback — device_code)**: Call `new CodexDeviceFlow()` then `flow.requestDeviceCode()` which returns `{device_auth_id, user_code, interval}`. Start background task to poll via `flow.pollForDeviceToken(deviceAuthId, userCode, interval)`. When authorized, server returns `{authorization_code, code_verifier, code_challenge}` — then call `flow.completeDeviceAuth(authorizationCode, codeVerifier, CODEX_CONFIG.deviceAuthCallbackUri)`.
   - **Qwen**: Call `new QwenDeviceFlow(config)` then `flow.initiateDeviceFlow()` which generates PKCE internally (calls `this.generatePKCE()`, sends `code_challenge` + `code_challenge_method: 'S256'` in the device code request) and returns `{verification_uri, user_code, device_code}`. The flow instance must be held for the duration of polling — `pollForToken()` sends `code_verifier: this.pkceVerifier`. Default poll interval: 5000ms when provider omits `interval` (Qwen).
   - **Gemini**: Create `OAuth2Client` → `client.generateCodeVerifierAsync()` → `client.generateAuthUrl({redirect_uri: 'https://codeassist.google.com/authcode', code_challenge_method: 'S256', code_challenge, ...})`. This decomposes the `authWithUserCode()` path (oauth2.ts line 259). **Implementation prerequisite**: Extract PKCE generation and code exchange from the monolithic `authWithUserCode()` function into reusable utilities (see Provider Delegation notes above).
4. Generate session ID: `crypto.randomBytes(16).toString('hex')` — 32 hex chars, 128 bits of entropy.
5. For device code and browser redirect flows, start background polling/processing immediately after session creation. Store results in the session's `result` field when complete.
6. Store session state:
   ```typescript
   {
     sessionId: string,
     provider: string,
     bucket: string,
     flowType: 'pkce_redirect' | 'device_code' | 'browser_redirect',
     flowInstance: AnthropicDeviceFlow | CodexDeviceFlow | ...,  // Holds PKCE state internally
     deviceCode?: string,       // Device code flows only
     pollIntervalMs?: number,   // Device code flows — server-specified poll interval
     abortController?: AbortController,  // For cancelling background polling
     result?: { token: OAuthToken } | { error: string, code: string },  // Set by background task
     createdAt: number,         // Date.now()
     peerIdentity: PeerInfo,    // UID (Linux) or PID (macOS) of the connecting client
     used: boolean              // starts false, set true on exchange/completion
   }
   ```
7. Return `{session_id, flow_type, ...}` with flow-type-specific fields (auth_url for PKCE, `verification_url` + `user_code` + `pollIntervalMs` for device code, auth_url for browser redirect). **Field name mapping**: Providers return `verification_uri` (per RFC 8628); the proxy maps this to `verification_url` in the protocol response.

**Key architectural decision**: PKCE verifiers and OAuth state parameters are generated and stored *within* the provider flow class instances, not externally by the proxy. The proxy creates and owns the flow instances; each session holds a reference to its dedicated instance. This matches how the providers are designed — they encapsulate their own cryptographic state.

### Session Validation (oauth_exchange)

When `oauth_exchange` is received with `{session_id, code}`:

1. Look up session by `session_id`.
2. If not found → `SESSION_NOT_FOUND`.
3. If `used === true` → `SESSION_ALREADY_USED` (replay prevention).
4. If `Date.now() - createdAt > sessionTimeoutMs` → `SESSION_EXPIRED`.
5. Verify peer identity matches the session creator (the same peer that called `oauth_initiate`).
6. Mark `used = true` (before exchange attempt — prevents concurrent use).
7. Call the session's flow instance to exchange the code for a token. The exchange call is provider-specific:
   - **Anthropic**: `flowInstance.exchangeCodeForToken(authCodeWithState)` — takes a single combined string (`code#state`). The flow instance holds the PKCE verifier internally.
   - **Codex**: `flowInstance.exchangeCodeForToken(code, redirectUri, state)` — takes three separate parameters. The flow instance looks up the stored PKCE verifier by `state`. (Only applies to `browser_redirect` flow; for `device_code` fallback, exchange happens automatically via `completeDeviceAuth()` during background polling.)
   - **Gemini**: Call `authWithCode(client, code, codeVerifier, redirectUri)` — takes the `OAuth2Client` instance, user-pasted code, PKCE verifier (type: `{ codeVerifier: string } | undefined` — extract the `codeVerifier` string from the full object returned by `generateCodeVerifierAsync()`), and redirect URI `'https://codeassist.google.com/authcode'`. **Return type**: `authWithCode()` returns `Promise<boolean>`, NOT the credentials directly. On success (`true`), the tokens are side-effected onto the `OAuth2Client` via `client.setCredentials(tokens)` internally. The proxy must read `client.credentials` after the call returns `true` to obtain the `Credentials` object. Convert `Credentials` to `OAuthToken` format (see Gemini Credentials Conversion below).
8. Validate received token with `OAuthTokenSchema.passthrough().parse()`.
9. Store full token (including refresh_token) in `KeyringTokenStore`.
10. Clean up session from PKCESessionStore (including the flow instance).
11. Return sanitized token metadata (no refresh_token, no PKCE secrets).

### Gemini Credentials Conversion

When converting Google `Credentials` (from `google-auth-library`) to `OAuthToken` format after `authWithCode()` or `client.getAccessToken()` refresh:

```typescript
// Credentials (google-auth-library) → OAuthToken mapping
const oauthToken: OAuthToken = {
  access_token: credentials.access_token!,
  // CRITICAL: Credentials.expiry_date is milliseconds since epoch;
  // OAuthToken.expiry is seconds since epoch.
  expiry: Math.floor(credentials.expiry_date! / 1000),
  token_type: credentials.token_type ?? 'Bearer',
  refresh_token: credentials.refresh_token ?? undefined,
  scope: credentials.scope ?? undefined,
};
```

Key differences:
- `credentials.expiry_date` → `oauthToken.expiry`: divide by 1000 and floor (ms → s)
- `credentials.token_type` → defaults to `'Bearer'` if not present (Google often omits it)
- `credentials.access_token` → direct mapping
- `credentials.refresh_token` → direct mapping (preserved on host, stripped before sending to inner)
- `credentials.scope` → direct mapping (may be undefined)
- `credentials.id_token` → NOT mapped (Google ID tokens are not used by llxprt)

This conversion is used in two places: (1) `oauth_exchange` handler for Gemini login, and (2) the Gemini-specific refresh path in the `refresh_token` handler (§6 Gemini exception).

### Session Properties

| Property | Value |
|---|---|
| ID generation | `crypto.randomBytes(16).toString('hex')` — 128 bits |
| Single-use | `used` flag set before exchange attempt |
| Peer-bound | Bound to peer credential (UID or PID), not raw connection object |
| Timeout | 10 minutes default, configurable via `LLXPRT_OAUTH_SESSION_TIMEOUT_SECONDS` |
| GC interval | Every 60 seconds, sweep and remove expired/used sessions |
| Storage | In-memory `Map<string, SessionState>` — not persisted |

### Why Peer-Bound to Identity, Not Connection

The issue specifies binding to the authenticated client identity (peer credential) rather than the raw socket connection object. This is because the user may close and reopen the TUI during the OAuth flow (the authorization takes time — user opens browser, authorizes, comes back). If the binding were to the socket connection, a reconnect would invalidate the session. Binding to the peer identity (UID/PID) is more robust.

### Provider Delegation

Each OAuth provider has its own endpoints and authentication mechanism. The proxy delegates to the appropriate provider based on the `provider` field in the request. There are two primary flow types (code-paste and device-code) used across four providers:

| Provider | Sandbox Flow Type | Auth Mechanism | Code Exchange |
|---|---|---|---|
| Anthropic | `pkce_redirect` (code-paste) | `new AnthropicDeviceFlow(config)` → `flow.initiateDeviceFlow()` with **NO arguments** (defaults to console callback URI `https://console.anthropic.com/oauth/code/callback`). Generates PKCE internally, returns `DeviceCodeResponse` with `verification_uri_complete` (the auth URL users visit). Do NOT call `buildAuthorizationUrl(redirectUri)` — that method requires a localhost redirect URI (rejects non-localhost at lines 160–167) and is for the non-proxy flow. **Security warning**: `device_code` field in the response IS the PKCE verifier — MUST NOT be returned to inner. Extract only `verification_uri_complete` as the auth URL. | `flow.exchangeCodeForToken(authCodeWithState)` — single combined `code#state` string pasted by user. PKCE verifier held internally by flow instance. |
| Codex (primary) | `browser_redirect` (auto-capture) | `new CodexDeviceFlow()` → `flow.buildAuthorizationUrl(redirectUri, state)` (calls `generatePKCE()` internally, stores verifier keyed by `state`). The proxy starts a temporary localhost HTTP redirect server on the **host** to receive the OAuth callback — the `redirectUri` is `http://localhost:{port}/callback` on the host. User authorizes in browser; browser redirects to host localhost; host captures code automatically. | `flow.exchangeCodeForToken(code, redirectUri, state)` — three parameters. Verifier looked up by `state`. Host calls this automatically when redirect received. |
| Codex (fallback) | `device_code` | `new CodexDeviceFlow()` → `flow.requestDeviceCode()` — returns `{device_auth_id, user_code, interval}`. User visits `https://auth.openai.com/deviceauth/callback` and enters `user_code`. This flow is the fallback when the host cannot run a localhost redirect server (e.g., Docker Desktop port issues). **Note**: Unlike standard device code flows, Codex's device auth returns `{authorization_code, code_verifier, code_challenge}` from the server — the PKCE verifier is server-generated. | `flow.pollForDeviceToken(deviceAuthId, userCode, interval)` polls until user authorizes → returns `{authorization_code, code_verifier, code_challenge}` → then `flow.completeDeviceAuth(authorizationCode, codeVerifier, CODEX_CONFIG.deviceAuthCallbackUri)` exchanges for token. Host runs the entire poll+complete sequence in background. |
| Qwen | `device_code` | `new QwenDeviceFlow(config)` → `flow.initiateDeviceFlow()` generates PKCE internally (`code_challenge` + `S256` sent in device code request), returns `{verification_uri, user_code, device_code}` per RFC 8628. Flow instance holds PKCE verifier for polling. Default poll interval is **5000ms** when the provider omits the `interval` field (Qwen doesn't include it; matches `pollForToken()` hardcoded default). | `flow.pollForToken()` sends `code_verifier: this.pkceVerifier` with each poll. Host calls this in background task. |
| Gemini | `pkce_redirect` (code-paste) | In sandbox, `config.isBrowserLaunchSuppressed()` returns true, so `oauth2.ts` uses the `authWithUserCode()` path (line 259) — NOT the `authWithWeb()` browser flow. This path is **decomposable**: (a) create `OAuth2Client`, (b) call `client.generateCodeVerifierAsync()` for PKCE, (c) call `client.generateAuthUrl({redirect_uri: 'https://codeassist.google.com/authcode', code_challenge_method: 'S256', code_challenge, ...})` → returns auth URL. User visits URL, authorizes, receives a verification code from Google's callback page. | User pastes code → `authWithCode(client, code, codeVerifier, redirectUri)` where `codeVerifier` is type `{ codeVerifier: string } | undefined` (extracted from the full object returned by `generateCodeVerifierAsync()`). **Return type**: `authWithCode()` returns `Promise<boolean>`, NOT credentials directly — on success (`true`), read `client.credentials` to get the `Credentials` object, then convert to `OAuthToken` format using the Gemini Credentials Conversion rules (§8: `expiry_date` ms → `expiry` s, etc.) → stores full token. **Implementation prerequisite**: The `authWithUserCode()` function (oauth2.ts lines 259–397) is currently monolithic — it creates the client, generates PKCE, prints the URL, waits for input via globals, and exchanges. The proxy needs these steps decomposed into separate calls. This requires extracting: (a) PKCE+URL generation, (b) code exchange, and (c) token extraction from `OAuth2Client.credentials` into importable utilities. |

**Note on Anthropic flow choice:** Anthropic's `AnthropicDeviceFlow` supports both code-paste (via `verification_uri_complete`) and polling (via `pollForToken(device_code)`). The proxy uses the code-paste path because: (a) it's simpler — one round-trip vs background polling, (b) the user explicitly controls when exchange happens, (c) `verification_uri_complete` provides a pre-filled URL requiring only one click to authorize. Polling exists but adds complexity without UX benefit here.

**Note on Codex dual-flow:** `CodexDeviceFlow` has two completely independent authentication mechanisms: (1) browser redirect PKCE via `buildAuthorizationUrl()` + `exchangeCodeForToken()`, and (2) device authorization via `requestDeviceCode()` + `pollForDeviceToken()` + `completeDeviceAuth()`. The browser redirect is the primary path for sandbox (seamless UX — user just clicks authorize, host auto-captures). The device auth is the fallback if the host localhost server is unreachable from the browser (Docker Desktop port forwarding issues, corporate proxy, etc.). **Key difference**: in the device auth flow, the PKCE verifier is **server-generated** (returned in `pollForDeviceToken()` response), not client-generated. This is an OpenAI-specific extension.

**Note on Gemini simplification:** The original design considered Gemini as a `browser_redirect` flow (host runs `getOauthClient()` monolithically). However, `getOauthClient()` (oauth2.ts) writes to stdout via `console.log`, installs global state (`__oauth_needs_code`, `__oauth_wait_for_code`), uses `ClipboardService`, and expects interactive console input — none of which are appropriate for a background proxy context. Fortunately, in sandbox mode `isBrowserLaunchSuppressed()` returns true, causing `oauth2.ts` to use `authWithUserCode()` which IS decomposable into PKCE steps (generate verifier + auth URL, then exchange code). This means Gemini uses the same `pkce_redirect` protocol as Anthropic — the user visits a URL, receives a code from Google's callback page (`https://codeassist.google.com/authcode`), and pastes it.

The protocol supports two primary login sub-flows (plus a third for Codex), all strictly request/response (no server push):

1. **PKCE code-paste flow** (Anthropic, Gemini): `oauth_initiate` → returns `{auth_url, session_id, flow_type: "pkce_redirect"}` → user visits URL, authorizes, receives code → user pastes auth code into TUI → `oauth_exchange` with `{session_id, code}` → proxy exchanges code with internal PKCE verifier → returns sanitized token
2. **Device code flow** (Qwen; Codex fallback): `oauth_initiate` → returns `{verification_url, user_code, session_id, flow_type: "device_code", pollIntervalMs}` → host begins polling/processing in background → inner polls via `oauth_poll` with `{session_id}` → returns `{status: "pending", pollIntervalMs}` until authorized → returns `{status: "complete", ...token}` on success. Default `pollIntervalMs`: 5000ms when provider omits `interval` (Qwen), or value from `requestDeviceCode().interval * 1000` (Codex).
3. **Browser redirect flow** (Codex primary): `oauth_initiate` → host starts localhost HTTP server, generates auth URL → returns `{auth_url, session_id, flow_type: "browser_redirect"}` → user opens auth URL in browser → browser redirects to host localhost → host captures code and exchanges automatically → inner polls via `oauth_poll` with `{session_id}` → returns `{status: "complete", ...token}` on success

## 9. CredentialProxyServer Class Design

### Constructor

```typescript
class CredentialProxyServer {
  constructor(options: {
    tokenStore: KeyringTokenStore;
    keyStorage: ProviderKeyStorage;
    providers: Map<string, OAuthProvider>;       // for refresh (OAuthProvider.refreshToken)
    flowFactories: Map<string, () => OAuthFlow>; // for login — creates fresh flow instances per session
    allowedProviders: Set<string>;               // profile-scoped
    allowedBuckets: Map<string, Set<string>>;    // provider → allowed buckets
  })
}
```

**Why two provider maps**: The `OAuthProvider` interface (`initiateAuth`, `getToken`, `refreshToken`, `logout`) is sufficient for refresh operations. But for login, the proxy needs the raw device flow classes (`AnthropicDeviceFlow`, `CodexDeviceFlow`, `QwenDeviceFlow`) to call `initiateDeviceFlow()`, `buildAuthorizationUrl()`, `exchangeCodeForToken()`, and `pollForToken()` — methods that are NOT on the `OAuthProvider` interface. The `flowFactories` map provides a factory function per provider that creates a fresh flow instance for each login session (necessary to avoid shared PKCE state between concurrent sessions). For Gemini, the factory creates an `OAuth2Client` and generates PKCE (decomposing the `authWithUserCode()` path from `oauth2.ts`) rather than calling the monolithic `getOauthClient()` — see the Gemini simplification note above.

### Responsibilities

| Concern | Owner |
|---|---|
| Socket creation, permissions, cleanup | CredentialProxyServer |
| Framing (length-prefix encode/decode) | Shared framing module (used by both server and client) |
| Handshake | CredentialProxyServer (server side), ProxyTokenStore (client side) |
| Request routing and dispatch | CredentialProxyServer |
| Request schema validation | CredentialProxyServer |
| Profile scoping | CredentialProxyServer |
| Rate limiting | CredentialProxyServer |
| Peer credential verification | CredentialProxyServer |
| Token sanitization (strip refresh_token) | CredentialProxyServer |
| Token read/write/delete | KeyringTokenStore (delegated) |
| API key read/list | ProviderKeyStorage (delegated) |
| Refresh coordination (lock, double-check, merge) | CredentialProxyServer (using KeyringTokenStore locks) |
| PKCE session management | PKCESessionStore (internal to CredentialProxyServer) |
| Proactive renewal scheduling | ProactiveScheduler (internal to CredentialProxyServer) |
| OAuth code exchange | OAuthProvider instances (delegated) |
| Audit logging | CredentialProxyServer |

### Lifecycle Methods

```typescript
async start(): Promise<void>    // Create socket, bind, listen
async stop(): Promise<void>     // Graceful shutdown (see below)
getSocketPath(): string         // Returns the socket path for env var injection
```

### Graceful Shutdown

When `stop()` is called (on container exit, SIGTERM, or SIGINT):

1. Stop accepting new connections.
2. Wait up to 5 seconds for in-flight requests (active refresh, OAuth exchange) to complete.
3. After grace period, abort remaining operations (advisory locks have stale-lock protection via `staleMs`).
4. Close all connections, remove the socket file, cancel proactive renewal timers, clean up sessions.

## 10. ProxyTokenStore Class Design

**Implements**: `TokenStore` (from `packages/core/src/auth/token-store.ts`)

### Constructor

```typescript
class ProxyTokenStore implements TokenStore {
  constructor(socketPath: string)
}
```

### Connection Management

- Connects to the Unix socket lazily on first operation.
- Sends version handshake on connect.
- Maintains a single persistent connection.
- Idle timeout: 5 minutes — client initiates a graceful close. On the next operation, the client establishes a fresh connection and performs a new handshake. This is safe because the client controls the close and no failure occurred — it is NOT auto-reconnect (which would be unsafe after a server crash or socket error since reconnecting could reach a spoofed socket).
- On connection error (server crash, socket error, unexpected close): throws to caller with "Credential proxy connection lost. Restart the session." No auto-reconnect.

### Method Mapping

| TokenStore Method | Proxy Operation |
|---|---|
| `saveToken(provider, token, bucket?)` | `save_token` |
| `getToken(provider, bucket?)` | `get_token` |
| `removeToken(provider, bucket?)` | `remove_token` |
| `listProviders()` | `list_providers` |
| `listBuckets(provider)` | `list_buckets` |
| `getBucketStats(provider, bucket)` | Calls `get_token` through the proxy. If successful, returns the same placeholder `BucketStats` that `KeyringTokenStore` returns (`{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`). If `NOT_FOUND`, returns `null`. This matches `KeyringTokenStore.getBucketStats()` behavior (see `keyring-token-store.ts` lines 271–285). |
| `acquireRefreshLock(provider, options?)` | No-op, returns `true` — refresh coordination happens on the host side |
| `releaseRefreshLock(provider, bucket?)` | No-op — refresh coordination happens on the host side |

### Lock Methods Are No-Ops

In proxy mode, the inner process does NOT perform token refresh directly. All refresh goes through the `refresh_token` proxy operation, which handles locking on the host. The lock methods exist to satisfy the `TokenStore` interface contract. `acquireRefreshLock` always returns `true` (the caller can proceed — but there's nothing to lock against locally). `releaseRefreshLock` is a no-op.

## 10a. Inner-Side OAuth Adapter (Proxy Mode Login)

In non-sandbox mode, `authCommand.ts` calls `OAuthManager.login()` which calls `provider.initiateAuth()` — the provider manages the entire flow internally (starts redirect server or device flow, opens browser, waits for callback, saves token). In proxy mode, this flow is fundamentally different: the inner process drives a multi-step protocol over the socket.

### Adapter Design

A `ProxyOAuthAdapter` class encapsulates the proxy-side login flow. It is used only when `LLXPRT_CREDENTIAL_SOCKET` is set.

```typescript
class ProxyOAuthAdapter {
  constructor(private socket: ProxySocketClient)

  async login(provider: string, bucket?: string): Promise<SanitizedOAuthToken> {
    // 1. Send oauth_initiate → get {session_id, flow_type, auth_url?, verification_url?, user_code?, pollIntervalMs?}
    // 2. Based on flow_type:
    //    - "pkce_redirect": Display auth_url to user → prompt for pasted code → oauth_exchange
    //    - "device_code": Display verification_url + user_code → poll oauth_poll until complete
    //    - "browser_redirect": Show "Waiting for browser authorization..." → poll oauth_poll until complete
    // 3. Return sanitized token metadata
  }

  async cancel(sessionId: string): Promise<void> {
    // Send oauth_cancel
  }
}
```

### Integration with authCommand.ts

The `/auth login` command handler detects proxy mode and dispatches accordingly:

```typescript
if (process.env.LLXPRT_CREDENTIAL_SOCKET) {
  const adapter = new ProxyOAuthAdapter(proxySocket);
  const token = await adapter.login(providerName, bucket);
  // token is already stored on host side — OAuthManager.saveToken() will merge harmlessly (R8.3)
} else {
  await oauthManager.login(providerName, bucket);
}
```

The `ProxyOAuthAdapter` shares the same `ProxySocketClient` (framing + connection management) as `ProxyTokenStore`. It handles TUI display (auth URL, user code prompts, "waiting..." messages) using the same output patterns as the existing direct-mode login flow.

### Inner-Side Refresh Trigger

In proxy mode, the inner process's `OAuthManager` may encounter an expired access_token (e.g., timing gap before proactive renewal completes). The normal non-proxy code path would call `provider.refreshToken(currentToken)`, which would fail because the sanitized token has no `refresh_token`. Instead, the inner process triggers refresh via the `refresh_token` proxy operation.

The mechanism: `ProxyOAuthAdapter` exposes a `refresh(provider, bucket)` method that sends the `refresh_token` proxy operation over the socket. In proxy mode, `authCommand.ts` and `OAuthManager` call this method instead of `provider.refreshToken()`. The host proxy performs the actual refresh (using the stored `refresh_token`) and returns a sanitized token.

This is distinct from proactive renewal (R16, which runs on the host via timers) — it's the on-demand fallback when the inner process encounters an already-expired token.

### Why Not Extend ProxyTokenStore

`ProxyTokenStore` implements `TokenStore` — a data-access interface. The OAuth login flow is an authentication workflow, not a data operation. Mixing them would violate separation of concerns and make `ProxyTokenStore` depend on TUI rendering. The adapter is a separate class that uses the same socket client.

## 11. ProxyProviderKeyStorage Class Design

**Prerequisite**: `ProviderKeyStorage` is currently a concrete class with no extracted interface (see `packages/core/src/storage/provider-key-storage.ts` line 64). For `ProxyProviderKeyStorage` to be substitutable at instantiation sites, either: (a) extract a `ProviderKeyStorageInterface` from the concrete class (analogous to how `TokenStore` is an interface that `KeyringTokenStore` implements), or (b) use TypeScript structural typing (duck typing) where the factory returns a compatible object. Option (a) is preferred for type safety and documentation.

### Constructor

```typescript
class ProxyProviderKeyStorage implements ProviderKeyStorageInterface {
  constructor(socketPath: string)
}
```

### Method Mapping

The proxy implementation matches the `ProviderKeyStorage` read methods used in the container:

| Method | Proxy Operation |
|---|---|
| `getKey(name)` | `get_api_key` |
| `listKeys()` | `list_api_keys` |
| `hasKey(name)` | `get_api_key` (returns true if non-null) |
| `saveKey(name, apiKey)` | Not proxied — key management happens on host only |
| `deleteKey(name)` | Not proxied — key management happens on host only |

Write operations (`saveKey`, `deleteKey`) are not proxied — API key management is a host-side administrative action. The inner process only reads keys. If called in proxy mode, `saveKey` throws with a clear error message: "API key management is not available in sandbox mode. Manage keys on the host." `deleteKey` similarly throws. This prevents silent data loss and gives the user an actionable error.

## 12. Profile Scoping

The proxy restricts credential access to the loaded profile's providers and buckets. On startup, `CredentialProxyServer` receives:
- `allowedProviders`: `Set<string>` — e.g., `{"anthropic", "gemini"}`
- `allowedBuckets`: `Map<string, Set<string>>` — e.g., `{"anthropic" => {"default", "work"}, "gemini" => {"default"}}`

For every incoming request, the server checks:
1. Is `provider` in `allowedProviders`? If not → `UNAUTHORIZED`.
2. Is `bucket` in `allowedBuckets.get(provider)`? If not → `UNAUTHORIZED`.

For `list_providers` and `list_buckets`, results are filtered to only include allowed entries.

For API key operations, the key name is checked against the profile's allowed key names.

## 13. Rate Limiting

### Global Rate Limit

Maximum 60 requests per second per connection. Enforced via a sliding window counter (or token bucket). Excess requests return `RATE_LIMITED` error immediately with `retryAfter: 1` (1 second — the minimum window before a new request can be accepted).

### Refresh Rate Limit

Maximum 1 `refresh_token` operation per provider:bucket per 30 seconds. Tracked per provider:bucket pair. If a refresh is requested within the cooldown period:
- Token still valid → return current token (sans refresh_token).
- Token expired → return `RATE_LIMITED` with `retryAfter` metadata (seconds remaining). Prevents tight retry loops on expired tokens.

### Concurrent Refresh Deduplication

If a second `refresh_token` request arrives for the same provider:bucket while the first is still in progress, the second request waits for the first to complete and receives the same result. This is a natural consequence of the lock-based approach — the second request attempts to acquire the lock, fails (held by first), waits, re-reads the now-refreshed token after lock release, and returns it.

## 14. Error Handling

### Error Code Taxonomy

| Code | Source | Meaning |
|---|---|---|
| `NOT_FOUND` | Server | Credential does not exist |
| `INVALID_REQUEST` | Server | Malformed request (wrong fields, types, missing required) |
| `RATE_LIMITED` | Server | Request rate exceeded |
| `UNAUTHORIZED` | Server | Provider/bucket not allowed by profile |
| `INTERNAL_ERROR` | Server | Host-side failure (keyring, network, timeout). Includes keyring-locked scenarios — the human-readable `error` message should include keyring unlock instructions when applicable. |
| `UNKNOWN_VERSION` | Server | Protocol version mismatch |
| `SESSION_NOT_FOUND` | Server | OAuth session doesn't exist / already used |
| `SESSION_EXPIRED` | Server | OAuth session timed out |
| `SESSION_ALREADY_USED` | Server | OAuth exchange already attempted |
| `EXCHANGE_FAILED` | Server | Provider code exchange failed |
| `PROVIDER_NOT_FOUND` | Server | Provider not configured |

### Provider Flow Error Normalization

Device code, browser redirect, and PKCE code-paste flows produce provider-specific error states that must be normalized to stable proxy error codes:

| Provider Error State | Proxy Normalization | Notes |
|---|---|---|
| Device code `authorization_pending` | `oauth_poll` → `{status: "pending"}` | Normal — user hasn't authorized yet |
| Device code `slow_down` | Increase poll interval, continue returning `{status: "pending"}` | Host-side concern only — inner sees "pending" |
| Device code `expired_token` | `oauth_poll` → `{status: "error", code: "SESSION_EXPIRED"}` | Device code expired before user authorized |
| Device code `access_denied` | `oauth_poll` → `{status: "error", code: "EXCHANGE_FAILED"}` | User denied authorization |
| Codex device auth `poll_timeout` | `oauth_poll` → `{status: "error", code: "SESSION_EXPIRED"}` | User didn't enter code in time |
| Browser redirect timeout (Codex) | `oauth_poll` → `{status: "error", code: "EXCHANGE_FAILED"}` | Browser not opened or redirect server timed out |
| PKCE redirect `invalid_grant` | `oauth_exchange` → error with code `EXCHANGE_FAILED` | Wrong auth code or code expired |
| PKCE redirect `invalid_client` | `oauth_exchange` → error with code `EXCHANGE_FAILED` | Client registration issue |
| Gemini `authWithCode()` failure | `oauth_exchange` → error with code `EXCHANGE_FAILED` | Google rejected auth code or PKCE verifier |
| Any network error during exchange | Error with code `INTERNAL_ERROR` | Transient — user retries login |

### Client-Side Error Translation

`ProxyTokenStore` translates proxy error codes into the same error behaviors as `KeyringTokenStore`:

| Proxy Error Code | ProxyTokenStore Behavior |
|---|---|
| `NOT_FOUND` (on `get_token`) | Return `null` |
| `NOT_FOUND` (on `remove_token`) | Return silently (best-effort) |
| `INTERNAL_ERROR` | Throw error with message (propagate to caller) |
| `UNAUTHORIZED` | Throw error with message |
| `RATE_LIMITED` | Throw error with message (caller retries or surfaces) |
| Connection lost | Throw: "Credential proxy connection lost. Restart the session." |

This ensures `OAuthManager` and auth commands see the same error semantics regardless of whether the underlying store is `KeyringTokenStore` (direct) or `ProxyTokenStore` (proxy).

## 15. Integration with sandbox.ts

### Host-Side Changes in `start_sandbox()`

The `start_sandbox()` function in `packages/cli/src/utils/sandbox.ts` (currently ~1600 lines) gains:

1. **Before container spawn**: Create `CredentialProxyServer`. Start listening on Unix socket.
2. **Container args**: Add `--env LLXPRT_CREDENTIAL_SOCKET=${proxy.getSocketPath()}` to the docker/podman args.
3. **After container exit**: Call `proxy.stop()` to clean up socket, cancel timers, clear sessions.
4. **Signal handlers**: The existing signal handler registration pattern at lines 1340–1346 (which stops the network proxy container) provides a template. Similar handlers need to be registered for the credential proxy's `stop()` method.

The socket lives in `os.tmpdir()`, which is already volume-mounted (line 1025), so no additional `--volume` argument is needed.

### Seatbelt Mode

Seatbelt mode (`sandbox-exec` on macOS) does NOT use the proxy. It runs directly on the host with keyring access. The `LLXPRT_CREDENTIAL_SOCKET` env var is NOT set for seatbelt. No changes to seatbelt code paths.

## 16. Timeout Architecture

```
Inner process                          Host proxy
    │                                      │
    ├─── 30s per-request timeout ─────────►│
    │                                      ├─── 15s host-side processing timeout
    │                                      │    (per individual operation: keyring read/write/delete/list,
    │                                      │    API key read/list, each provider network call within
    │                                      │    OAuth exchange or refresh. The overall operation
    │                                      │    including retries is bounded by the 30s client timeout.)
    │                                      │
    │◄── 5s partial frame timeout ────────►│ (bidirectional — either side)
    │                                      │
    │    5min idle connection timeout       │
    │    (client closes, re-establishes)    │
    │                                      │
    │                                      ├─── 10min OAuth session timeout
    │                                      ├─── 60s GC sweep for stale sessions
    │                                      ├─── 30s refresh rate limit cooldown
```

## 17. Consistency with Phase A Patterns

### TokenStore Interface

`ProxyTokenStore` implements the same `TokenStore` interface as `KeyringTokenStore`. Callers (OAuthManager, auth commands) are unaware of the underlying implementation.

### SecureStore Wrapper Pattern

This does NOT follow the SecureStore thin-wrapper pattern (ProviderKeyStorage, KeychainTokenStorage, etc.). The proxy is an IPC transport layer, not a storage wrapper. It wraps a network boundary, not a SecureStore instance.

### Existing mergeRefreshedToken

The host proxy uses the existing `mergeRefreshedToken()` function (from `oauth-manager.ts` lines 78–99) for the token merge contract. This function already implements the correct merge semantics:
- Spread new over current
- Keep current values where new is undefined
- Preserve existing refresh_token if new is missing/empty

**Prerequisite**: `mergeRefreshedToken` is currently module-private (no `export` keyword at line 78 of `oauth-manager.ts`). It operates on the type alias `OAuthTokenWithExtras` (= `OAuthToken & Record<string, unknown>`, defined at line 76) which handles provider-specific passthrough fields. It must be extracted to a shared utility in `packages/core/src/auth/` (e.g., `token-merge.ts`) along with the `OAuthTokenWithExtras` type alias, so both `OAuthManager` (in CLI) and `CredentialProxyServer` (also CLI) can import it without circular dependencies. Simply exporting from `oauth-manager.ts` would work structurally (both consumers are in CLI), but extracting to core is preferred because: (a) the merge contract is part of the `TokenStore` domain, not the `OAuthManager` domain, and (b) it enables reuse by any future token-handling code in core.

### Existing Lock Mechanism

The host proxy uses `KeyringTokenStore.acquireRefreshLock()` / `releaseRefreshLock()` for refresh coordination — the same file-based advisory locks used by `OAuthManager` in non-sandbox mode.

## 18. Deliberate Design Decisions

| Decision | Rationale |
|---|---|
| Framed JSON instead of newline-delimited JSON | Payloads may contain newlines in future. Length-prefixed framing is unambiguous. |
| No auto-reconnect | Security: a dropped connection could indicate the host process crashed. Reconnecting could connect to a spoofed socket. |
| Lock no-ops in ProxyTokenStore | Refresh happens on the host. The inner process has no reason to lock — the proxy coordinates. |
| Write operations not proxied for API keys | Key management (save/delete) is host-side administrative. Inner only reads. |
| Session bound to peer identity, not connection | User may disconnect/reconnect TUI during OAuth flow. Peer identity is stable; connection object is not. |
| Proactive renewal on host, not inner | Inner has `ProxyTokenStore` which cannot refresh. Host has the refresh_token and provider access. |
| sanitizeTokenForProxy as single chokepoint | All socket-crossing token responses go through one function. Easier to audit, harder to miss a path. |
| `getBucketStats` via `get_token` round-trip in ProxyTokenStore | `KeyringTokenStore.getBucketStats()` returns placeholder values based on token existence. One `get_token` round-trip achieves the same result without a dedicated proxy operation. `NOT_FOUND` → `null`, success → placeholder `BucketStats`. |

## Appendix A: Protocol Message Schemas

Normative request/response schemas for all operations. Fields marked `?` are optional.

### Envelope

```typescript
// Request (client → server)
{ v: 1, id: string, op: string, payload: object }

// Success response (server → client)
{ v: 1, id: string, ok: true, data: object }

// Error response (server → client)
{ v: 1, id: string, ok: false, error: string, code: ErrorCode, retryAfter?: number }
```

`retryAfter` is present only when `code` is `RATE_LIMITED` (seconds until retry is allowed).

### Handshake (first frame, no `id` field)

```typescript
// Request
{ v: 1, op: "handshake", payload: { minVersion: number, maxVersion: number } }

// Success
{ v: 1, op: "handshake", ok: true, data: { version: number } }

// Failure
{ v: 1, op: "handshake", ok: false, error: string, code: "UNKNOWN_VERSION" }
```

### Token Operations

```typescript
// get_token
Request:  { payload: { provider: string, bucket?: string } }
Success:  { data: { access_token: string, expiry: number, token_type: string, scope?: string, [key: string]: unknown } }
// Note: response NEVER contains refresh_token

// save_token
// Note: even if the inner process sends refresh_token in the payload, the server strips it before processing.
Request:  { payload: { provider: string, bucket?: string, token: { access_token: string, expiry: number, token_type: string, scope?: string, [key: string]: unknown } } }
Success:  { data: {} }

// remove_token
Request:  { payload: { provider: string, bucket?: string } }
Success:  { data: {} }

// list_providers
Request:  { payload: {} }
Success:  { data: { providers: string[] } }

// list_buckets
Request:  { payload: { provider: string } }
Success:  { data: { buckets: string[] } }

// refresh_token
Request:  { payload: { provider: string, bucket?: string } }
Success:  { data: { access_token: string, expiry: number, token_type: string, scope?: string, [key: string]: unknown } }
// Note: response NEVER contains refresh_token
```

### API Key Operations

```typescript
// get_api_key
Request:  { payload: { name: string } }
Success:  { data: { key: string } }

// list_api_keys
Request:  { payload: {} }
Success:  { data: { keys: string[] } }
```

### OAuth Login Operations

```typescript
// oauth_initiate
Request:  { payload: { provider: string, bucket?: string } }
Success:  { data: {
  session_id: string,
  flow_type: "pkce_redirect" | "device_code" | "browser_redirect",
  auth_url?: string,           // present when flow_type = "pkce_redirect" (Anthropic, Gemini) or "browser_redirect" (Codex primary)
  verification_url?: string,   // present when flow_type = "device_code" (Qwen, Codex fallback). Note: mapped from provider's verification_uri (RFC 8628) to verification_url in the proxy protocol.
  user_code?: string,          // present when flow_type = "device_code"
  pollIntervalMs?: number      // present when flow_type = "device_code" (from provider interval, or 5000ms default)
} }

// oauth_exchange (pkce_redirect flows only)
Request:  { payload: { session_id: string, code: string } }
Success:  { data: { access_token: string, expiry: number, token_type: string, scope?: string, [key: string]: unknown } }
// Note: response NEVER contains refresh_token or PKCE secrets

// oauth_poll (device_code and browser_redirect flows)
// Note: oauth_poll always returns ok: true at the protocol level (the poll request itself
// succeeded). The status: "error" within data indicates the OAuth flow failed, not a proxy
// transport error. This is analogous to an HTTP 200 with an application-level error body.
Request:  { payload: { session_id: string } }
Success:  { data: {
  status: "pending" | "complete" | "error",
  // When status = "pending":
  pollIntervalMs?: number,    // recommended poll interval (RFC 8628 interval for device_code, 2000ms default for browser_redirect)
  // When status = "complete":
  access_token?: string, expiry?: number, token_type?: string, scope?: string,
  // When status = "error":
  code?: ErrorCode, error?: string
} }
// Note: response NEVER contains refresh_token

// oauth_cancel (all flow types)
Request:  { payload: { session_id: string } }
Success:  { data: {} }
```

### Error Codes (complete enumeration)

```typescript
type ErrorCode =
  | "NOT_FOUND"           // Credential does not exist
  | "INVALID_REQUEST"     // Malformed request (wrong fields, types, missing required)
  | "RATE_LIMITED"        // Request rate exceeded (includes retryAfter)
  | "UNAUTHORIZED"        // Provider/bucket not allowed by loaded profile
  | "INTERNAL_ERROR"      // Host-side failure (keyring, network, timeout)
  | "UNKNOWN_VERSION"     // Protocol version mismatch
  | "SESSION_NOT_FOUND"   // OAuth session doesn't exist
  | "SESSION_EXPIRED"     // OAuth session timed out (10 minutes)
  | "SESSION_ALREADY_USED"// OAuth exchange already attempted for this session
  | "EXCHANGE_FAILED"     // Provider code exchange or device auth failed
  | "PROVIDER_NOT_FOUND"; // Provider not configured
```
