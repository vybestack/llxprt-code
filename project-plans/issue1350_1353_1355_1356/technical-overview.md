# Technical Overview: SecureStore + Named API Key Management

Issues: #1350, #1353, #1355, #1356
Parent Epic: #1349 (Unified Credential Management — Keyring-First)

---

## Existing Code: The Four Implementations to Consolidate

### 1. ToolKeyStorage — `packages/core/src/tools/tool-key-storage.ts`

547 lines. The most complete implementation.

**Keyring adapter** (lines 130–138): defines `KeytarAdapter` interface with `getPassword`, `setPassword`, `deletePassword`. The default loader (lines 517–546) dynamically imports `@napi-rs/keyring` and wraps `AsyncEntry` instances.

**Keytar loading** (lines 189–215): `getKeytar()` method. Uses `keytarLoadAttempted` flag to try once. Detects module-missing errors via `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, `ERR_DLOPEN_FAILED`, or message containing `'@napi-rs/keyring'`. Falls back to `null`.

**Availability probe** (lines 218–241): `checkKeychainAvailability()`. Generates random test account name, does set→get→delete cycle. Caches result permanently (no TTL — `if (this.keychainAvailable !== null) return`).

**Encryption** (lines 254–290): deterministic key derivation via `scryptSync('llxprt-cli-tool-keys', salt, 32)` where `salt = hostname-username-llxprt-cli`. AES-256-GCM with random 16-byte IV. Ciphertext format: `iv_hex:authTag_hex:encrypted_hex`. Uses **sync** `scryptSync`.

**File operations** (lines 340–380): writes to `{toolsDir}/{toolName}.key` with `0o600`. No atomic writes — direct `writeFile`. Reads decrypt and return `null` on ENOENT or corrupt data (with console warning).

**Public API** (lines 459–511): `saveKey` tries keychain first, cleans up file on success, falls back to file. `getKey` tries keychain then file. `deleteKey` removes from both. `hasKey` delegates to `getKey`. `resolveKey` chains: stored key → keyfile → null.

**Test pattern** (`tool-key-storage.test.ts`, 702 lines): uses `createMockKeytar()` — in-memory `Map<string, string>` injected via `keytarLoader` option. Uses `fs.mkdtemp` for temp `toolsDir`. No mocking of `fs` or `crypto`. Tests behavior not internals.

### 2. KeychainTokenStorage — `packages/core/src/mcp/token-storage/keychain-token-storage.ts`

316 lines. MCP OAuth credential storage via keychain.

**Keytar interface** (lines 12–23): adds `findCredentials(service)` method that ToolKeyStorage lacks. Module-level `keytarLoader` variable with `setKeytarLoader`/`resetKeytarLoader` for test injection (lines 60–68).

**Keytar loading** (lines 75–108): `getKeytar()`. Same load-once pattern. Handles `'default' in module` pattern that ToolKeyStorage doesn't.

**Availability probe** (lines 282–311): `checkKeychainAvailability()`. Identical logic to ToolKeyStorage — set-get-delete cycle, permanent cache. Uses `KEYCHAIN_TEST_PREFIX = '__keychain_test__'` constant for test account filtering.

**Server name sanitization** (inherited from BaseTokenStorage, line 48): `sanitizeServerName` replaces non-alphanumeric chars with `_`.

**Credentials storage**: stores JSON-serialized `OAuthCredentials` objects (line 158). Adds `updatedAt` timestamp. Validates credentials on both read and write.

**Error behavior**: throws on keychain unavailable (`throw new Error('Keychain is not available')`), does NOT fall back — `HybridTokenStorage` handles fallback externally.

**List operations** (lines 183–246): `listServers()` and `getAllCredentials()` use `findCredentials(serviceName)`, filter out test prefix entries.

### 3. FileTokenStorage — `packages/core/src/mcp/token-storage/file-token-storage.ts`

184 lines. AES-256-GCM encrypted file for MCP OAuth credentials.

**Encryption** (lines 25–63): same pattern as ToolKeyStorage. Key derivation: `scryptSync('llxprt-cli-oauth', salt, 32)` — different password string, same salt formula. Same AES-256-GCM, same ciphertext format.

**Storage model**: single encrypted file at `~/.llxprt/mcp-oauth-tokens-v2.json` containing ALL credentials as a JSON map. Entire file decrypted on every read, re-encrypted on every write. This is different from ToolKeyStorage's one-file-per-key model.

**No atomic writes**: direct `writeFile` with `0o600`.

### 4. HybridTokenStorage — `packages/core/src/mcp/token-storage/hybrid-token-storage.ts`

97 lines. Orchestrator that tries keychain first, falls back to file.

**Initialization** (lines 23–47): lazy, uses promise to avoid race conditions. Checks `LLXPRT_FORCE_FILE_STORAGE` env var. Dynamic import of KeychainTokenStorage. Falls back to FileTokenStorage if keychain unavailable.

**Delegation**: all methods delegate to whichever storage was selected at init time. This is the pattern SecureStore replaces — the fallback is now internal.

**Consumers**: used by `OAuthTokenStorage` (`core/src/mcp/oauth-token-storage.ts`, line 27) and `OAuthCredentialStorage` (`core/src/code_assist/oauth-credential-storage.ts`, line 30).

### 5. ExtensionSettingsStorage — `packages/cli/src/config/extensions/settingsStorage.ts`

345 lines. Stores extension secrets in keychain, non-sensitive values in `.env` files.

**Keytar loading** (lines 27–83): module-level singleton. Same dynamic import pattern, same error detection.

**No availability probe**: does not test keychain before use. If keytar load fails, sensitive settings are silently `undefined`.

**No fallback**: when keychain unavailable, sensitive settings simply can't be stored or retrieved. Non-sensitive settings use `.env` files independently.

**Service name** (lines 96–105): `LLxprt Code Extension {sanitized_name}`, max 255 chars.

---

## New Files to Create

### `packages/core/src/storage/secure-store.ts` — SecureStore Class

New file in the existing `packages/core/src/storage/` directory (currently contains `ConversationFileWriter.ts`, `SessionPersistenceService.ts`, `sessionTypes.ts`).

**Interface**:
```typescript
interface SecureStoreOptions {
  fallbackDir?: string;
  fallbackPolicy?: 'allow' | 'deny';
  keytarLoader?: () => Promise<KeytarAdapter | null>;
}

