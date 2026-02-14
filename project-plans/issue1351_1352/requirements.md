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
