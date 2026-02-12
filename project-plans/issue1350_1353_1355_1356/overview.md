# Functional Specification: SecureStore + Named API Key Management

Issues: #1350, #1353, #1355, #1356
Parent Epic: #1349 (Unified Credential Management — Keyring-First)

## Summary

Users can securely save, load, list, and delete named API keys via `/key` commands and reference them in profiles via `auth-key-name` or on the CLI via `--key-name`. All credential storage uses the OS keyring with AES-256-GCM encrypted-file fallback — never plaintext.

---

## Problem

There are three problems being solved:

### 1. Duplicated keyring + encryption code (#1350)

Four near-identical implementations of keyring + encrypted-file storage exist across the codebase:

| Implementation | Location | Service Name | Keyring Loader | AES Fallback | Availability Probe |
|----------------|----------|-------------|----------------|--------------|-------------------|
| ToolKeyStorage | core, tools | `llxprt-code-tool-keys` | Own copy | Own copy | Own copy |
| KeychainTokenStorage | core, MCP token storage | `llxprt-cli-mcp-oauth` | Own copy | Via FileTokenStorage | Own copy |
| FileTokenStorage | core, MCP token storage | N/A | N/A | Own copy | N/A |
| ExtensionSettingsStorage | cli, extensions | `LLxprt Code Extension {name}` | Own copy | None | None |

Each duplicates: `@napi-rs/keyring` dynamic import + `AsyncEntry` wrapping, keychain availability probing (set-get-delete test cycle), AES-256-GCM encrypt/decrypt with `scryptSync` key derivation, and error handling for missing keyring modules.

### 2. No named API key management (#1353)

API keys for providers (Anthropic, Gemini, OpenAI, etc.) are stored as plaintext files on disk (`--keyfile` references, `~/.llxprt/keys/`, or profile `auth-key` inline). There is no way to save a key by name and recall it later. Users must remember file paths or embed raw keys in profile JSON.

### 3. No way to reference stored keys from profiles or CLI (#1355, #1356)

The existing `/key` command only sets an ephemeral session API key — nothing is persisted. Users who save keys via `/key save` (once it exists) need a way to reference them from profiles (`auth-key-name` field) and the CLI (`--key-name` flag). Currently, profiles support only `auth-key` (inline plaintext) and `auth-keyfile` (path to plaintext file).

---

## Solution

### Component 1: SecureStore — Shared Storage Engine (#1350)

A single `SecureStore` class that consolidates all keyring + encrypted-file logic. It owns:

- **Keyring access**: dynamic import of `@napi-rs/keyring`, `AsyncEntry` wrapping, module-missing detection
- **Availability probing**: set-get-delete test cycle with cached result (60-second TTL, immediate invalidation on transient errors)
- **AES-256-GCM fallback**: encrypted files with versioned envelope, async `scrypt` key derivation, atomic temp-file-and-rename writes with `fsync`
- **Backend precedence**: keyring wins over fallback file when both contain a value for the same key

#### Public API

- `set(key, value)` — stores string value. Keyring primary, encrypted file fallback.
- `get(key)` — retrieves string value. Returns `null` for not found. Keyring → fallback file.
- `delete(key)` — removes from both keyring and fallback file.
- `list()` — best-effort enumeration from keyring + fallback file directory scan, deduplicated.
- `has(key)` — returns `false` for not found, throws for other errors (unavailable, locked, denied, corrupt).
- `isKeychainAvailable()` — cached probe result.

#### Configuration

- `serviceName` — keyring service name (e.g. `llxprt-code-tool-keys`, `llxprt-code-provider-keys`)
- `fallbackDir` — directory for AES-256-GCM fallback files
- `fallbackPolicy` — `'allow'` (default) or `'deny'` (hard-fail when keyring unavailable)
- `keytarLoader` — injectable for testing

#### Storage Envelope

All fallback files use a versioned envelope:

    {"v":1, "crypto":{"alg":"aes-256-gcm","kdf":"scrypt","N":16384,"r":8,"p":1,"saltLen":16}, "data":"<base64 ciphertext>"}

Readers that encounter an unrecognized version emit a clear error with upgrade instructions.

#### Atomic Write Contract

Fallback file writes are atomic: write to temp file → `fsync` → `rename` → set `0o600` permissions. This prevents corruption from concurrent writers or interrupted writes.

#### Error Taxonomy

All errors map to the epic-wide taxonomy:

| Code | Meaning | Remediation |
|------|---------|-------------|
| `UNAVAILABLE` | Keyring backend not present | Use `--key`, install keyring, or use seatbelt mode |
| `LOCKED` | Keyring present but locked | Unlock your keyring |
| `DENIED` | Permission denied | Check permissions, run as correct user |
| `CORRUPT` | Stored data failed validation | Re-save the key or re-authenticate |
| `TIMEOUT` | Operation timed out | Retry, check system load |
| `NOT_FOUND` | Key does not exist | Save the key first |

#### Existing Store Refactoring

After SecureStore exists, the four existing implementations become thin wrappers:

