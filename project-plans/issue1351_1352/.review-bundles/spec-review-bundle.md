# Review Bundle: issue1351_1352 Specs (Round 14)

## Issue #1351 Text (authoritative)

Parent: #1349 (Epic: Unified Credential Management)
Depends on: #1350 (SecureStore)

## Problem

`MultiProviderTokenStore` stores OAuth tokens as plaintext JSON files in `~/.llxprt/oauth/{provider}-{bucket}.json`. These files have `0o600` permissions but are still readable by any process running as the same user, and are mounted into sandbox containers.

## Solution

New `KeyringTokenStore` class implementing the existing `TokenStore` interface (`core/src/auth/token-store.ts`), backed by `SecureStore` from #1350.

### Storage mapping

- Service name: `llxprt-code-oauth`
- Account naming: `{provider}:{bucket}` (e.g. `anthropic:default`, `gemini:work`)
- Escaping: provider and bucket names are validated to contain only `[a-zA-Z0-9_-]`. If either contains `:` or other special characters, `saveToken` rejects with a clear error.
- Value: `JSON.stringify(OAuthToken)` wrapped in the SecureStore versioned envelope

### Interface implementation

```
saveToken(provider, token, bucket?)    -> secureStore.set('{provider}:{bucket}', JSON.stringify(token))
getToken(provider, bucket?)            -> secureStore.get('{provider}:{bucket}') -> JSON.parse -> OAuthTokenSchema.parse
removeToken(provider, bucket?)         -> secureStore.delete('{provider}:{bucket}')
listProviders()                        -> secureStore.list() -> parse account names -> unique providers
listBuckets(provider)                  -> secureStore.list() -> filter by provider prefix -> extract bucket names
getBucketStats(provider, bucket)       -> read token, compute stats from expiry/scope
acquireRefreshLock(provider, options?)  -> file-based advisory lock (unchanged from MultiProviderTokenStore)
releaseRefreshLock(provider, bucket?)  -> release file-based lock
```

### Invalid token handling

When `getToken` reads a value that fails `OAuthTokenSchema` validation (corrupt data, schema mismatch, envelope version mismatch):
- Log a warning with the provider:bucket identifier (hashed) and the validation error (no secret values), using error taxonomy code `CORRUPT`
- Return `null` (same as "no token found")
- Do NOT silently delete the corrupt entry — it may be recoverable or useful for debugging
- The caller (OAuthManager) treats null as "needs login" and prompts the user

### Refresh lock coordination

Keeps the existing file-based advisory locks. Lock files live in `~/.llxprt/oauth/locks/` on the host. These are coordination primitives, not credentials, so they are unaffected by the keyring migration. In sandbox mode (post-proxy), refresh locks are managed by the host-side proxy — the inner process never touches lock files directly.

The lock uses PID + timestamp for stale detection, same as today. This preserves multi-instance coordination behavior.

### Fallback policy

