# Specification Documents for Issues #1351 and #1352

## Issue #1351 Text (authoritative)

Parent: #1349 (Epic: Unified Credential Management)
Depends on: #1350 (SecureStore)

## Problem

`MultiProviderTokenStore` stores OAuth tokens as plaintext JSON files in `~/.llxprt/oauth/{provider}-{bucket}.json`. These files have `0o600` permissions but are still readable by any process running as the same user, and are mounted into sandbox containers.

## Solution

New `KeyringTokenStore` class implementing the existing `TokenStore` interface (`core/src/auth/token-store.ts`), backed by `SecureStore` from #1350.

`KeyringTokenStore` is a **host-side component**. Sandbox credential access is handled by a separate proxy defined in #1358 — out of scope here.

### Storage mapping

- Service name: `llxprt-code-oauth`
- Account naming: `{provider}:{bucket}` (e.g. `anthropic:default`, `gemini:work`)
- Escaping: provider and bucket names are validated to contain only `[a-zA-Z0-9_-]`. If either contains `:` or other special characters, `saveToken` rejects with a clear error.
- Value: `JSON.stringify(OAuthToken)` wrapped in the SecureStore versioned envelope

### Interface implementation

```
saveToken(provider, token, bucket?)    -> validate with OAuthTokenSchema.passthrough().parse() -> secureStore.set(provider:bucket, JSON.stringify(validated))
getToken(provider, bucket?)            -> secureStore.get(provider:bucket) -> JSON.parse -> OAuthTokenSchema.passthrough().parse()
removeToken(provider, bucket?)         -> secureStore.delete(provider:bucket)
listProviders()                        -> secureStore.list() -> parse account names -> unique providers
listBuckets(provider)                  -> secureStore.list() -> filter by provider prefix -> extract bucket names
getBucketStats(provider, bucket)       -> read token, compute stats from expiry/scope
acquireRefreshLock(provider, options?)  -> file-based advisory lock (unchanged from MultiProviderTokenStore)
releaseRefreshLock(provider, bucket?)  -> release file-based lock
```

Note: `.passthrough()` is used instead of bare `.parse()` to preserve provider-specific fields (e.g., Codex tokens include `account_id` and `id_token` which are not in the base `OAuthTokenSchema`). Without `.passthrough()`, Zod's default `.strip()` mode would silently drop these fields during round-trip storage.

### Invalid token handling

When `getToken` reads a value that fails `OAuthTokenSchema` validation (corrupt data, schema mismatch, envelope version mismatch):
- Log a warning with the provider:bucket identifier (hashed) and the validation error (no secret values), using error taxonomy code `CORRUPT`
- Return `null` (same as "no token found")
- Do NOT silently delete the corrupt entry — it may be recoverable or useful for debugging
- The caller (OAuthManager) treats null as "needs login" and prompts the user

### Refresh lock coordination

Keeps the existing file-based advisory locks. Lock files live in `~/.llxprt/oauth/locks/` on the host. These are coordination primitives, not credentials, so they are unaffected by the keyring migration.

The lock uses PID + timestamp for stale detection, same as today. This preserves multi-instance coordination behavior.

### Fallback policy

- Keyring primary, AES-256-GCM encrypted file fallback (via `SecureStore`)
- Transparent fallback — user sees no difference in behavior when keyring is unavailable
- Matches the existing behavior of `ProviderKeyStorage`, `KeychainTokenStorage`, `ToolKeyStorage`, and `ExtensionSettingsStorage`

### No migration

Old `~/.llxprt/oauth/*.json` plaintext files become inert. Users run `/auth login` again. `MultiProviderTokenStore` is deleted — git history is the reference.

## Acceptance criteria

- Implements all methods of the `TokenStore` interface
- Passes behavioral tests matching the patterns in `token-store.spec.ts` and `token-store.refresh-race.spec.ts`
- Validates tokens on read with `OAuthTokenSchema.passthrough()` — corrupt/invalid entries return null with logged warning, never throw
- Provider:bucket account naming validated — rejects special characters in provider/bucket names
- `listProviders()` and `listBuckets()` correctly parse the `{provider}:{bucket}` account naming
- File-based refresh locks work identically to current behavior
- Encrypted file fallback works when keyring is unavailable
- **Multiprocess race condition tests**: concurrent refresh + removeToken (logout during refresh), concurrent saveToken from two processes — tested via spawned child processes, not just in-memory concurrency
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

