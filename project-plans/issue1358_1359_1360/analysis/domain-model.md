# Domain Model: Credential Proxy for Sandbox

Plan ID: PLAN-20250214-CREDPROXY

## Entities

### CredentialProxyServer (Host-Side)
- Owns Unix socket lifecycle (create, bind, listen, close, cleanup)
- Routes requests to appropriate handlers
- Enforces trust boundary: sanitizes tokens, scopes by profile, rate limits
- Manages PKCE/OAuth sessions, proactive renewal timers, refresh coordination

### ProxyTokenStore (Inner-Side)
- Implements `TokenStore` interface (same as `KeyringTokenStore`)
- Translates method calls → framed JSON requests over Unix socket
- Lazy connection, single persistent connection, idle timeout reconnect
- Lock methods are no-ops (refresh coordination happens on host)

### ProxyProviderKeyStorage (Inner-Side)
- Implements extracted `ProviderKeyStorageInterface`
- Read-only: `getKey`, `listKeys`, `hasKey` proxied; `saveKey`/`deleteKey` throw
- Shares socket client with `ProxyTokenStore`

### ProxyOAuthAdapter (Inner-Side)
- Drives multi-step OAuth login over proxy protocol
- Handles TUI display (auth URLs, user code prompts, "waiting..." messages)
- Drives on-demand refresh via `refresh_token` proxy operation
- Separate from `ProxyTokenStore` (auth workflow, not data access)

### ProxySocketClient (Shared)
- Framed JSON encode/decode (4-byte uint32 BE length + JSON payload)
- Connection management (lazy connect, handshake, idle timeout, error surfacing)
- Request/response correlation via client-generated IDs

### PKCESessionStore (Host-Side, internal to server)
- In-memory `Map<string, SessionState>`
- Session creation, lookup, validation (single-use, peer-bound, timeout)
- GC sweep every 60 seconds for expired/used sessions

### ProactiveScheduler (Host-Side, internal to server)
- Schedules timers per provider:bucket for proactive token renewal
- Fires at `expiry - leadSec - jitterSec`
- Cancels all on shutdown

### RefreshCoordinator (Host-Side, internal to server)
- Rate limiting: 1 refresh per provider:bucket per 30 seconds
- Concurrent deduplication via advisory locks
- Retry with backoff (transient: 2×, auth error: 0)
- Refresh+logout race resolution via lock ordering

### TokenMerge (Shared utility)
- Extracted from `OAuthManager.mergeRefreshedToken()`
- Merge contract: new overwrites; refresh_token preserved if new is absent
- Works with `OAuthTokenWithExtras` (passthrough fields)

### Factory Functions (Detection)
- `createTokenStore()`: env var → ProxyTokenStore or KeyringTokenStore
- `createProviderKeyStorage()`: env var → ProxyProviderKeyStorage or ProviderKeyStorage

## State Transitions

### Proxy Connection States
```
DISCONNECTED → CONNECTING → HANDSHAKE → CONNECTED → IDLE_CLOSE → DISCONNECTED
                                      → ERROR (hard, no reconnect)
```

### OAuth Session States
```
CREATED → PENDING → EXCHANGED/COMPLETED → CLEANED_UP
                  → EXPIRED → CLEANED_UP (GC)
                  → CANCELLED → CLEANED_UP
                  → ERROR → CLEANED_UP
```

### Token Lifecycle (Sandbox Mode)
```
LOGIN: oauth_initiate → [user authorizes] → oauth_exchange/oauth_poll → host stores full token
READ: get_token → host reads from KeyringTokenStore → strip refresh_token → return sanitized
REFRESH: refresh_token op → host reads full token → lock → double-check → provider.refreshToken → merge → save → unlock → return sanitized
PROACTIVE: timer fires → re-check expiry → refresh if needed → schedule next
LOGOUT: remove_token → host acquires lock → delete → release lock
```

## Business Rules

1. **refresh_token NEVER crosses socket boundary** — stripped by `sanitizeTokenForProxy()`
2. **No auto-reconnect** — connection loss is hard error
3. **Single-use sessions** — `used` flag set before exchange attempt
4. **Profile scoping** — every request checked against `allowedProviders`/`allowedBuckets`
5. **Rate limiting** — 60 req/s global, 1 refresh/30s per provider:bucket
6. **Lock ordering** — refresh, save_token, remove_token all use same advisory lock per provider:bucket
7. **Non-sandbox unaffected** — env var absent → direct keyring access
8. **Seatbelt unaffected** — runs on host, no proxy needed

## Edge Cases

1. PID reuse → stale socket cleanup on startup
2. macOS symlinks → `fs.realpathSync(os.tmpdir())` for path resolution
3. Machine sleep → timer fires late, re-check wall-clock before refresh
4. Concurrent refresh requests → lock-based deduplication
5. Refresh during logout → lock ordering ensures logout wins
6. Save after login → harmless idempotent (refresh_token stripped from incoming)
7. Gemini special case → `OAuth2Client`-based refresh path, not `provider.refreshToken()`
8. Codex dual-flow → browser_redirect (primary) vs device_code (fallback)
9. Token expired during rate limit cooldown → return RATE_LIMITED with retryAfter
10. Inner process getBucketStats → implemented via get_token round-trip

## Error Scenarios

1. Socket missing at startup → actionable error, abort
2. Version mismatch → UNKNOWN_VERSION, close connection
3. Malformed request → INVALID_REQUEST, no store touched
4. Provider not in profile → UNAUTHORIZED
5. Keyring locked → INTERNAL_ERROR with unlock instructions
6. Refresh token invalid (401/invalid_grant) → no retry, force re-auth
7. Network error during refresh → retry 2× (1s, 3s), then INTERNAL_ERROR
8. OAuth session expired → SESSION_EXPIRED
9. OAuth session replayed → SESSION_ALREADY_USED
10. Partial frame timeout → close connection after 5s
11. Provider SDK errors → sanitize before sending across socket (strip auth headers/tokens)