- Non-sandbox: keyring primary, AES-256-GCM encrypted file fallback (via `SecureStore`)
- Sandbox pre-proxy (before #1358 ships): `KeyringTokenStore` is not accessible from inside the container. Users must use `--key` to pass an API key, `SANDBOX_ENV` to pass a token, or use seatbelt mode. Clear error message explaining this with `UNAVAILABLE` taxonomy code.
- Sandbox post-proxy (after #1358 ships): inner process uses `ProxyTokenStore` which routes through the credential proxy to the host-side `KeyringTokenStore`. The `KeyringTokenStore` itself is never instantiated inside the container.

### No migration

Old `~/.llxprt/oauth/*.json` plaintext files become inert. Users run `/auth login` again. `MultiProviderTokenStore` is deleted — git history is the reference.

## Acceptance criteria

- Implements all methods of the `TokenStore` interface
- Passes behavioral tests matching the patterns in `token-store.spec.ts` and `token-store.refresh-race.spec.ts`
- Validates tokens on read with `OAuthTokenSchema` — corrupt/invalid entries return null with logged warning, never throw
- Provider:bucket account naming validated — rejects special characters in provider/bucket names
- `listProviders()` and `listBuckets()` correctly parse the `{provider}:{bucket}` account naming
- File-based refresh locks work identically to current behavior
- Encrypted file fallback works when keyring is unavailable in non-sandbox mode
- **Multiprocess race condition tests**: concurrent refresh + removeToken (logout during refresh), concurrent saveToken from two processes — tested via spawned child processes, not just in-memory concurrency
- Clear error message when accessed from sandbox without proxy
- Error messages use the shared error taxonomy from #1349


---

## Issue #1352 Text (authoritative)

Parent: #1349 (Epic: Unified Credential Management)
Depends on: #1351 (KeyringTokenStore)

## Problem

`OAuthManager` currently receives a `MultiProviderTokenStore` instance (plaintext JSON files). It needs to use `KeyringTokenStore` instead.

## Solution

Replace the `MultiProviderTokenStore` instantiation with `KeyringTokenStore` wherever the `TokenStore` is created and injected into `OAuthManager`. The `OAuthManager` itself programs against the `TokenStore` interface, so no changes are needed inside it.

### Wiring

Find where `MultiProviderTokenStore` is instantiated (likely in `cli/src/auth/oauth-manager.ts` or the config/startup code that creates it) and replace with `KeyringTokenStore`. No toggle, no fallback to the old store — just swap it.

### Startup latency

`KeyringTokenStore` initialization includes a keyring availability probe (set-get-delete test via `SecureStore.isKeychainAvailable()`). The probe result is cached by SecureStore (#1350), so repeated calls don't re-probe. The probe must happen only once per process, not once per provider/bucket — ensure the SecureStore instance is shared or the probe cache is global.

### What to verify end-to-end (non-sandbox mode)

This is the critical integration point where keyring storage meets the full OAuth lifecycle. All of these flows run directly on the host — no proxy involved:

1. **`/auth login`** — initiates OAuth flow, receives tokens, `saveToken()` writes to keyring via `KeyringTokenStore`
2. **Session startup** — `getToken()` reads from keyring, token is valid, used for API calls
3. **Token refresh** — token expires, `OAuthManager.getOAuthToken()` acquires refresh lock, calls `provider.refreshToken()`, saves new token via `saveToken()`, releases lock
4. **Proactive renewal** — timer fires before expiry, same refresh flow
5. **Bucket failover** — primary bucket fails auth, falls back to secondary bucket, both read/write through keyring
6. **Multi-bucket** — profile references multiple buckets, each stored as separate keyring entry (`anthropic:default`, `anthropic:work`)
7. **Multi-instance** — two llxprt processes running simultaneously, both hitting keyring, file-based refresh lock prevents double-refresh
8. **`/auth logout`** — `removeToken()` deletes from keyring
9. **`/auth status`** — `getToken()` + `listBuckets()` reads from keyring, displays status
10. **Keyring unavailable** — falls back to encrypted files, all above flows still work

## Acceptance criteria

- All existing OAuth integration tests pass with `KeyringTokenStore` as the backend
- `/auth login` stores tokens in keyring (not plaintext files)
- `/auth status` reads tokens from keyring
- Token refresh cycle works: expire -> lock -> refresh -> save -> unlock
- Multiple providers work simultaneously (anthropic + gemini each in keyring)
- `MultiProviderTokenStore` is no longer instantiated anywhere
- Probe happens once per process, not once per provider/bucket
- Each verification flow above has a corresponding integration test with deterministic fake providers and clock control
- **CI runs both paths**: keyring-available (default) and keyring-unavailable (fallback-only) in separate test jobs


---

## overview.md (Functional Specification)

# Functional Specification: Secure OAuth Token Storage

**Issues**: #1351 (KeyringTokenStore), #1352 (Wire as Default)
**Epic**: #1349 — Unified Credential Management, Phase A
**Status**: Specification — describes WHAT the system does, not how to build it

---

## Project Principles

- **NO backward compatibility shims.** Old plaintext token files become inert immediately. There is no code that reads, migrates, or acknowledges them.
- **NO feature flags.** There is no toggle between old and new storage. `KeyringTokenStore` replaces `MultiProviderTokenStore` as the host-side `TokenStore` implementation. (A future `ProxyTokenStore` for sandbox mode is defined in #1358 — out of scope here.)
- **NO migrations.** Users run `/auth login` again. The old `~/.llxprt/oauth/*.json` plaintext files are ignored by the new system and can be manually deleted by the user.
- **Clean cut.** `MultiProviderTokenStore` is deleted from the codebase. Git history serves as the only reference.

---

## 1. Problem Statement

OAuth tokens for providers (Gemini, Qwen, Anthropic, Codex) are currently stored as plaintext JSON files in `~/.llxprt/oauth/`. Each provider's token is a file like `gemini.json` or `qwen-work.json` containing the raw `access_token`, `refresh_token`, `expiry`, and related fields in cleartext.

This means:
- Any process running as the same user can read tokens without privilege escalation.
- Tokens are visible to backup tools, cloud sync, search indexers, and any software with filesystem access.
- The storage is inconsistent with the rest of the credential system — API keys (via `ProviderKeyStorage`), MCP tokens (via `KeychainTokenStorage`), tool keys, and extension settings all already use `SecureStore` with OS keyring primary storage and AES-256-GCM encrypted file fallback.

OAuth tokens are the last plaintext credential in the system.

## 2. What Changes for Users

### Re-authentication Required

After this change, all existing OAuth sessions are invalidated from the application's perspective. The old plaintext JSON files still exist on disk but the application no longer reads them. Users must run `/auth login <provider>` for each provider they use.

This is a one-time action per provider+bucket combination. The CLI will behave as if the user has never authenticated — `/auth status` will show no active sessions, and provider operations requiring OAuth will prompt for authentication.

### Where Tokens Go

Tokens are stored in the OS keyring (macOS Keychain, GNOME Keyring / KWallet on Linux, Windows Credential Manager) under the service name `llxprt-code-oauth`. Each token appears as an account entry like `anthropic:default` or `gemini:work`.

If the OS keyring is unavailable (headless Linux without a keyring daemon, SSH sessions without `DBUS_SESSION_BUS_ADDRESS`, CI environments), tokens are stored in AES-256-GCM encrypted files under `~/.llxprt/secure-store/llxprt-code-oauth/`. This fallback is automatic and transparent — the user is not asked to choose.

### What Stays the Same

- All `/auth` commands (`login`, `logout`, `status`, `switch`) work identically from the user's perspective on successful paths. Error messages may differ when keyring-specific failures occur (e.g., `LOCKED`, `DENIED`).
- The OAuth device flow UX (verification URL, user code, polling) is unchanged.
- The `--key` flag for API key authentication is unaffected.
- Multi-bucket support (`/auth login gemini --bucket work`) works the same way.
- Token refresh happens transparently in the background, same as before.
- Proactive renewal scheduling is unchanged.
- Profile-bucket associations are unchanged.

## 3. Credential Lifecycle

### Login

1. User runs `/auth login <provider>` (optionally with `--bucket <name>`).
2. OAuth device flow executes (browser opens, user authorizes).
3. Token response is validated against `OAuthTokenSchema`.
4. Token is serialized to JSON and stored via `SecureStore.set()` under account `<provider>:<bucket>` (bucket defaults to `default`).
5. SecureStore attempts the OS keyring first. If that fails, it writes an AES-256-GCM encrypted file.
6. `/auth status` confirms active session.

### Token Read (Startup / API Call)

1. Application requests token for a provider+bucket pair.
2. `SecureStore.get()` checks keyring first, then encrypted fallback file.
3. Raw JSON string is parsed and validated against `OAuthTokenSchema.passthrough()`.
4. If validation succeeds, token is returned to the caller.
5. If validation fails (corrupt data, schema mismatch), a warning is logged with a hashed provider:bucket identifier (not raw) and the error code `CORRUPT`. No secret values are logged. `null` is returned. The corrupt entry is NOT deleted — it is preserved for potential manual inspection.
6. If `null` is returned, the application treats the provider as unauthenticated.

### Token Refresh

1. Before making an API call, the application checks if the token is expired or near expiry.
2. A file-based advisory lock is acquired in `~/.llxprt/oauth/locks/` to prevent concurrent refresh attempts across processes.
3. The provider's refresh endpoint is called with the `refresh_token`.
4. The refreshed token is validated and stored, replacing the previous token at the same account key.
5. The advisory lock is released.
6. If refresh fails and no valid token remains, the user must `/auth login` again.

### Proactive Renewal

1. After a successful token read, the application may schedule a background renewal timer.
2. When the timer fires, the same refresh flow executes.
3. This is unchanged — proactive renewal operates against the `TokenStore` interface.

### Logout

1. User runs `/auth logout <provider>` (optionally with `--bucket <name>`).
2. `SecureStore.delete()` removes the entry from both keyring and encrypted fallback file (if either exists). Deletion is best-effort — errors are logged but do not prevent logout from completing.
3. Any advisory lock file for that provider+bucket is cleaned up on a best-effort basis.
4. `/auth status` confirms no active session.

### Bucket Failover

1. If the active bucket's token is expired and non-refreshable, the bucket failover handler iterates other buckets for the same provider.
2. Each bucket's token is read via the same `SecureStore.get()` path.
3. The first valid, non-expired token's bucket becomes the active bucket.
4. This logic is in `BucketFailoverHandlerImpl` and operates against the `TokenStore` interface — no changes needed.

## 4. User-Visible Behaviors

### Successful Operations

| Action | User Experience |
|---|---|
| `/auth login gemini` | Same device flow as before. Token stored securely. "Successfully authenticated with gemini." |
| `/auth status` | Shows provider, authentication state, expiry countdown. Identical output. |
| `/auth logout anthropic` | "Logged out of anthropic." Token removed from keyring/fallback. |
| `/auth login qwen --bucket work` | Stores as `qwen:work`. "Successfully authenticated with qwen (bucket: work)." |
| Normal API calls | Token retrieved transparently. No user-visible change. |
| Token refresh | Happens in background. No user-visible change. |

### Error Scenarios

| Scenario | User Experience |
|---|---|
| Old plaintext tokens exist | Application behaves as if unauthenticated. User runs `/auth login`. Old files are ignored. |
| Keyring unavailable (headless/SSH) | Transparent fallback to encrypted files. No user action needed. Same behavior as API key storage. |
| Keyring locked (GNOME Keyring locked) | Error: "Keyring is locked. Unlock your keyring and retry." |
| Keyring access denied | Error: "Keyring access denied. Check permissions, run as correct user." |
| Corrupt token data read from store | Warning logged. Provider treated as unauthenticated. User runs `/auth login`. |
| Lock contention during refresh | Second process waits up to 10s for the lock. Each lock file covers one provider (default bucket) or one provider+bucket combination (named buckets). If timeout, refresh skipped (next request retries). |
| Stale lock (process crashed) | Lock older than 30s is automatically broken. Next process acquires and proceeds. |
| Both keyring and fallback fail | Error: "Credential storage unavailable. Use --key to provide API key directly, or install a keyring backend." |

## 5. Error Taxonomy

All storage errors surface through `SecureStoreError` with a code, message, and remediation string. The `KeyringTokenStore` translates these into user-appropriate behaviors:

| Code | Meaning | User-Facing Behavior |
|---|---|---|
| `UNAVAILABLE` | No keyring backend and fallback denied or failed | Error message with remediation: use `--key`, install keyring backend |
| `LOCKED` | OS keyring is locked (awaiting user unlock) | Error message: "Unlock your keyring" |
| `DENIED` | Permission denied accessing keyring | Error message: "Check permissions, run as correct user" |
| `CORRUPT` | Stored data cannot be parsed (invalid JSON) or fails schema validation after retrieval from SecureStore | Warning logged, token treated as missing. User re-authenticates. |
| `TIMEOUT` | Keyring operation timed out | Error propagated — user retries. SecureStore attempts keyring then fallback internally before this surfaces. |
| `NOT_FOUND` | No token stored for this provider+bucket | Normal condition — provider is unauthenticated |

For `saveToken`: `UNAVAILABLE`, `LOCKED`, and `DENIED` errors propagate to the caller (the `/auth login` command), which displays the error message and remediation.

For `getToken`: `CORRUPT` returns `null` with a warning log. `NOT_FOUND` returns `null` silently. `LOCKED`, `DENIED`, and `TIMEOUT` propagate as errors (active failures that the user can act on). Note: `SecureStore.get()` internally tries keyring then fallback before returning. If both are unavailable, `SecureStore` throws `UNAVAILABLE` and `getToken` propagates it. If only keyring is unavailable but fallback succeeds, no error is thrown — the fallback result is returned normally.

For `removeToken`: errors during deletion are logged but do not propagate (best-effort cleanup).

## 6. Multi-Instance Behavior

Multiple llxprt-code processes running simultaneously share the same keyring and fallback storage. This is the same shared-state model as before (plaintext files were also shared). Coordination specifics:

- **Token reads**: Concurrent reads are safe — keyring and file reads are atomic from the consumer's perspective.
- **Token writes**: Last writer wins. This is acceptable because writes only occur during login (user-initiated) and refresh (lock-protected).
- **Refresh locks**: File-based advisory locks in `~/.llxprt/oauth/locks/` ensure only one process refreshes a given provider+bucket at a time. Lock files contain `{pid, timestamp}` for stale detection.

## 7. Sandbox Behavior

### Pre-Proxy (before credential proxy ships — #1358)

`KeyringTokenStore` is not accessible from inside Docker/Podman containers. If `KeyringTokenStore` is invoked inside a sandbox environment (`process.env.SANDBOX` is set) and keyring is unavailable:

- Operations fail with error code `UNAVAILABLE` and a clear message: "Credential storage unavailable in sandbox mode. Use `--key` to provide an API key directly, or use seatbelt mode (macOS)."
- Users must use `--key`, `--key-name` (resolved on host before sandbox launch), or seatbelt mode.

### Post-Proxy (after credential proxy ships — #1358)

The inner (sandbox) process uses `ProxyTokenStore` — a separate `TokenStore` implementation that routes all credential operations through a Unix socket to the host process. `KeyringTokenStore` is never instantiated inside the container. The host-side proxy uses `KeyringTokenStore` to access the real keyring.

`ProxyTokenStore` is out of scope for this specification — it is defined in issue #1358.

## 8. Keyring-Unavailable Experience

When the OS keyring is completely unavailable (common in CI, Docker containers, headless servers, SSH without agent forwarding):

1. `SecureStore` detects unavailability during its probe (writes a test value, reads it back, deletes it).
2. All operations transparently use AES-256-GCM encrypted file fallback in `~/.llxprt/secure-store/llxprt-code-oauth/`.
3. Encrypted files are scoped to the machine (key derived from hostname + username via scrypt).
4. The user sees no difference in behavior — login, status, refresh, logout all work normally.
5. The only observable difference: tokens cannot be accessed if the user's home directory moves to a different machine (the encryption key derivation is machine-bound).

This matches the existing behavior of `ProviderKeyStorage` (API keys), `KeychainTokenStorage` (MCP tokens), `ToolKeyStorage`, and `ExtensionSettingsStorage` — all use SecureStore with the same fallback mechanism.

---

## technical-overview.md (Technical Specification)

# Technical Specification: KeyringTokenStore & Wiring

**Issues**: #1351 (KeyringTokenStore), #1352 (Wire as Default)
**Epic**: #1349 — Unified Credential Management, Phase A
**Status**: Specification — describes WHAT the system does, not how to build it

---

## Project Principles

- **NO backward compatibility shims.** No code reads `~/.llxprt/oauth/*.json` plaintext files. No detection of old format.
- **NO feature flags.** No environment variable, setting, or toggle selects between old and new storage. `KeyringTokenStore` unconditionally replaces `MultiProviderTokenStore` as the host-side `TokenStore` implementation. (A future `ProxyTokenStore` for sandbox mode is defined in #1358 — out of scope here.)
- **NO migrations.** Old plaintext files become inert. Users re-authenticate with `/auth login`.
- **Clean cut.** `MultiProviderTokenStore` is deleted entirely. Its export is removed from `packages/core/index.ts` and `packages/cli/src/auth/types.ts`.

---

## 1. Architecture

```
┌──────────────────────┐
│     OAuthManager     │  Programs against TokenStore interface.
│  (unchanged)         │  Receives TokenStore via constructor injection.
└──────────┬───────────┘
           │ TokenStore interface
           ▼
┌──────────────────────┐
│  KeyringTokenStore   │  NEW. Implements TokenStore.
│                      │  Translates provider+bucket → SecureStore account key.
│                      │  Serializes OAuthToken ↔ JSON string.
│                      │  Delegates all keyring/fallback to SecureStore.
│                      │  Manages file-based advisory locks independently.
└──────────┬───────────┘
           │ SecureStore.set/get/delete/list/has
           ▼
┌──────────────────────┐
│     SecureStore      │  EXISTING. Service name: 'llxprt-code-oauth'.
│  ('llxprt-code-oauth')│  Handles: OS keyring primary, AES-256-GCM fallback.
│                      │  Versioned envelope {"v":1,"data":...}.
│                      │  Probe caching, consecutive failure tracking.
└──────────────────────┘
```

`KeyringTokenStore` is a thin, focused wrapper. It owns:
- Account naming convention (`provider:bucket`)
- Input validation (provider and bucket name format)
- JSON serialization/deserialization of `OAuthToken`
- Token schema validation on read
- File-based advisory refresh locks
- Translation of `SecureStoreError` into appropriate `TokenStore` behaviors (null returns vs. thrown errors)

`KeyringTokenStore` does NOT own:
- Keyring access (SecureStore)
- Encrypted file fallback (SecureStore)
- Availability probing (SecureStore)
- Encryption/decryption (SecureStore)
- Retry logic for transient failures (SecureStore)

This mirrors the pattern established by `ProviderKeyStorage`, which wraps `SecureStore('llxprt-code-provider-keys')` with key-name validation and value trimming.

## 2. Class Design

### KeyringTokenStore

**Location**: `packages/core/src/auth/keyring-token-store.ts`

**Implements**: `TokenStore` (from `packages/core/src/auth/token-store.ts`)

**Constructor**: `constructor(options?: { secureStore?: SecureStore })`

- Accepts an optional pre-configured `SecureStore` instance for testing and shared-instance wiring.
- When not provided, constructs `new SecureStore('llxprt-code-oauth', { fallbackDir: ~/.llxprt/secure-store/llxprt-code-oauth, fallbackPolicy: 'allow' })`.
- Follows the same optional-injection pattern as `ProviderKeyStorage`.

**Constants**:
- Service name: `llxprt-code-oauth`
- Account name format: `{provider}:{bucket}` (e.g., `anthropic:default`, `gemini:work`)
- Default bucket: `default`
- Name validation regex: `/^[a-zA-Z0-9_-]+$/` — applied to both provider and bucket names
- Lock directory: `~/.llxprt/oauth/locks/`
- Default lock wait: 10000ms
- Default stale threshold: 30000ms

### TokenStore Interface Methods

| Method | KeyringTokenStore Behavior |
|---|---|
| `saveToken(provider, token, bucket?)` | Validates provider/bucket names. Validates token with `OAuthTokenSchema.passthrough().parse()`. Calls `secureStore.set(accountKey, JSON.stringify(validatedToken))`. |
| `getToken(provider, bucket?)` | Validates provider/bucket names. Calls `secureStore.get(accountKey)`. If `null`, returns `null`. Parses JSON, validates with `OAuthTokenSchema.passthrough().parse()`. On parse/validation failure: logs warning with `CORRUPT` code, returns `null`, does NOT delete the entry. |
| `removeToken(provider, bucket?)` | Validates provider/bucket names. Calls `secureStore.delete(accountKey)`. Errors are caught and logged (best-effort). |
| `listProviders()` | Calls `secureStore.list()`. Parses account keys, extracts unique provider names (portion before `:`). Returns sorted. On any `SecureStoreError`, returns empty array (degraded but functional). |
| `listBuckets(provider)` | Calls `secureStore.list()`. Filters to keys starting with `{provider}:`. Extracts bucket portion (after `:`). Returns sorted. On any `SecureStoreError`, returns empty array (degraded but functional). |
| `getBucketStats(provider, bucket)` | Validates provider and bucket names. Calls `getToken()` to check existence. If token exists, returns `{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`. If not, returns `null`. Same placeholder behavior as current implementation. |
| `acquireRefreshLock(provider, options?)` | File-based advisory lock. `options` may include `{ waitMs?, staleMs?, bucket? }`. Lock file: `~/.llxprt/oauth/locks/{provider}-refresh.lock` for default bucket, `~/.llxprt/oauth/locks/{provider}-{options.bucket}-refresh.lock` for named buckets. Content: `{pid, timestamp}`. Uses exclusive write (`wx` flag). Polls with 100ms interval. Breaks stale locks (age > `staleMs`). Returns `true` if acquired within `waitMs`, `false` on timeout. |
| `releaseRefreshLock(provider, bucket?)` | Deletes lock file. ENOENT errors ignored. |

## 3. Storage Mapping

### SecureStore Configuration

| Property | Value |
|---|---|
| Service name | `llxprt-code-oauth` |
| Fallback directory | `~/.llxprt/secure-store/llxprt-code-oauth/` |
| Fallback policy | `allow` |
| Keyring loader | Default (`createDefaultKeyringAdapter`) |

### Account Naming Convention

```
{provider}:{bucket}
```

Examples:
- `gemini:default` — Gemini with the default bucket
- `qwen:work` — Qwen with the "work" bucket
- `anthropic:default` — Anthropic with the default bucket
- `codex:default` — Codex with the default bucket

The colon separator is safe because both provider and bucket names are validated against `[a-zA-Z0-9_-]`, which excludes colons. The colon is also a valid character for OS keyring account names across macOS Keychain, GNOME Keyring, and Windows Credential Manager.

### Serialization Format

The value stored in SecureStore is `JSON.stringify(validatedToken)`, where `validatedToken` is the output of `OAuthTokenSchema.passthrough().parse(token)`.

The `.passthrough()` is critical: it preserves provider-specific extra fields (e.g., `account_id` for Codex tokens, which extends `OAuthTokenSchema` with additional fields). Without `.passthrough()`, Zod's default `.strip()` behavior would silently drop these fields.

SecureStore wraps this JSON string in its own versioned envelope `{"v":1,...}` for the encrypted file fallback. The keyring stores the raw JSON string directly.

### Example Stored Value

For `anthropic:default`:
```json
{
  "access_token": "ant-...",
  "refresh_token": "ant-rt-...",
  "expiry": 1739280000,
  "token_type": "Bearer"
}
```

For `codex:default` (with passthrough fields):
```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expiry": 1739280000,
  "token_type": "Bearer",
  "account_id": "org-...",
  "id_token": "eyJ..."
}
```

## 4. Token Validation

### On Write (`saveToken`)

`OAuthTokenSchema.passthrough().parse(token)` — validates the token conforms to the schema while preserving extra fields. Throws `ZodError` if the token is structurally invalid. This is a programming error (caller provided garbage) and should propagate.

### On Read (`getToken`)

1. `secureStore.get(accountKey)` returns raw JSON string or `null`.
2. If `null` → return `null` (not found).
3. `JSON.parse(raw)` — if this throws, the data is corrupt.
4. `OAuthTokenSchema.passthrough().parse(parsed)` — if this throws, the data does not match the expected schema.
5. On any parse/validation failure in steps 3-4:
   - Log a warning with the provider:bucket identifier **hashed** (not raw) and the validation error message. No secret values are logged. Example: `"Corrupt token for [hashed-id] (CORRUPT): Expected string, received number"`
   - Return `null`
   - Do NOT delete the entry from SecureStore

The "do not delete" policy is deliberate: the corrupt data may be recoverable, may be from a newer version of the application, or may be useful for debugging. Automatic deletion would make diagnosis harder.

## 5. Refresh Lock Mechanism

The file-based advisory lock mechanism is carried forward unchanged from `MultiProviderTokenStore`. It is NOT moved into SecureStore because locks are coordination primitives, not credentials.

### Lock File Location

`~/.llxprt/oauth/locks/{provider}-refresh.lock` or `~/.llxprt/oauth/locks/{provider}-{bucket}-refresh.lock`

Lock files live in `~/.llxprt/oauth/locks/`, a dedicated subdirectory separating coordination primitives from inert token data. The naming convention uses `{provider}-refresh.lock` for the default bucket and `{provider}-{bucket}-refresh.lock` for named buckets. The `locks/` subdirectory is created on demand with mode `0o700`.

Lock files are plaintext `{pid, timestamp}` JSON — they contain no secrets and do not need encryption.

The `~/.llxprt/oauth/` directory is created on demand with mode `0o700`.

### Lock File Format

```json
{"pid": 12345, "timestamp": 1739280000000}
```

### Lock Acquisition Algorithm

1. Ensure `~/.llxprt/oauth/locks/` directory exists (created with mode `0o700`).
2. Attempt exclusive write (`wx` flag) of lock file with current PID and timestamp.
3. If write succeeds → lock acquired, return `true`.
4. If file exists (EEXIST) → read existing lock.
5. If lock age > `staleMs` (default 30s) → break lock (delete file), retry.
6. If lock is fresh → wait 100ms, retry.
7. If total wait > `waitMs` (default 10s) → return `false` (timeout).
8. If lock file is unreadable/corrupt → break lock, retry.

### Lock Release

Delete the lock file. ENOENT is ignored (idempotent release).

### Lock File Naming vs. Account Key Naming

Lock file names use `{provider}-{bucket}-refresh.lock` format (dash-separated), NOT the `{provider}:{bucket}` colon-separated format used for SecureStore account keys. The two naming conventions serve different purposes: account keys identify entries in SecureStore (colon-separated), lock files coordinate processes on the filesystem (dash-separated).

## 6. Wiring: Production Instantiation Sites

Two sites currently construct `MultiProviderTokenStore`. Both change to construct `KeyringTokenStore`.

### Site 1: `packages/cli/src/runtime/runtimeContextFactory.ts`

**Current** (line ~263):
```typescript
const tokenStore =
  sharedTokenStore ?? (sharedTokenStore = new MultiProviderTokenStore());
```

**After**:
```typescript
const tokenStore =
  sharedTokenStore ?? (sharedTokenStore = new KeyringTokenStore());
```

This is the primary runtime path. The `sharedTokenStore` module-level variable ensures a single `KeyringTokenStore` instance is shared across all runtimes in the process. The `SecureStore` inside it caches its keyring probe result. Because there is a single shared instance and `SecureStore` has a probe TTL of 60 seconds, the OS keyring is effectively probed once at startup and not again for the lifetime of most sessions. The shared instance satisfies issue #1352's requirement that the probe happens "once per process, not once per provider/bucket."

### Site 2: `packages/cli/src/providers/providerManagerInstance.ts`

**Current** (line ~242):
```typescript
const tokenStore = new MultiProviderTokenStore();
```

**After**:
```typescript
const tokenStore = new KeyringTokenStore();
```

This site is used in the `createProviderManager` factory. Rather than creating a local instance per call, it should use the same shared `KeyringTokenStore` singleton as Site 1. All construction sites must converge on a single shared instance to satisfy issue #1352's requirement that the keyring probe happens "once per process, not once per provider/bucket."

### Additional Construction Sites

There are additional `new MultiProviderTokenStore()` calls in:
- `packages/cli/src/ui/commands/authCommand.ts` (lines ~40, ~662) — used in `/auth` command handlers
- `packages/cli/src/ui/commands/profileCommand.ts` (lines ~100, ~347) — used in profile bucket enumeration

All of these change to use the shared `KeyringTokenStore` singleton (same instance as Sites 1 and 2). No additional `new KeyringTokenStore()` calls — all sites import and use the shared module-level instance.

### Sandbox Considerations

In sandbox (Docker/Podman) environments where `process.env.SANDBOX` is set:
- **Pre-proxy** (before #1358): If keyring is unavailable inside the container, `KeyringTokenStore` operations fail with `UNAVAILABLE`. Users must use `--key` for API key auth, or seatbelt mode (macOS).
- **Post-proxy** (after #1358): The inner process uses `ProxyTokenStore` (a future `TokenStore` implementation from #1358) instead of `KeyringTokenStore`. The host-side proxy uses `KeyringTokenStore` to access the real keyring.

`ProxyTokenStore` is out of scope for this specification.

### Import Changes

All files that import `MultiProviderTokenStore` switch to import `KeyringTokenStore`:
- From `@vybestack/llxprt-code-core` in packages that depend on core
- From relative paths within core

## 7. Deletion: What Gets Removed

### MultiProviderTokenStore Class

The entire `MultiProviderTokenStore` class in `packages/core/src/auth/token-store.ts` is deleted. The `TokenStore` interface in the same file is preserved — it is the contract that `KeyringTokenStore` implements.

The `LockInfo` interface (private to `MultiProviderTokenStore`) is either deleted or moved to `KeyringTokenStore` if the lock mechanism is defined there.

### Exports

- `packages/core/index.ts`: Remove `export { MultiProviderTokenStore } from './src/auth/token-store.js'`. Add `export { KeyringTokenStore } from './src/auth/keyring-token-store.js'`.
- `packages/cli/src/auth/types.ts`: Remove `export { MultiProviderTokenStore } from '@vybestack/llxprt-code-core'`. Add `export { KeyringTokenStore } from '@vybestack/llxprt-code-core'`.

### Test Files

- `packages/core/src/auth/token-store.spec.ts` — currently tests `MultiProviderTokenStore`. Deleted along with the class it tests.
- `packages/core/src/auth/token-store.refresh-race.spec.ts` — currently tests refresh lock race conditions against `MultiProviderTokenStore`. Deleted along with the class it tests.
- New test files `packages/core/src/auth/keyring-token-store.spec.ts` (and optionally `keyring-token-store.lock.spec.ts`) are created to test `KeyringTokenStore` against the `TokenStore` interface with a real (injected) `SecureStore` using a test `keyringLoader`. These are new files, not renames.
- Integration and command tests in `packages/cli/` that construct `MultiProviderTokenStore` are updated to construct `KeyringTokenStore`.

### What Is NOT Deleted

- `TokenStore` interface — kept, it is the contract.
- `OAuthTokenSchema` — kept, used for validation.
- `BucketStats` type — kept, used by the interface.
- `~/.llxprt/oauth/` directory on user systems — not touched. Old files are simply ignored.
- `~/.llxprt/oauth/locks/` directory — used for refresh lock files.

## 8. Test Strategy

Tests are behavioral — they verify observable `TokenStore` interface behaviors, not implementation details.

### Core Behavioral Tests (`KeyringTokenStore`)

Tests inject a real `SecureStore` configured with an in-memory `KeyringAdapter` (a test double that stores values in a `Map`). This tests the actual integration between `KeyringTokenStore` and `SecureStore` without hitting the OS keyring.

The new tests must cover the same behavioral patterns as the deleted `token-store.spec.ts` and `token-store.refresh-race.spec.ts` — all observable `TokenStore` interface behaviors must have equivalent coverage.

**Token CRUD behaviors:**
- Save a token, read it back — values match including passthrough fields.
- Save to different providers and buckets — isolated correctly.
- Read a non-existent token — returns `null`.
- Remove a token — subsequent read returns `null`.
- Remove a non-existent token — succeeds silently.

**Listing behaviors:**
- `listProviders()` returns sorted unique provider names from stored tokens.
- `listProviders()` with no tokens returns empty array.
- `listBuckets(provider)` returns sorted bucket names for that provider.
- `listBuckets(provider)` with no tokens for that provider returns empty array.

**Validation behaviors:**
- Save with invalid provider name (contains `:`, `/`, spaces) — throws.
- Save with invalid bucket name — throws.
- Read corrupt data (invalid JSON in SecureStore) — returns `null`, logs warning.
- Read schema-invalid data (valid JSON, wrong shape) — returns `null`, logs warning.
- Corrupt data is NOT deleted from SecureStore after failed read.

**Bucket stats behaviors:**
- `getBucketStats()` for existing token returns stats object.
- `getBucketStats()` for non-existent token returns `null`.

**Default bucket behaviors:**
- `saveToken('gemini', token)` without bucket uses `default` → account key `gemini:default`.
- `saveToken('gemini', token, 'default')` is equivalent.

### Refresh Lock Behavioral Tests

Tests use the real filesystem (temp directory) for lock files since locks are file-based.

- Acquire lock — returns `true`.
- Acquire already-held lock — blocks, returns `false` after timeout.
- Release lock then acquire — returns `true`.
- Stale lock (old timestamp) — automatically broken, new lock acquired.
- Corrupt lock file — automatically broken, new lock acquired.
- Concurrent acquisition — only one succeeds (other waits/timeouts).

### SecureStore Error Handling Tests

Tests inject a `KeyringAdapter` that throws specific errors to verify `KeyringTokenStore`'s error translation:

- Keyring throws "locked" → `saveToken` propagates `SecureStoreError` with code `LOCKED`.
- Keyring throws "denied" → `saveToken` propagates `SecureStoreError` with code `DENIED`.
- Keyring unavailable, fallback allowed → operations succeed via fallback.
- Keyring unavailable, fallback denied → `saveToken` throws `UNAVAILABLE`.

### Wiring Verification

- The production sites construct `KeyringTokenStore`.
- `OAuthManager` receives a `TokenStore` and calls its methods — this is already tested by existing `OAuthManager` tests which program against the interface.

### CI Dual-Path Requirement

Per issue #1352, CI must run `KeyringTokenStore` behavioral tests in **separate CI jobs** for two configurations:
- **Keyring-available job**: default mode — the injected `KeyringAdapter` (in-memory test double) is present. Tests exercise the keyring → SecureStore path.
- **Keyring-unavailable job**: the injected `keyringLoader` returns `null` (simulating missing `@napi-rs/keyring` module). Tests exercise the AES-256-GCM encrypted file fallback path exclusively.

Both jobs run the same behavioral test suite. Both must pass. This ensures the fallback path is not a second-class citizen and that failures in either path are caught independently.

### What Is NOT Tested

- OS keyring integration (requires real keyring daemon — covered by SecureStore's own tests).
- Encrypted file fallback encryption/decryption (covered by SecureStore's own tests).
- `OAuthManager` internals (unchanged, already tested).
- Old `MultiProviderTokenStore` behavior (deleted).

## 9. Error Mapping

`KeyringTokenStore` methods handle `SecureStoreError` as follows:

### saveToken

| SecureStoreError Code | KeyringTokenStore Behavior |
|---|---|
| `UNAVAILABLE` | Propagate — caller (login command) displays error + remediation |
| `LOCKED` | Propagate — caller displays "unlock your keyring" |
| `DENIED` | Propagate — caller displays "check permissions" |
| `TIMEOUT` | Propagate — caller may retry |
| (any other) | Propagate — unexpected, let it surface |

### getToken

| SecureStoreError Code | KeyringTokenStore Behavior |
|---|---|
| `UNAVAILABLE` | Propagate — both keyring and fallback failed, storage is inaccessible |
| `CORRUPT` (from SecureStore) | Log warning, return `null` — SecureStore could not decrypt its envelope |
| `LOCKED` | Propagate — user needs to unlock keyring |
| `DENIED` | Propagate — permission issue |
| `TIMEOUT` | Propagate — active failure, user should see error and retry |

Additionally, `getToken` detects corruption at its own layer: if `SecureStore.get()` returns a non-null string but `JSON.parse()` or `OAuthTokenSchema.passthrough().parse()` fails, `KeyringTokenStore` logs a warning (classified as `CORRUPT` in the error taxonomy) and returns `null`. The corrupt entry is NOT deleted from SecureStore. This is a separate detection layer from SecureStore's own `CORRUPT` error — SecureStore detects envelope/decryption corruption, while `KeyringTokenStore` detects payload/schema corruption.

When `SecureStore.get()` returns `null` (entry not found in either keyring or fallback), `getToken` returns `null` directly — this is the normal "unauthenticated" path and does not involve `SecureStoreError`. `SecureStoreError` is thrown only for active failures where storage is present but inaccessible (locked, denied, timeout, both backends unavailable).

### removeToken

| SecureStoreError Code | KeyringTokenStore Behavior |
|---|---|
| (any) | Log warning, do not propagate — best-effort cleanup |

### listProviders / listBuckets

| SecureStoreError Code | KeyringTokenStore Behavior |
|---|---|
| (any) | Return empty array — degraded but functional |

## 10. Current Codebase State

### Already Exists (Merged on Main)

| Component | Location | Status |
|---|---|---|
| `SecureStore` | `packages/core/src/storage/secure-store.ts` | Done (#1350) |
| `SecureStoreError`, `SecureStoreErrorCode` | Same file | Done (#1350) |
| `KeyringAdapter` interface | Same file | Done (#1350) |
| `createDefaultKeyringAdapter()` | Same file | Done (#1350) |
| `ProviderKeyStorage` | `packages/core/src/storage/provider-key-storage.ts` | Done (#1353) |
| `ToolKeyStorage` (refactored) | `packages/core/src/tools/tool-key-storage.ts` | Done (#1355) |
| `KeychainTokenStorage` (refactored) | `packages/core/src/mcp/token-storage/keychain-token-storage.ts` | Done (#1356) |
| `ExtensionSettingsStorage` (refactored) | Refactored to SecureStore | Done (#1355) |
| `TokenStore` interface | `packages/core/src/auth/token-store.ts` | Exists, preserved |
| `MultiProviderTokenStore` | Same file | Exists, TO BE DELETED |
| `OAuthTokenSchema` | `packages/core/src/auth/types.ts` | Exists, preserved |
| `OAuthManager` | `packages/cli/src/auth/oauth-manager.ts` | Exists, unchanged (programs against `TokenStore`) |

### Created by #1351

| Component | Location |
|---|---|
| `KeyringTokenStore` class | `packages/core/src/auth/keyring-token-store.ts` |
| `KeyringTokenStore` tests | `packages/core/src/auth/keyring-token-store.spec.ts` |
| `KeyringTokenStore` lock tests | `packages/core/src/auth/keyring-token-store.lock.spec.ts` (or combined) |

### Modified by #1352

| File | Change |
|---|---|
| `packages/core/src/auth/token-store.ts` | `MultiProviderTokenStore` class deleted. `TokenStore` interface preserved. |
| `packages/core/index.ts` | `MultiProviderTokenStore` export removed, `KeyringTokenStore` export added |
| `packages/cli/src/auth/types.ts` | `MultiProviderTokenStore` re-export removed, `KeyringTokenStore` re-export added |
| `packages/cli/src/runtime/runtimeContextFactory.ts` | Import + construction changed |
| `packages/cli/src/providers/providerManagerInstance.ts` | Import + construction changed |
| `packages/cli/src/ui/commands/authCommand.ts` | Import + construction changed |
| `packages/cli/src/ui/commands/profileCommand.ts` | Import + construction changed |
| `packages/cli/src/providers/oauth-provider-registration.ts` | Type import changed |
| Integration/command tests referencing `MultiProviderTokenStore` | Updated to `KeyringTokenStore` |

### Deleted by #1352

| What | Where |
|---|---|
| `MultiProviderTokenStore` class | `packages/core/src/auth/token-store.ts` |
| `MultiProviderTokenStore` export | `packages/core/index.ts` |
| `MultiProviderTokenStore` re-export | `packages/cli/src/auth/types.ts` |
| `token-store.spec.ts` | `packages/core/src/auth/token-store.spec.ts` (tests deleted class) |
| `token-store.refresh-race.spec.ts` | `packages/core/src/auth/token-store.refresh-race.spec.ts` (tests deleted class) |

## 11. Consistency with Existing SecureStore Wrappers

`KeyringTokenStore` follows the established thin-wrapper pattern:

| Wrapper | Service Name | Account Key | Serialization | Fallback |
|---|---|---|---|---|
| `ProviderKeyStorage` | `llxprt-code-provider-keys` | Key name (e.g., `anthropic-main`) | Raw string (trimmed) | allow |
| `KeychainTokenStorage` | `llxprt-cli-mcp-oauth` | Sanitized server name | `JSON.stringify(credentials)` | allow |
| `ToolKeyStorage` | `llxprt-code-tool-keys` | `{toolName}` | Raw string | allow |
| `ExtensionSettingsStorage` | `llxprt-code-extension-settings` | Extension display name | Raw string | allow |
| **`KeyringTokenStore`** | **`llxprt-code-oauth`** | **`{provider}:{bucket}`** | **`JSON.stringify(token)`** | **allow** |

All wrappers:
- Accept optional `SecureStore` in constructor for testability
- Validate input names before delegating to SecureStore
- Handle their own serialization format
- Delegate all keyring/fallback logic to SecureStore
- Use `fallbackPolicy: 'allow'` for graceful degradation