OAuth tokens for providers (Gemini, Qwen, Anthropic, Codex) are currently stored as plaintext JSON files in `~/.llxprt/oauth/`. Each provider's token is a file like `gemini-default.json` or `qwen-work.json` (named `{provider}-{bucket}.json`) containing the raw `access_token`, `refresh_token`, `expiry`, and related fields in cleartext.

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

Tokens are stored in the OS keyring (macOS Keychain, GNOME Keyring / KWallet on Linux, Windows Credential Manager). Each provider+bucket combination is a separate entry.

If the OS keyring is unavailable (headless Linux, SSH sessions, CI environments), tokens are stored in encrypted files automatically. This fallback is transparent — the user is not asked to choose.

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
3. Token response is validated.
4. Token is stored securely — the OS keyring is attempted first; if unavailable, an encrypted file fallback is used.
5. `/auth status` confirms active session.

### Token Read (Startup / API Call)

1. Application requests token for a provider+bucket pair.
2. Token is retrieved from secure storage (keyring or encrypted fallback).
3. Token is validated against the expected schema. Provider-specific fields (e.g., Codex's `account_id`) are preserved during validation.
4. If validation succeeds, token is returned to the caller.
5. If validation fails (corrupt data, schema mismatch), a warning is logged with a hashed identifier (not raw provider:bucket). No secret values are logged. The provider is treated as unauthenticated. The corrupt entry is NOT deleted — it is preserved for potential manual inspection.

### Token Refresh

1. Before making an API call, the application checks if the token is expired or near expiry.
2. A file-based advisory lock prevents concurrent refresh attempts across processes.
3. The provider's refresh endpoint is called with the `refresh_token`.
4. The refreshed token is validated and stored, replacing the previous token.
5. The advisory lock is released.
6. If refresh fails and no valid token remains, the user must `/auth login` again.

### Proactive Renewal

1. After a successful token read, the application may schedule a background renewal timer.
2. When the timer fires, the same refresh flow executes.
3. This is unchanged from current behavior.

### Logout

1. User runs `/auth logout <provider>` (optionally with `--bucket <name>`).
2. Token is removed from secure storage. Deletion is best-effort — errors are logged but do not prevent logout from completing.
3. `/auth status` confirms no active session.

### Bucket Failover

1. If the active bucket's token is expired and non-refreshable, other buckets for the same provider are checked.
2. The first valid, non-expired token's bucket becomes the active bucket.
3. This behavior is unchanged.

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
| Lock contention during refresh | Second process waits briefly for the lock. If timeout, refresh skipped (next request retries). |
| Stale lock (process crashed) | Stale locks are automatically broken. Next process acquires and proceeds. |
| Both keyring and fallback fail | Error: "Credential storage unavailable. Use --key to provide API key directly, or install a keyring backend." |

## 5. Error Taxonomy

Storage errors surface through `SecureStoreError` with a code, message, and remediation string. The `KeyringTokenStore` translates these into user-appropriate behaviors for CRUD operations (`saveToken`, `getToken`, `removeToken`). List operations (`listProviders`, `listBuckets`) degrade to empty arrays on any error — see below.

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

For `listProviders` / `listBuckets`: on any `SecureStoreError`, return an empty array rather than propagating the error. These are informational methods used in `/auth status` and bucket enumeration — a degraded empty result keeps the UI functional when the keyring is temporarily inaccessible. This means the error taxonomy codes (`LOCKED`, `DENIED`, etc.) do not surface through list methods. The same pattern is used by other SecureStore wrappers' list operations.

## 6. Multi-Instance Behavior

Multiple llxprt-code processes running simultaneously share the same credential storage. This is the same shared-state model as before (plaintext files were also shared).

- **Token reads**: Concurrent reads are safe.
- **Token writes**: Last writer wins. Acceptable because writes only occur during login (user-initiated) and refresh (lock-protected).
- **Refresh locks**: File-based advisory locks ensure only one process refreshes a given provider+bucket at a time. Stale locks from crashed processes are automatically broken.

## 7. Keyring-Unavailable Experience

When the OS keyring is unavailable (common in CI, headless servers, SSH without agent forwarding):

1. Unavailability is detected automatically.
2. All operations transparently use encrypted file fallback.
3. The user sees no difference in behavior — login, status, refresh, logout all work normally.
4. The only observable difference: tokens cannot be accessed if the user's home directory moves to a different machine (the fallback encryption is machine-bound).

This matches the existing behavior of `ProviderKeyStorage`, `KeychainTokenStorage`, `ToolKeyStorage`, and `ExtensionSettingsStorage`.

`KeyringTokenStore` is a host-side component. Sandbox credential access is handled by a separate proxy (#1358) — out of scope here.

## 8. Acceptance Criteria (from Issues)

From #1351:
- All `TokenStore` interface behaviors have equivalent coverage in new tests
- Multiprocess race conditions (concurrent refresh, refresh+logout) are tested with spawned child processes
- Corrupt token handling verified (returns null, logs warning, does not delete)

From #1352:
- All existing OAuth integration tests pass with the new storage backend
- `/auth login` stores tokens in keyring (not plaintext files)
- `/auth status` reads tokens from keyring
- Token refresh cycle works: expire → lock → refresh → save → unlock
- Token lifecycle works end-to-end: login → store → read → refresh → logout
- Multiple providers work simultaneously
- CI runs both keyring-available and keyring-unavailable paths in separate jobs
- Keyring probe happens once per process, not once per provider/bucket

---

## technical-overview.md (Technical Specification)

# Technical Specification: KeyringTokenStore

**Issues**: #1351 (KeyringTokenStore), #1352 (Wire as Default)
**Epic**: #1349 — Unified Credential Management, Phase A
**Status**: Specification — describes the technical design, not implementation steps

---

## Project Principles

- **NO backward compatibility shims.** No code reads `~/.llxprt/oauth/*.json` plaintext files. No detection of old format.
- **NO feature flags.** No environment variable, setting, or toggle selects between old and new storage. `KeyringTokenStore` unconditionally replaces `MultiProviderTokenStore` as the host-side `TokenStore` implementation. (A future `ProxyTokenStore` for sandbox mode is defined in #1358 — out of scope here.)
- **NO migrations.** Old plaintext files become inert. Users re-authenticate with `/auth login`.
- **Clean cut.** `MultiProviderTokenStore` is deleted from the codebase.

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

The `.passthrough()` is critical: it preserves provider-specific extra fields (e.g., `account_id` for Codex tokens, which extends `OAuthTokenSchema` with additional fields). Without `.passthrough()`, Zod's default `.strip()` behavior would silently drop these fields. Note: issue #1351 references `OAuthTokenSchema.parse`; `.passthrough()` is used here deliberately to avoid data loss.

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
   - Log a warning with the provider:bucket identifier **hashed with SHA-256** (not raw) and the validation error message. No secret values are logged. Example: `"Corrupt token for [sha256-hash] (CORRUPT): Expected string, received number"`
   - Return `null`
   - Do NOT delete the entry from SecureStore

The "do not delete" policy is deliberate: the corrupt data may be recoverable, may be from a newer version of the application, or may be useful for debugging. Automatic deletion would make diagnosis harder.

## 5. Refresh Lock Mechanism

The file-based advisory lock mechanism is carried forward from `MultiProviderTokenStore`. It is NOT moved into SecureStore because locks are coordination primitives, not credentials.

### Lock File Location

`~/.llxprt/oauth/locks/{provider}-refresh.lock` or `~/.llxprt/oauth/locks/{provider}-{bucket}-refresh.lock`

Lock files live in `~/.llxprt/oauth/locks/`, a dedicated subdirectory separating coordination primitives from inert token data. The naming convention uses `{provider}-refresh.lock` for the default bucket and `{provider}-{bucket}-refresh.lock` for named buckets. The `locks/` subdirectory is created on demand with mode `0o700`.

Lock files are plaintext `{pid, timestamp}` JSON — they contain no secrets and do not need encryption.

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

## 6. Error Mapping

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

## 7. Probe-Once Constraint

Per issue #1352, the keyring availability probe must happen once per process, not once per provider/bucket. The `SecureStore` instance inside `KeyringTokenStore` caches its probe result for the lifetime of the instance. Sharing a single `KeyringTokenStore` instance across all production call sites is the simplest way to satisfy this, but the constraint is about probe frequency, not about instance cardinality — any approach that ensures the probe runs at most once is acceptable.

## 8. Dual-Mode Operation

`KeyringTokenStore` must function correctly in both keyring-available and keyring-unavailable environments. This is not a toggle — SecureStore transparently handles the fallback. Both code paths must have equivalent behavioral coverage to ensure the fallback path is not a second-class citizen.

## 9. Deliberate Divergences from Issue Text

| Issue Text | Spec Behavior | Rationale |
|---|---|---|
| #1351 says `OAuthTokenSchema.parse` on read | Spec uses `OAuthTokenSchema.passthrough().parse()` on both read and write | Zod's default `.parse()` strips unknown fields. Codex tokens include `account_id` and `id_token` which are not in the base schema. `.passthrough()` preserves these provider-specific fields. Without it, round-tripping a Codex token through save+load would silently lose data. |
| #1351 defines sandbox pre-proxy behavior (fail with `UNAVAILABLE`, suggest `--key`/`SANDBOX_ENV`/seatbelt) | Spec scopes sandbox behavior out entirely | Sandbox credential access is handled by a separate proxy defined in #1358. `KeyringTokenStore` is a host-side component — its behavior inside a container is #1358's concern. The pre-proxy fallback described in #1351 will be addressed in that issue's spec. |

## 10. Consistency with Existing SecureStore Wrappers

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

---

## requirements.md (EARS Requirements)

# Requirements (EARS Format)

Issues: #1351 (KeyringTokenStore), #1352 (Wire as Default)
Parent Epic: #1349 (Unified Credential Management — Keyring-First)

EARS patterns used:
- **Ubiquitous**: The [system] shall [behavior].
- **Event-driven**: When [trigger], the [system] shall [behavior].
- **State-driven**: While [state], the [system] shall [behavior].
- **Unwanted behavior**: If [condition], then the [system] shall [behavior].
- **Optional**: Where [feature/condition], the [system] shall [behavior].

---

## R1: TokenStore Interface Implementation

### R1.1 — Ubiquitous

KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.

### R1.2 — Ubiquitous

KeyringTokenStore shall delegate all credential storage operations (set, get, delete, list) to a `SecureStore` instance configured with service name `llxprt-code-oauth` and fallback policy `allow`.

### R1.3 — Ubiquitous

KeyringTokenStore shall accept an optional `SecureStore` instance in its constructor for testability and shared-instance wiring. When not provided, it shall construct a default instance.

---

## R2: Account Naming

### R2.1 — Ubiquitous

KeyringTokenStore shall map each provider+bucket combination to a SecureStore account key using the format `{provider}:{bucket}`.

### R2.2 — Event-Driven

When `bucket` is omitted from a TokenStore method call, KeyringTokenStore shall use `default` as the bucket name, producing account key `{provider}:default`.

### R2.3 — Ubiquitous

KeyringTokenStore shall validate both provider and bucket names against the pattern `[a-zA-Z0-9_-]+`. Names containing characters outside this set (including colons, slashes, spaces) shall be rejected.

### R2.4 — Event-Driven

When a provider or bucket name fails validation, KeyringTokenStore shall throw an error immediately, before any storage operation is attempted.

---

## R3: Token Serialization

### R3.1 — Event-Driven

When `saveToken` is called, KeyringTokenStore shall validate the token with `OAuthTokenSchema.passthrough().parse()` and store the result as `JSON.stringify(validatedToken)` via SecureStore.

### R3.2 — Event-Driven

When `getToken` retrieves a non-null value from SecureStore, KeyringTokenStore shall parse it with `JSON.parse()` and validate with `OAuthTokenSchema.passthrough().parse()`.

### R3.3 — Ubiquitous

KeyringTokenStore shall use `.passthrough()` (not `.parse()`) for schema validation to preserve provider-specific fields (e.g., `account_id`, `id_token`) that are not in the base `OAuthTokenSchema`. This is a deliberate divergence from issue #1351 text to prevent silent data loss during round-trip storage.

---

## R4: Corrupt Token Handling

### R4.1 — Unwanted Behavior

If `getToken` retrieves a value that fails `JSON.parse()`, then KeyringTokenStore shall log a warning with a hashed provider:bucket identifier and the error message, and return `null`.

### R4.2 — Unwanted Behavior

If `getToken` retrieves a value that passes `JSON.parse()` but fails `OAuthTokenSchema.passthrough().parse()`, then KeyringTokenStore shall log a warning with a hashed provider:bucket identifier and the validation error, and return `null`.

### R4.3 — Ubiquitous

KeyringTokenStore shall NOT delete corrupt entries from SecureStore after a failed read. Corrupt data shall be preserved for manual inspection.

### R4.4 — Ubiquitous

Warning logs for corrupt tokens shall include a SHA-256 hashed provider:bucket identifier (not the raw value) and shall never include secret values (tokens, keys).

---

## R5: Token Removal

### R5.1 — Event-Driven

When `removeToken` is called, KeyringTokenStore shall call `secureStore.delete()` for the corresponding account key.

### R5.2 — Unwanted Behavior

If `removeToken` encounters a `SecureStoreError` during deletion, then KeyringTokenStore shall log the error and return normally. Deletion is best-effort — errors do not propagate.

---

## R6: Provider and Bucket Listing

### R6.1 — Event-Driven

When `listProviders` is called, KeyringTokenStore shall call `secureStore.list()`, parse the returned account keys to extract unique provider names (the portion before `:`), and return them sorted.

### R6.2 — Event-Driven

When `listBuckets(provider)` is called, KeyringTokenStore shall call `secureStore.list()`, filter to keys starting with `{provider}:`, extract the bucket portion (after `:`), and return them sorted.

### R6.3 — Unwanted Behavior

If `listProviders` or `listBuckets` encounters a `SecureStoreError`, then KeyringTokenStore shall return an empty array. List operations degrade gracefully rather than propagating errors.

---

## R7: Bucket Stats

### R7.1 — Event-Driven

When `getBucketStats(provider, bucket)` is called and a token exists for that provider+bucket, KeyringTokenStore shall return a stats object with `{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`.

### R7.2 — Event-Driven

When `getBucketStats(provider, bucket)` is called and no token exists for that provider+bucket, KeyringTokenStore shall return `null`.

---

## R8: Refresh Lock — Acquisition

### R8.1 — Ubiquitous

KeyringTokenStore shall implement file-based advisory locks for refresh coordination. Lock files shall be stored in `~/.llxprt/oauth/locks/`.

### R8.2 — Event-Driven

When `acquireRefreshLock` is called, KeyringTokenStore shall attempt to create a lock file using exclusive write (`wx` flag) containing `{pid, timestamp}` as JSON.

### R8.3 — Event-Driven

When the lock file already exists and its age exceeds the stale threshold (default 30 seconds), KeyringTokenStore shall break the stale lock (delete the file) and retry acquisition.

### R8.4 — Event-Driven

When the lock file already exists and is fresh, KeyringTokenStore shall poll at 100ms intervals until the lock is released or the wait timeout (default 10 seconds) is reached.

### R8.5 — Event-Driven

When the wait timeout is reached without acquiring the lock, `acquireRefreshLock` shall return `false`.

### R8.6 — Unwanted Behavior

If the lock file is unreadable or corrupt, then KeyringTokenStore shall break the lock (delete the file) and retry acquisition.

---

## R9: Refresh Lock — Release

### R9.1 — Event-Driven

When `releaseRefreshLock` is called, KeyringTokenStore shall delete the corresponding lock file.

### R9.2 — Unwanted Behavior

If the lock file does not exist (ENOENT) during release, then KeyringTokenStore shall ignore the error. Release is idempotent.

---

## R10: Refresh Lock — File Naming

### R10.1 — Ubiquitous

Lock files shall use dash-separated naming: `{provider}-refresh.lock` for the default bucket, `{provider}-{bucket}-refresh.lock` for named buckets.

### R10.2 — Ubiquitous

The `~/.llxprt/oauth/locks/` directory shall be created on demand with mode `0o700`.

---

## R11: Error Propagation — saveToken

### R11.1 — Unwanted Behavior

If `saveToken` encounters a `SecureStoreError` with code `UNAVAILABLE`, `LOCKED`, `DENIED`, or `TIMEOUT`, then KeyringTokenStore shall propagate the error to the caller.

### R11.2 — Unwanted Behavior

If `saveToken` encounters an unexpected `SecureStoreError` (any code not listed above), then KeyringTokenStore shall propagate it.

---

## R12: Error Propagation — getToken

### R12.1 — Event-Driven

When `secureStore.get()` returns `null`, `getToken` shall return `null`. This is the normal unauthenticated path.

### R12.2 — Unwanted Behavior

If `secureStore.get()` throws a `SecureStoreError` with code `UNAVAILABLE`, `LOCKED`, `DENIED`, or `TIMEOUT`, then `getToken` shall propagate the error.

### R12.3 — Unwanted Behavior

If `secureStore.get()` throws a `SecureStoreError` with code `CORRUPT`, then `getToken` shall log a warning and return `null`.

---

## R13: Wiring — Replace MultiProviderTokenStore

### R13.1 — Ubiquitous

All production sites that instantiate `MultiProviderTokenStore` shall be changed to use `KeyringTokenStore`.

### R13.2 — Ubiquitous

`MultiProviderTokenStore` shall be deleted from the codebase. The `TokenStore` interface shall be preserved.

### R13.3 — Ubiquitous

All exports and re-exports of `MultiProviderTokenStore` shall be replaced with `KeyringTokenStore`.

---

## R14: Probe-Once Constraint

### R14.1 — Ubiquitous

The keyring availability probe shall happen at most once per process, not once per provider/bucket. The implementation must ensure that the probe result is shared across all TokenStore usage sites.

---

## R15: Dual-Mode Operation

### R15.1 — Ubiquitous

KeyringTokenStore shall function correctly in both keyring-available and keyring-unavailable (fallback-only) environments. SecureStore handles the fallback transparently.

### R15.2 — Ubiquitous

Both the keyring path and the fallback path shall have equivalent behavioral test coverage, exercised in separate CI jobs.

---

## R16: Scope Boundaries

### R16.1 — Ubiquitous

KeyringTokenStore is a host-side component. Sandbox credential access is handled by a separate proxy (#1358) and is out of scope.

### R16.2 — Ubiquitous

No code shall read, migrate, or acknowledge the old `~/.llxprt/oauth/*.json` plaintext token files. Old files are inert.

### R16.3 — Ubiquitous

The `--key` flag for API key authentication shall remain unaffected.

---

## R17: Acceptance Criteria (from Issue Text)

### R17.1 — Ubiquitous

All `TokenStore` interface behaviors shall have equivalent coverage in new tests.

### R17.2 — Ubiquitous

Multiprocess race conditions (concurrent refresh, refresh+logout) shall be tested with spawned child processes.

### R17.3 — Ubiquitous

The full token lifecycle shall work end-to-end: login → store → read → refresh → logout.

### R17.4 — Ubiquitous

Multiple providers shall work simultaneously (e.g., anthropic + gemini each in keyring).

### R17.5 — Ubiquitous

`/auth login` shall store tokens in keyring (not plaintext files).

### R17.6 — Ubiquitous

`/auth status` shall read tokens from keyring.

### R17.7 — Ubiquitous

Token refresh shall work as a complete cycle: expire → lock → refresh → save → unlock.

### R17.8 — Ubiquitous

CI shall exercise both keyring-available and keyring-unavailable (fallback-only) paths in separate test jobs.

---

## R18: End-to-End Verification Flows (from Issue #1352)

### R18.1 — Event-Driven

When `/auth login` completes, the token shall be stored in keyring (or encrypted fallback), not in plaintext files.

### R18.2 — Event-Driven

When a session starts and a valid token exists, `getToken` shall retrieve it from keyring (or encrypted fallback) for API calls.

### R18.3 — Event-Driven

When a token expires, the refresh cycle shall acquire lock → refresh → save → release lock, all through KeyringTokenStore.

### R18.4 — Event-Driven

When a proactive renewal timer fires, the same refresh flow (R18.3) shall execute through KeyringTokenStore.

### R18.5 — Event-Driven

When the active bucket's token is expired and non-refreshable, bucket failover shall iterate other buckets via `getToken` through KeyringTokenStore.

### R18.6 — Ubiquitous

Multi-bucket configurations shall store each bucket as a separate keyring entry (e.g., `anthropic:default`, `anthropic:work`).

### R18.7 — Ubiquitous

Multiple llxprt-code processes running simultaneously shall share the same keyring storage. File-based refresh locks shall prevent double-refresh.

### R18.8 — Event-Driven

When `/auth logout` is called, `removeToken` shall delete the token from keyring (or encrypted fallback).

### R18.9 — Event-Driven

When `/auth status` is called, `getToken` and `listBuckets` shall read from keyring (or encrypted fallback) to display status.

---

## R19: Name Validation Errors

### R19.1 — Event-Driven

When a provider or bucket name is rejected by validation, KeyringTokenStore shall throw an error with a clear message identifying the invalid name and the allowed character set.