- **ToolKeyStorage** wraps `SecureStore('llxprt-code-tool-keys')`, adds registry validation and keyfile path resolution
- **KeychainTokenStorage + FileTokenStorage** → `KeychainTokenStorage` wraps `SecureStore('llxprt-cli-mcp-oauth')`, adds JSON serialization and credential validation. `FileTokenStorage` is eliminated (its role is now the fallback path inside SecureStore). `HybridTokenStorage` becomes unnecessary since SecureStore handles fallback internally.
- **ExtensionSettingsStorage** wraps `SecureStore` for sensitive settings, keeps `.env` file logic for non-sensitive settings

Each thin wrapper must pass contract tests proving identical behavior to the original implementation before the old code is removed.

#### Behavioral Delta Audit

Before merging, the following semantic differences between the four implementations must be documented and resolved:

1. **Naming conventions**: ToolKeyStorage uses `{serviceName}/{toolName}`, KeychainTokenStorage uses `sanitizeServerName()`, ExtensionSettingsStorage uses extension display name
2. **Serialization**: ToolKeyStorage stores raw strings, KeychainTokenStorage stores `JSON.stringify(credentials)`, ExtensionSettingsStorage stores raw strings. SecureStore stores raw strings — callers handle serialization.
3. **Retry/fallback triggers**: ToolKeyStorage falls back on any error, KeychainTokenStorage delegates to HybridTokenStorage, ExtensionSettingsStorage has no fallback. Intentional differences are preserved in thin wrappers.
4. **Error handling**: Some swallow errors, others throw. SecureStore has a well-defined error contract — callers decide policy.

---

### Component 2: ProviderKeyStorage — Named API Key Storage (#1353)

A new class backed by SecureStore for named API key CRUD.

#### Public API

- `saveKey(name, apiKey)` — stores key in keyring under the given name. Trims leading/trailing whitespace and trailing newline/carriage return from the API key value before storing.
- `getKey(name)` — retrieves key by name. Returns `null` if not found.
- `deleteKey(name)` — removes key. Returns `true` if deleted, `false` if not found.
- `listKeys()` — returns all stored key names, sorted, deduplicated across keyring + fallback.
- `hasKey(name)` — returns `true`/`false`.

#### Key Name Validation

- Allowed characters: alphanumeric, dash, underscore, dot
- Length: 1–64 characters
- Case-sensitive
- Regex: `^[a-zA-Z0-9._-]{1,64}$`
- Names are stored as-is with no normalization

#### Configuration

- Service name: `llxprt-code-provider-keys`
- Account naming: the user-chosen name directly (e.g. `myanthropic`, `work-gemini`, `team.prod`)

#### Relationship to ToolKeyStorage

ToolKeyStorage stores keys for tools (Exa search, etc.) with a fixed registry of valid tool names. ProviderKeyStorage stores user-named keys for AI providers with no fixed registry. Both backed by SecureStore but with different service names and validation rules.

#### Known Limitations

On platforms where keyring backends are case-insensitive (Windows Credential Manager), two names differing only by case may collide. This is documented.

---

### Component 3: /key Commands — Interactive Key Management (#1355)

Extension of the existing `/key` command with subcommands for named key management.

#### Commands

| Command | Description | Example |
|---------|-------------|---------|
| `/key save <name> <api-key>` | Store key in keyring. Prompts before overwrite. | `/key save myanthropic sk-ant-abc123` |
| `/key load <name>` | Load key from keyring, set as active session key. | `/key load myanthropic` |
| `/key show <name>` | Display masked preview of stored key. | `/key show myanthropic` → `myanthropic: sk*****ey (64 chars)` |
| `/key list` | Show all saved key names with masked values. | See below |
| `/key delete <name>` | Prompt for confirmation, then remove key. | `/key delete myanthropic` |
| `/key <raw-key>` | Legacy behavior: set ephemeral session key (unchanged). | `/key sk-ant-abc123` |
| `/key` (no args) | Show current key status for active provider. | |

#### Key Masking

Uses the existing `maskKeyForDisplay` function from `tool-key-storage.ts`:
- Keys ≤ 8 characters: all asterisks
- Keys > 8 characters: first 2 + asterisks + last 2
- Example: `sk-ant-api03-abcxyz123` → `sk*****************23`

This keeps masking consistent across `/key` and `/toolkey` commands — one function, one behavior.

#### `/key list` Output Format

```
Saved keys:
  myanthropic  sk*****ey
  work-gemini  AI*****3k
```

#### Non-Interactive Behavior

In non-interactive mode (piped input, `--prompt` flag):
- `/key save` with existing name: fails with error (no overwrite prompt possible)
- `/key delete`: fails with error (no confirmation prompt possible)

#### Parsing Rules

First token after `/key` is checked against `save`, `load`, `show`, `list`, `delete`. If no match, entire args treated as a raw key (legacy path).

Edge cases to handle:
- `/key save mykey` (missing key value) → error: "API key value cannot be empty."
- `/key load` (missing name) → error with usage hint
- `/key save` (missing both name and key) → error with usage hint
- `/key delete` (missing name) → error with usage hint
- Subcommand names are case-sensitive (`save` works, `SAVE` treated as legacy raw key)
- Leading/trailing whitespace in args is trimmed before parsing

