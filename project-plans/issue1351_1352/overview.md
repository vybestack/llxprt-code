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
