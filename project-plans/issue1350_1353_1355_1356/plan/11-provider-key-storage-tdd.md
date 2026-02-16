# Phase 11: ProviderKeyStorage TDD

## Phase ID

`PLAN-20260211-SECURESTORE.P11`

## Prerequisites

- Required: Phase 10a completed
- Verification: `ls .completed/P10a.md`
- Expected files: `packages/core/src/storage/provider-key-storage.ts` (stub)

## Requirements Implemented (Expanded)

### R9: ProviderKeyStorage — Named API Key CRUD

#### R9.1 — Ubiquitous
**Full Text**: `ProviderKeyStorage` shall be backed by a `SecureStore` instance with service name `llxprt-code-provider-keys` and fallback directory `~/.llxprt/provider-keys/` with fallback policy `'allow'`.
**Behavior**:
- GIVEN: ProviderKeyStorage is instantiated
- WHEN: Any storage operation is performed
- THEN: Operations are backed by SecureStore with the correct service name and fallback config
**Why This Matters**: Tests must verify the backing store is configured correctly, not just that CRUD works.

#### R9.2 — Event-Driven
**Full Text**: When `saveKey(name, apiKey)` is called with a valid name, ProviderKeyStorage shall trim leading/trailing whitespace and trailing newline/carriage return characters from the API key value, then store the result via SecureStore.
**Behavior**:
- GIVEN: An API key with trailing newline `"sk-abc123\n"`
- WHEN: `saveKey('mykey', 'sk-abc123\n')` is called
- THEN: The stored value is `"sk-abc123"` (newline removed)
**Why This Matters**: Tests must verify actual normalization of stored values.

#### R9.3 — Event-Driven
**Full Text**: When `getKey(name)` is called and the named key exists, ProviderKeyStorage shall return the stored API key string. When it does not exist, it shall return `null`.
**Behavior**:
- GIVEN: A stored key named 'mykey' with value 'sk-abc123'
- WHEN: `getKey('mykey')` is called
- THEN: Returns `'sk-abc123'`
**Why This Matters**: Tests must verify round-trip storage and null-for-missing semantics.

#### R9.4 — Event-Driven
**Full Text**: When `deleteKey(name)` is called, ProviderKeyStorage shall remove the key from SecureStore and return `true` if deleted, `false` if not found.
**Behavior**:
- GIVEN: Key `mykey` exists
- WHEN: `deleteKey('mykey')` is called
- THEN: Returns `true` and subsequent `getKey('mykey')` returns `null`
**Why This Matters**: Tests must verify both the return value and actual deletion.

#### R9.5 — Event-Driven
**Full Text**: When `listKeys()` is called, ProviderKeyStorage shall return all stored key names from SecureStore, sorted alphabetically and deduplicated.
**Behavior**:
- GIVEN: Keys `beta`, `alpha`, `gamma` stored
- WHEN: `listKeys()` is called
- THEN: Returns `['alpha', 'beta', 'gamma']` (sorted, deduplicated)
**Why This Matters**: Tests must verify sort order and deduplication.

#### R9.6 — Event-Driven
**Full Text**: When `hasKey(name)` is called, ProviderKeyStorage shall return `true` if the named key exists, `false` otherwise.
**Behavior**:
- GIVEN: Key `mykey` exists, key `notexist` does not
- WHEN: `hasKey('mykey')` and `hasKey('notexist')` are called
- THEN: Returns `true` and `false` respectively
**Why This Matters**: Tests must verify boolean existence check.

### R10: ProviderKeyStorage — Key Name Validation

#### R10.1 — Ubiquitous
**Full Text**: ProviderKeyStorage shall validate key names against the regex `^[a-zA-Z0-9._-]{1,64}$`. Names are case-sensitive and stored as-is with no normalization.
**Behavior**:
- GIVEN: An invalid key name `"my key!"` (contains space and exclamation)
- WHEN: `saveKey('my key!', 'value')` is called
- THEN: Throws with message containing "invalid"
**Why This Matters**: Tests must verify regex enforcement on all mutating operations.

#### R10.2 — Unwanted Behavior
**Full Text**: If a key name does not match the validation regex, ProviderKeyStorage shall reject the operation with a descriptive error message: `Key name '<name>' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).`
**Behavior**:
- GIVEN: An invalid key name `"bad name!"`
- WHEN: Any operation is called with that name
- THEN: Error message: `Key name 'bad name!' is invalid. Use only letters, numbers, dashes, underscores, and dots (1-64 chars).`
**Why This Matters**: Tests must verify exact error message format including the name.

