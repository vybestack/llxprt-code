# Phase 12: ProviderKeyStorage Implementation

## Phase ID

`PLAN-20260211-SECURESTORE.P12`

## Prerequisites

- Required: Phase 11a completed
- Verification: `ls .completed/P11a.md`
- Expected files:
  - `packages/core/src/storage/provider-key-storage.ts` (stub from P10)
  - `packages/core/src/storage/provider-key-storage.test.ts` (tests from P11)

## Requirements Implemented (Expanded)

### R9: Named API Key CRUD

#### R9.1 — Backed by SecureStore
**Full Text**: `ProviderKeyStorage` shall be backed by a `SecureStore` instance with service name `llxprt-code-provider-keys` and fallback directory `~/.llxprt/provider-keys/` with fallback policy `'allow'`.
**Behavior**:
- GIVEN: A `ProviderKeyStorage` instance is created (or obtained via singleton)
- WHEN: Any operation is performed
- THEN: It delegates to a `SecureStore` constructed with service name `'llxprt-code-provider-keys'`, fallback directory `~/.llxprt/provider-keys/`, and fallback policy `'allow'`
**Why This Matters**: Standardizes provider key storage on the same secure infrastructure as all other credential storage.

#### R9.2 — Save with Trimming
**Full Text**: When `saveKey(name, apiKey)` is called with a valid name, ProviderKeyStorage shall trim leading/trailing whitespace and trailing newline/carriage return characters from the API key value, then store the result via SecureStore.
**Behavior**:
- GIVEN: A valid key name `'my-key'` and an API key `'  sk-abc123
'`
- WHEN: `saveKey('my-key', '  sk-abc123
')` is called
- THEN: The value `'sk-abc123'` (trimmed) is stored via `SecureStore.set('my-key', 'sk-abc123')`
**Why This Matters**: Users frequently copy-paste keys with trailing whitespace/newlines; trimming prevents invisible auth failures.

#### R9.3 — Get Key
**Full Text**: When `getKey(name)` is called and the named key exists, ProviderKeyStorage shall return the stored API key string. When it does not exist, it shall return `null`.
**Behavior**:
- GIVEN: A key `'my-key'` has been saved
- WHEN: `getKey('my-key')` is called
- THEN: The stored API key string is returned
- AND GIVEN: No key named `'nonexistent'` exists
- WHEN: `getKey('nonexistent')` is called
- THEN: `null` is returned
**Why This Matters**: Core retrieval operation used by `/key load` and `--key-name` resolution.

#### R9.4 — Delete Key
**Full Text**: When `deleteKey(name)` is called, ProviderKeyStorage shall remove the key from SecureStore and return `true` if deleted, `false` if not found.
**Behavior**:
- GIVEN: A key `'my-key'` exists
- WHEN: `deleteKey('my-key')` is called
- THEN: The key is removed and `true` is returned
- AND GIVEN: No key named `'nonexistent'` exists
- WHEN: `deleteKey('nonexistent')` is called
- THEN: `false` is returned
**Why This Matters**: Users need to be able to remove compromised or outdated keys, with clear feedback on whether anything was removed.

#### R9.5 — List Keys (Sorted, Deduplicated)
**Full Text**: When `listKeys()` is called, ProviderKeyStorage shall return all stored key names from SecureStore, sorted alphabetically and deduplicated.
**Behavior**:
- GIVEN: Keys `'claude'`, `'gemini'`, `'openai'` are stored (some in keyring, some in fallback)
- WHEN: `listKeys()` is called
- THEN: `['claude', 'gemini', 'openai']` is returned (sorted alphabetically, deduplicated)
**Why This Matters**: Powers the `/key list` command and autocomplete — users need a predictable, sorted inventory.

#### R9.6 — Has Key
**Full Text**: When `hasKey(name)` is called, ProviderKeyStorage shall return `true` if the named key exists, `false` otherwise.
**Behavior**:
- GIVEN: A key `'my-key'` exists
- WHEN: `hasKey('my-key')` is called
- THEN: `true` is returned
- AND GIVEN: No key named `'nonexistent'` exists
- WHEN: `hasKey('nonexistent')` is called
- THEN: `false` is returned
**Why This Matters**: Used by `/key save` to check for existing keys before prompting for overwrite confirmation.

### R10: Key Name Validation

#### R10.1 — Validation Regex
**Full Text**: ProviderKeyStorage shall validate key names against the regex `^[a-zA-Z0-9._-]{1,64}$`. Names are case-sensitive and stored as-is with no normalization.
**Behavior**:
- GIVEN: A key name `'my-api-key.v2'`
- WHEN: Any operation is called with this name
- THEN: The name passes validation (matches `^[a-zA-Z0-9._-]{1,64}$`)
**Why This Matters**: Prevents filesystem path injection and keeps key names safe for use as filenames and keyring entries.

