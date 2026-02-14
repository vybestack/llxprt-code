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