### R11: ProviderKeyStorage — Platform Limitations

#### R11.1 — Ubiquitous
**Full Text**: ProviderKeyStorage shall not normalize key name casing. On platforms where keyring backends are case-insensitive (Windows Credential Manager), two key names differing only by case may collide. ProviderKeyStorage shall not attempt to detect or mitigate this.
**Behavior**:
- GIVEN: Keys saved as `MyKey` and `mykey`
- WHEN: Both are stored and retrieved
- THEN: They are treated as separate keys (no case normalization applied)
**Why This Matters**: Tests must verify case-sensitivity — `MyKey` ≠ `mykey`.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/provider-key-storage.test.ts`
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P11`
  - MUST include: `@requirement:R9.1` through `@requirement:R11.1`

### Test Infrastructure

```typescript
// Use same pattern as SecureStore tests:
// - createMockKeytar() for SecureStore's keytar adapter
// - fs.mkdtemp for temp fallback directory
// - Inject SecureStore with mock keytar via ProviderKeyStorage constructor
// - NO mocking of fs or crypto
```

### Required Tests (minimum 15 behavioral tests)

#### Key Name Validation (R10.1, R10.2)
1. Valid name accepted (alphanumeric)
2. Valid name with dashes, underscores, dots
3. Invalid name with spaces → error with message
4. Invalid name with special chars → error
5. Name too long (65 chars) → error
6. Empty name → error
7. Name exactly 64 chars → accepted
8. Case-sensitive: 'MyKey' and 'mykey' are different (R11.1)

#### CRUD Operations (R9.2-R9.6)
9. saveKey stores and getKey retrieves
10. saveKey trims whitespace from API key value
11. saveKey strips trailing newlines/carriage returns
12. getKey returns null for non-existent key
13. deleteKey returns true when key deleted
14. deleteKey returns false when key not found
15. listKeys returns sorted, deduplicated names
16. hasKey returns true for existing key
17. hasKey returns false for non-existing key

#### Input Normalization Edge Cases
18. API key with only whitespace → error (empty after trim)
19. API key with leading/trailing spaces → spaces trimmed
20. API key with embedded newlines → only trailing stripped

### FORBIDDEN Patterns

Same as P05 — no mock theater, no reverse testing, no structure-only tests.

## Verification Commands

```bash
# 1. Test file created
ls packages/core/src/storage/provider-key-storage.test.ts

# 2. Test count
grep -c "it(" packages/core/src/storage/provider-key-storage.test.ts
# Expected: 15+

# 3. Plan markers
grep -c "@plan.*SECURESTORE.P11" packages/core/src/storage/provider-key-storage.test.ts
# Expected: 3+

# 4. Requirement coverage
for req in R9 R10 R11; do
  grep -q "$req" packages/core/src/storage/provider-key-storage.test.ts && echo "COVERED: $req" || echo "MISSING: $req"
done

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/storage/provider-key-storage.test.ts
# Expected: 0

# 6. Behavioral assertions
grep -c "toBe(\|toEqual(\|toMatch(\|toContain(\|toThrow(" packages/core/src/storage/provider-key-storage.test.ts
# Expected: 15+

# 7. Tests fail naturally
npm test -- packages/core/src/storage/provider-key-storage.test.ts 2>&1 | tail -20
```

## Structural Verification Checklist

- [ ] Test file created
- [ ] 15+ behavioral tests
- [ ] No mock theater
- [ ] No reverse testing
- [ ] Tests use real SecureStore (via injected mock keytar)
- [ ] Requirement markers present

## Semantic Verification Checklist (MANDATORY)

1. **Do tests verify actual storage/retrieval?**
   - [ ] saveKey + getKey round-trip tested
   - [ ] Values are actually encrypted and decrypted via SecureStore

2. **Do validation tests check error messages?**
   - [ ] Invalid name error includes the name in the message
   - [ ] Error message matches R10.2 format

3. **Is input normalization tested with actual values?**
   - [ ] Test passes `"  sk-abc  \n"` and verifies `"sk-abc"` is stored

## Failure Recovery

1. `git checkout -- packages/core/src/storage/provider-key-storage.test.ts`
2. Re-run Phase 11

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P11.md`