#### R10.2 — Invalid Name Rejection
**Full Text**: If a key name does not match the validation regex, ProviderKeyStorage shall reject the operation with a descriptive error message: `Key name '<name>' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).`
**Behavior**:
- GIVEN: An invalid key name `'my key!!'` (contains spaces and special characters)
- WHEN: `saveKey('my key!!', 'sk-abc')` is called
- THEN: An error is thrown with message `Key name 'my key!!' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).`
**Why This Matters**: Clear, prescriptive error messages help users self-correct without consulting documentation.

### R11: Platform Limitations

#### R11.1 — No Case Normalization
**Full Text**: ProviderKeyStorage shall not normalize key name casing. On platforms where keyring backends are case-insensitive (Windows Credential Manager), two key names differing only by case may collide. ProviderKeyStorage shall not attempt to detect or mitigate this.
**Behavior**:
- GIVEN: A key name `'MyKey'` and a key name `'mykey'`
- WHEN: Both are saved
- THEN: Both are stored as-is with no case normalization; on case-insensitive keyring backends, the second may overwrite the first (known limitation)
**Why This Matters**: Explicit design decision — simplicity over cross-platform case collision mitigation; documented as a known limitation.

## Implementation Tasks

### Files to Modify

- `packages/core/src/storage/provider-key-storage.ts` — UPDATE existing stub
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P12`
  - MUST include: `@pseudocode lines X-Y` references

### MANDATORY: Follow Pseudocode Line-by-Line

From `analysis/pseudocode/provider-key-storage.md`:

#### validateKeyName (pseudocode lines 1–10)
- Line 1: KEY_NAME_REGEX constant
- Lines 3–9: Validation function with descriptive error message

#### Constructor (pseudocode lines 11–25)
- Lines 16–24: Create SecureStore with correct config, accept injection

#### saveKey (pseudocode lines 26–40)
- Line 28: Validate name
- Lines 31–32: Trim and normalize API key value
- Lines 34–36: Reject empty value
- Line 39: Delegate to SecureStore.set()

#### getKey (pseudocode lines 41–47)
- Line 43: Validate name
- Line 46: Delegate to SecureStore.get()

#### deleteKey (pseudocode lines 48–54)
- Line 50: Validate name
- Line 53: Delegate to SecureStore.delete()

#### listKeys (pseudocode lines 55–58)
- Line 57: Delegate to SecureStore.list()

#### hasKey (pseudocode lines 59–65)
- Line 61: Validate name
- Line 64: Delegate to SecureStore.has()

#### Singleton (pseudocode lines 68–80)
- Lines 70–75: getProviderKeyStorage lazy singleton
- Lines 77–80: resetProviderKeyStorage for testing

### Files to Modify (exports)

- `packages/core/src/index.ts` (or barrel export) — Add ProviderKeyStorage exports

## Verification Commands

```bash
# 1. All tests pass
npm test -- packages/core/src/storage/provider-key-storage.test.ts
# Expected: ALL PASS

# 2. No test modifications
git diff packages/core/src/storage/provider-key-storage.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"
# Expected: no changes

# 3. Plan markers
grep -c "@plan.*SECURESTORE.P12" packages/core/src/storage/provider-key-storage.ts
# Expected: 3+

# 4. Pseudocode references
grep -c "@pseudocode" packages/core/src/storage/provider-key-storage.ts
# Expected: 3+

# 5. TypeScript compiles
npm run typecheck

# 6. Full test suite passes
npm test

# 7. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/storage/provider-key-storage.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/storage/provider-key-storage.ts
grep -rn -E "return \[\]$|return \{\}$" packages/core/src/storage/provider-key-storage.ts
# Expected: no matches

# 8. ProviderKeyStorage exported
grep "ProviderKeyStorage\|getProviderKeyStorage" packages/core/src/index.ts 2>/dev/null || echo "Check export location"
```

## Structural Verification Checklist

- [ ] All P11 tests pass
- [ ] Tests not modified
- [ ] Plan markers present
- [ ] Pseudocode references present
- [ ] TypeScript compiles
- [ ] No deferred implementation patterns
- [ ] ProviderKeyStorage exported from core package

## Semantic Verification Checklist (MANDATORY)

1. **Does saveKey actually trim and normalize?**
   - [ ] Read the implementation
   - [ ] Verify `.trim()` is called on apiKey
   - [ ] Verify trailing `\r\n` stripped

2. **Does validation use the correct regex?**
   - [ ] `^[a-zA-Z0-9._-]{1,64}$` exactly
   - [ ] Error message matches R10.2 format

3. **Does the singleton work correctly?**
   - [ ] getProviderKeyStorage() returns same instance on multiple calls
   - [ ] resetProviderKeyStorage() clears the instance

## Failure Recovery

1. `git checkout -- packages/core/src/storage/provider-key-storage.ts`
2. Re-run Phase 12

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P12.md`