#### Autocomplete

- `/key load`, `/key delete`, `/key show` — autocomplete key names from stored keys
- `/key save` — autocomplete first arg against existing key names (for overwrite awareness)
- Autocomplete returns empty list (not error) when keyring is unavailable

#### Error Messages

| Condition | Message |
|-----------|---------|
| Key not found | `Key 'myanthropic' not found. Use '/key list' to see saved keys.` |
| Keyring unavailable | `Cannot access keyring. Keys cannot be saved. Use '/key <raw-key>' for ephemeral session key.` |
| Invalid key name | `Key name 'my key!' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).` |
| Empty key value | `API key value cannot be empty.` |

---

### Component 4: auth-key-name in Profiles + --key-name CLI Flag (#1356)

#### New Profile Field: `auth-key-name`

```json
{
  "name": "my-anthropic",
  "provider": "anthropic",
  "auth-key-name": "myanthropic"
}
```

When a profile is loaded, `auth-key-name` resolves via `ProviderKeyStorage.getKey(name)`. If the named key exists, it becomes the provider API key for the session.

#### New CLI Flag: `--key-name <name>`

```bash
llxprt --key-name myanthropic
```

Equivalent to a profile with `auth-key-name`. Takes precedence over profile settings.

#### Resolution Order

When determining the API key for a session, check in this order (highest precedence first):

1. `--key` / `--key-name` (CLI flags — always win)
2. `auth-key-name` (profile field — keyring via ProviderKeyStorage)
3. `auth-keyfile` (profile field — read from file path)
4. `auth-key` (profile field — inline in profile JSON)
5. Environment variables (`GEMINI_API_KEY`, etc.)

If both `--key` and `--key-name` are specified, `--key` wins (explicit raw key beats named key lookup).

#### Error Handling

If `auth-key-name` is set but the named key is not found:
- Interactive mode: emit error `Named key 'myanthropic' not found. Use '/key save myanthropic <key>' to store it.`
- Non-interactive mode: fail fast with exit code and the same message — does NOT silently fall through to lower-precedence auth sources (this indicates a configuration error)

#### Resolution Stage

`--key-name` and `auth-key-name` are resolved in `runtimeSettings.ts` `applyCliArgumentOverrides()`, the same stage that currently handles `--key` and `--keyfile`. Profile bootstrap (`profileBootstrap.ts`) passes `keyNameOverride` through as metadata only — it does not resolve the named key. This keeps key resolution in one place and avoids double-resolution.

#### Startup Diagnostic (Debug Mode)

When debug mode is enabled, emit a log line showing the selected auth source:

    [auth] Using API key from: --key-name 'myanthropic' (keyring)
    [auth] Using API key from: profile 'my-anthropic' auth-keyfile '~/.llxprt/keys/anthro.key'

When a lower-precedence source is overridden:

    [auth] Ignoring profile auth-key (overridden by --key-name)

Key values are never logged at any level.

#### No Deprecations

`--key`, `--keyfile`, `auth-key`, and `auth-keyfile` remain fully supported. `--key` is still useful for piping keys to headless instances. The new options are additive.

---

## Design Principles

- **Keyring primary, encrypted file fallback, never plaintext** — SecureStore tries OS keyring first, falls back to AES-256-GCM encrypted files. No plaintext credential files.
- **No migration shims, no backward compatibility** — existing encrypted fallback files in legacy formats (ToolKeyStorage `.key` files, FileTokenStorage `mcp-oauth-tokens-v2.json`) become inert when SecureStore's new envelope format replaces them. Users re-save keys (`/toolkey set`, `/key save`) and re-authenticate MCP servers. Clean cut. Startup messaging must be clear and actionable when old data is detected but not loadable.
- **`--key` stays** — there are valid reasons to pipe a key to a headless instance. No deprecation.
- **Fast-fail over silent degradation** — when something breaks, error immediately with actionable message. No silent fallbacks that mask problems.
- **Callers own serialization** — SecureStore stores raw strings. Each consumer decides how to serialize/deserialize.
- **Callers own fallback policy** — SecureStore provides the mechanism. Each wrapper decides whether fallback is acceptable.

---

## Credential Policy Matrix

| Environment | Keyring Available | Keyring Unavailable |
|---|---|---|
| Host, interactive | Keyring primary | AES-256-GCM encrypted file fallback |
| Host, headless/CI | Keyring primary | AES-256-GCM encrypted file fallback |
| Sandbox (future) | Credential proxy to host keyring | Hard fail with actionable error |
| Seatbelt (macOS) | Direct keyring access | AES-256-GCM encrypted file fallback |

---

## Observability

All credential operations emit structured debug logs with:
- Operation type (keyring read/write/delete, fallback used, probe result)
- Provider/key identifiers (hashed in debug logs for privacy)
- Timing information
- Failure reasons and fallback triggers
- Error taxonomy code

Secret values are NEVER logged at any level. Masked key previews (via `maskKeyForDisplay`: first 2 + last 2 chars) are acceptable in user-facing output only.
