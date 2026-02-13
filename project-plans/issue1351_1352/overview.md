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