class SecureStore {
  constructor(serviceName: string, options?: SecureStoreOptions)
  async set(key: string, value: string): Promise<void>
  async get(key: string): Promise<string | null>
  async delete(key: string): Promise<boolean>
  async list(): Promise<string[]>
  async has(key: string): Promise<boolean>
  async isKeychainAvailable(): Promise<boolean>
}
```

**KeytarAdapter interface**: reuse the existing interface from `tool-key-storage.ts` (lines 130–138), extended with `findCredentials` from `keychain-token-storage.ts` (line 20–22). The `findCredentials` method is needed for `list()`.

```typescript
interface KeytarAdapter {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
  findCredentials?(service: string): Promise<Array<{ account: string; password: string }>>;
}
```

`findCredentials` is optional — `list()` uses it when available, otherwise returns fallback-file-only results.

**Default keytar loader**: consolidation of the loader in `tool-key-storage.ts` lines 517–546 and `keychain-token-storage.ts` lines 30–59. Must include `findCredentials` → `findCredentialsAsync` mapping (present in KeychainTokenStorage and ExtensionSettingsStorage, absent from ToolKeyStorage).

**Probe caching**: unlike current implementations that cache permanently, SecureStore uses 60-second TTL with immediate invalidation on transient errors (timeout). Implement with `probeResult: { available: boolean; timestamp: number; error?: string } | null`.

**Encryption changes from existing code**:
- Switch from `scryptSync` to async `scrypt` (all current implementations use sync)
- Store crypto params in the envelope metadata for forward compatibility
- Atomic writes: temp-file → fsync → rename (no current implementation does this)
- Key derivation input includes machine-specific identifier (hostname + username hash)

**Fallback file naming**: `{fallbackDir}/{key}.enc` (each key gets its own file, unlike FileTokenStorage's single-file-for-all model).

### `packages/core/src/storage/secure-store.test.ts` — SecureStore Tests

Follow the pattern from `tool-key-storage.test.ts`:
- `createMockKeytar()` — in-memory `Map<string, string>` with `findCredentials` support
- `fs.mkdtemp` for temp `fallbackDir`
- Inject via `keytarLoader` option
- No mocking of `fs` or `crypto`

### `packages/core/src/storage/provider-key-storage.ts` — ProviderKeyStorage Class

```typescript
class ProviderKeyStorage {
  constructor(options?: { secureStore?: SecureStore })
  async saveKey(name: string, apiKey: string): Promise<void>
  async getKey(name: string): Promise<string | null>
  async deleteKey(name: string): Promise<boolean>
  async listKeys(): Promise<string[]>
  async hasKey(name: string): Promise<boolean>
}
```

**SecureStore instance**: created with `serviceName = 'llxprt-code-provider-keys'`, `fallbackDir = path.join(os.homedir(), '.llxprt', 'provider-keys')`, `fallbackPolicy = 'allow'`.

**Name validation**: regex `^[a-zA-Z0-9._-]{1,64}$` — reject with descriptive error on invalid names. Same validation pattern as `ToolKeyStorage.assertValidToolName()` (line 178–184) but with different rules.

**Input normalization**: `saveKey` trims `apiKey.trim().replace(/[\r\n]+$/, '')` before passing to `SecureStore.set()`.

### `packages/core/src/storage/provider-key-storage.test.ts` — ProviderKeyStorage Tests

Same test infrastructure as SecureStore tests. Focus on:
- Name validation (valid/invalid names, boundary: 64 chars, 65 chars, empty, special chars)
- Input normalization (whitespace trimming, newline stripping)
- CRUD happy path
- Fallback path (null keytarLoader)

---

## Files to Modify

### `/key` Command — `packages/cli/src/ui/commands/keyCommand.ts`

Currently 51 lines, single-action command. Transform into multi-subcommand handler.

**Pattern to follow**: `toolkeyCommand.ts` (130 lines) which already handles subcommands (`/toolkey <tool> [<key>|none]`). The `/key` command needs richer parsing since it has named subcommands (`save`, `load`, `show`, `list`, `delete`) plus a legacy fallback path.

**Current action** (lines 19–50): takes `args: string`, trims, calls `runtime.updateActiveProviderApiKey()`. This becomes the legacy path when first token doesn't match a subcommand.

**New structure**:
```
/key save <name> <api-key>  → 3 tokens
/key load <name>            → 2 tokens
/key show <name>            → 2 tokens
/key list                   → 1 token
/key delete <name>          → 2 tokens
/key <raw-key>              → 1 token, no subcommand match → legacy
/key                        → 0 tokens → show status
```

**Parsing**: split args by whitespace. Check first token against subcommand names. If match, dispatch. If no match, delegate to existing legacy behavior (lines 23–50 of current file).

**Schema for autocomplete**: add `CommandArgumentSchema` (same type as `toolkeyCommand.ts` line 38). First-level options: `save`, `load`, `show`, `list`, `delete`. Second-level for `load`/`show`/`delete`: dynamic key names from `ProviderKeyStorage.listKeys()`.

**Key masking**: reuse existing `maskKeyForDisplay` from `tool-key-storage.ts` (lines 104–110). Same function, same behavior (≤8 chars: all stars; >8 chars: first 2 + stars + last 2). One masking function across `/key` and `/toolkey`.

**Interactive prompts for overwrite/delete confirmation**: need access to the interactive I/O context. Check `CommandContext` for available methods. The `toolkeyCommand` doesn't have confirmation prompts, so this is new territory — investigate how other commands handle user prompts.

**Secure input handling**: `packages/cli/src/ui/utils/secureInputHandler.ts` (lines 189–192) already masks `/key <value>` in display. The regex `^(\/key\s+)(.+)$` needs to be updated to also mask `/key save <name> <value>` — the third token should be masked but the subcommand and name should not.

### Profile Bootstrap — `packages/cli/src/config/profileBootstrap.ts`

**BootstrapProfileArgs** (line 19–28): add `keyNameOverride: string | null`.

**Argument parsing** (around line 222–232): add `case '--key-name'` alongside `--key` and `--keyfile`.

**Profile resolution** (around lines 604–770): when `keyNameOverride` is set, pass it through as metadata in the profile result — do NOT resolve it here. Resolution happens in `runtimeSettings.ts` `applyCliArgumentOverrides()` (the single authoritative stage). This mirrors how `keyfileOverride` is parsed here but the actual file read happens in runtimeSettings.

### Config Ephemeral Settings — `packages/cli/src/config/config.ts`

**VALID_EPHEMERAL_SETTINGS** (lines 1710–1721): add `'auth-key-name'` to the `ephemeralKeys` array.

**Synthetic profile creation** (lines 1461–1476): add handling for `keyNameOverride`:
```typescript
if (bootstrapArgs.keyNameOverride) {
  syntheticProfile.ephemeralSettings['auth-key-name'] = bootstrapArgs.keyNameOverride;
}
```

### Runtime Settings — `packages/cli/src/runtime/runtimeSettings.ts`

**`applyCliArgumentOverrides`** (lines 2289–2345): this is the **single authoritative stage** for resolving `--key-name` and `auth-key-name`. Profile bootstrap passes `keyNameOverride` through as metadata only — it does not resolve the named key. This avoids double-resolution.

Add step between `--key` and `--keyfile` for `--key-name`:

Current order: `--key` → `--keyfile` → `--set` → `--baseurl`

New order: `--key` → `--key-name` → `--keyfile` → `--set` → `--baseurl`

When `--key-name` is present (from CLI flag or profile `auth-key-name`), resolve via `ProviderKeyStorage.getKey(name)`, then call `updateActiveProviderApiKey(resolvedKey)`. If key not found, throw with actionable error message.

**New `BootstrapProfileArgs` field** in function signature (line 2296–2301): add `keyNameOverride`.

### BuiltinCommandLoader — `packages/cli/src/services/BuiltinCommandLoader.ts`

No changes needed — `keyCommand` is already registered (line 151). The command object reference stays the same; only its internal behavior changes.

### Secure Input Handler — `packages/cli/src/ui/utils/secureInputHandler.ts`

**Line 189**: update regex from `^(\/key\s+)(.+)$` to handle the new subcommand structure. When subcommand is `save`, mask only the third token (the API key value), not the name. Pattern: `/^(\/key\s+save\s+\S+\s+)(.+)$/` for the save case.

---

## Existing Thin Wrapper Refactoring

### ToolKeyStorage → SecureStore wrapper

**File**: `packages/core/src/tools/tool-key-storage.ts`

Remove: `getKeytar()`, `checkKeychainAvailability()`, `deriveEncryptionKey()`, `encrypt()`, `decrypt()`, `ensureToolsDir()`, `saveToKeychain()`, `getFromKeychain()`, `deleteFromKeychain()`, `getEncryptedFilePath()`, `saveToFile()`, `getFromFile()`, `deleteFile()`, `defaultKeytarLoader()`. (~300 lines removed)

Keep: `ToolKeyStorage` class shell, `TOOL_KEY_REGISTRY`, `isValidToolKeyName()`, `getToolKeyEntry()`, `getSupportedToolNames()`, `maskKeyForDisplay()`, keyfile path operations (`loadKeyfilesMap`, `saveKeyfilesMap`, `setKeyfilePath`, `getKeyfilePath`, `clearKeyfilePath`, `readKeyfile`), `resolveKey()`.

Replace: constructor creates `SecureStore('llxprt-code-tool-keys', { fallbackDir: toolsDir, keytarLoader })`. Public `saveKey`/`getKey`/`deleteKey`/`hasKey` delegate to SecureStore.

**Test impact**: existing `tool-key-storage.test.ts` (702 lines) must continue to pass unmodified (or with minimal adapter changes for the mock injection point changing from `keytarLoader` on ToolKeyStorage to `keytarLoader` on SecureStore).

### KeychainTokenStorage + FileTokenStorage + HybridTokenStorage → SecureStore wrapper

**Files**:
- `packages/core/src/mcp/token-storage/keychain-token-storage.ts` — refactor to wrap SecureStore
- `packages/core/src/mcp/token-storage/file-token-storage.ts` — eliminate (functionality absorbed by SecureStore fallback)
- `packages/core/src/mcp/token-storage/hybrid-token-storage.ts` — eliminate (SecureStore handles fallback internally)

**KeychainTokenStorage** keeps: `BaseTokenStorage` inheritance, `sanitizeServerName()`, `validateCredentials()`, credential JSON serialization/deserialization, `listServers()`, `getAllCredentials()`, `clearAll()`.

**KeychainTokenStorage** replaces: all keytar loading, probe, encrypt/decrypt with SecureStore delegation.

**Consumers to update**:
- `packages/core/src/mcp/oauth-token-storage.ts` line 27: `new HybridTokenStorage(...)` → `new KeychainTokenStorage(...)` (which now internally uses SecureStore with fallback)
- `packages/core/src/code_assist/oauth-credential-storage.ts` line 30: same change

**Test impact**: `hybrid-token-storage.test.ts` and `file-token-storage` tests are deleted along with the eliminated code. `keychain-token-storage` tests are adapted for the thin-wrapper-over-SecureStore pattern. New SecureStore tests cover the fallback behavior previously tested via FileTokenStorage/HybridTokenStorage.

### ExtensionSettingsStorage → SecureStore wrapper

**File**: `packages/cli/src/config/extensions/settingsStorage.ts`

Remove: module-level `keytarModule`, `keytarLoadAttempted`, `getKeytar()` function (~60 lines).

Replace: sensitive settings operations use `SecureStore(serviceName)`. Non-sensitive `.env` logic unchanged.


---

## Compatibility Break Policy

SecureStore introduces a new encrypted envelope format. Existing encrypted fallback files created by the old implementations (ToolKeyStorage `.key` files, FileTokenStorage `mcp-oauth-tokens-v2.json`) will NOT be readable by SecureStore. There are no migration shims, no legacy format readers, no backward compatibility adapters. This is intentional per the epic's design principle: "No migration shims — old plaintext files become inert. Users re-authenticate. Clean cut."

Users who relied on encrypted fallback files will need to re-save their keys (`/key save`, `/toolkey set`) and re-authenticate MCP OAuth (`/auth login` for MCP servers). Startup messaging must be clear and actionable when old data is detected but not loadable.

---

## Core Exports

SecureStore and ProviderKeyStorage need to be exported from `@vybestack/llxprt-code-core` for use by the CLI package.

**File**: check `packages/core/src/index.ts` (or equivalent barrel export) for the pattern used by existing exports like `ToolKeyStorage`, `isValidToolKeyName`, etc.

ProviderKeyStorage needs a module-level lazy singleton (same pattern as `getToolKeyStorage()` in `tool-key-storage.ts` lines 114–125) so the CLI command and profile bootstrap can share an instance.

---

## Platform Considerations

### Keyring Backends

| Platform | Backend | `findCredentials` support |
|----------|---------|--------------------------|
| macOS | Keychain | Yes |
| Linux desktop | GNOME Keyring / KWallet via secret-service | Yes (when D-Bus available) |
| Linux headless/CI | No keyring | Fallback only |
| Windows | Credential Manager (DPAPI) | Yes (case-insensitive) |

### Encryption Portability

Encrypted fallback files are NOT portable between machines — key derivation includes `os.hostname()` and `os.userInfo().username`. This is an existing behavior (ToolKeyStorage line 255) preserved by SecureStore.
