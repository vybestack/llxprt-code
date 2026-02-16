=== PHASE: 04-securestore-stub.md ===
# Phase 04: SecureStore Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P04`

## Prerequisites

- Required: Phase 03a completed
- Verification: `ls .completed/P03a.md`
- Expected files from previous phase: All pseudocode files in `analysis/pseudocode/`
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R1.1: SecureStore Keyring Access

**Full Text**: SecureStore shall dynamically import `@napi-rs/keyring` and wrap `AsyncEntry` instances to provide `getPassword`, `setPassword`, `deletePassword`, and optionally `findCredentials` operations against the OS keyring.
**Behavior (stub)**: Method signatures exist, throw `NotYetImplemented`.
**Why This Matters**: This is the foundation class that all other components depend on.

### R1.3: keytarLoader Injection

**Full Text**: SecureStore shall accept a `keytarLoader` option in its constructor to allow injection of a mock keyring adapter for testing.
**Behavior (stub)**: Constructor accepts options with keytarLoader field.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/secure-store.ts` — SecureStore class stub
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P04`
  - MUST include: `@requirement:R1.1, R1.3, R2.1, R3.1a, R3.1b, R3.2-R3.8, R4.1-R4.8, R5.1-R5.2, R6.1`
  - Classes: `SecureStore`, `SecureStoreError`
  - Interface: `KeytarAdapter`, `SecureStoreOptions`
  - Export: `SecureStore`, `SecureStoreError`, `KeytarAdapter`, `SecureStoreOptions`
  - Methods throw `new Error('NotYetImplemented')` or return empty values of correct type
  - Maximum ~100 lines

### Stub Implementation Rules

```typescript
// Methods can either throw:
async set(key: string, value: string): Promise<void> {
  throw new Error('NotYetImplemented');
}

// OR return empty values:
async get(key: string): Promise<string | null> {
  throw new Error('NotYetImplemented');
}
async list(): Promise<string[]> {
  throw new Error('NotYetImplemented');
}
async has(key: string): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
async delete(key: string): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
async isKeychainAvailable(): Promise<boolean> {
  throw new Error('NotYetImplemented');
}
```

### Required Code Markers

Every function/class MUST include:
```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P04
 * @requirement R1.1
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check file created
ls packages/core/src/storage/secure-store.ts
# Expected: file exists

# Check plan markers
grep -r "@plan:PLAN-20260211-SECURESTORE.P04\|@plan PLAN-20260211-SECURESTORE.P04" packages/core/src/storage/secure-store.ts | wc -l
# Expected: 2+ occurrences

# TypeScript compiles
npm run typecheck
# Expected: passes

# No TODO comments in production code
grep "TODO" packages/core/src/storage/secure-store.ts
# Expected: no matches

# No version duplication
find packages/core/src -name "*SecureStoreV2*" -o -name "*SecureStoreNew*"
# Expected: no matches

# Tests don't EXPECT NotYetImplemented
grep -r "expect.*NotYetImplemented\|toThrow.*NotYetImplemented" packages/core/src/storage/
# Expected: no matches (no tests yet, but verify)
```

### Structural Verification Checklist

- [ ] `secure-store.ts` created in `packages/core/src/storage/`
- [ ] `SecureStore` class exported
- [ ] `SecureStoreError` class exported
- [ ] `KeytarAdapter` interface exported
- [ ] `SecureStoreOptions` interface exported
- [ ] All six public methods present (set, get, delete, list, has, isKeychainAvailable)
- [ ] Constructor accepts serviceName and options
- [ ] Plan markers present
- [ ] TypeScript compiles
- [ ] No TODO comments

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
# Expected: No matches (NotYetImplemented in stub bodies is OK but not as comments)

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
# Expected: No matches
```

## Semantic Verification Checklist (MANDATORY)

1. **Does the stub have the correct API surface?**
   - [ ] SecureStore class exported with correct constructor signature (`serviceName: string, options?: SecureStoreOptions`)
   - [ ] All six public methods present with correct TypeScript signatures (`set`, `get`, `delete`, `list`, `has`, `isKeychainAvailable`)
   - [ ] SecureStoreError class exported with `code` and `remediation` properties
   - [ ] KeytarAdapter interface matches expected adapter shape (`getPassword`, `setPassword`, `deletePassword`, `findCredentials?`)
   - [ ] SecureStoreOptions interface has `fallbackDir`, `fallbackPolicy`, `keytarLoader`

2. **Is this a valid stub (not empty shell)?**
   - [ ] Methods throw `NotYetImplemented` (not return `undefined` silently)
   - [ ] TypeScript strict mode satisfied (no `any` escapes, correct return types)
   - [ ] Imports compile correctly

3. **Would TDD tests be writable against this stub?**
   - [ ] Tests can import all public types (`SecureStore`, `SecureStoreError`, `KeytarAdapter`, `SecureStoreOptions`)
   - [ ] Tests can construct SecureStore with custom `keytarLoader`
   - [ ] Tests would fail with `NotYetImplemented` (not compile error)

## Success Criteria

- SecureStore class stub compiles with strict TypeScript
- All public API methods present with correct signatures
- No more than ~100 lines
- No TODO comments, no version duplications

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/storage/secure-store.ts`
2. Re-run Phase 04

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P04.md`
Contents:
```markdown
Phase: P04
Completed: [timestamp]
Files Created: packages/core/src/storage/secure-store.ts [line count]
Tests Added: 0
Verification: [paste outputs]
```

=== PHASE: 05-securestore-tdd.md ===
# Phase 05: SecureStore TDD

## Phase ID

`PLAN-20260211-SECURESTORE.P05`

## Prerequisites

- Required: Phase 04a completed
- Verification: `ls .completed/P04a.md`
- Expected files: `packages/core/src/storage/secure-store.ts` (stub)
- Preflight verification: Phase 01 completed

## Requirements Implemented (Expanded)

### R1.1: Keyring Access
**Full Text**: SecureStore shall dynamically import `@napi-rs/keyring` and wrap `AsyncEntry` instances.
**Behavior**:
- GIVEN: A SecureStore with injected keytarLoader
- WHEN: `set('mykey', 'myvalue')` is called and keyring is available
- THEN: Value is stored via `keytarAdapter.setPassword(serviceName, 'mykey', 'myvalue')`

### R1.2: Module-Not-Found Detection
**Full Text**: When `@napi-rs/keyring` cannot be loaded, SecureStore shall detect the failure and treat the keyring as unavailable.
**Behavior**:
- GIVEN: A SecureStore with keytarLoader that returns null
- WHEN: `isKeychainAvailable()` is called
- THEN: Returns `false`

### R2.1: Availability Probe
**Full Text**: SecureStore shall perform a set-get-delete test cycle.
**Behavior**:
- GIVEN: A SecureStore with working keytar adapter
- WHEN: `isKeychainAvailable()` is called
- THEN: Returns `true` after successful probe cycle

### R2.2: Probe Caching
**Full Text**: SecureStore shall cache the availability probe result for 60 seconds.
**Behavior**:
- GIVEN: A probe that returns true
- WHEN: `isKeychainAvailable()` is called again within 60 seconds
- THEN: Returns cached result without re-probing

### R2.3: Transient Error Cache Invalidation
**Full Text**: When a transient error occurs during probing, SecureStore shall invalidate the cache.
**Behavior**:
- GIVEN: A cached probe result
- WHEN: A timeout error occurs during subsequent operation
- THEN: Cache is invalidated, next call re-probes

### R3: CRUD Operations

#### R3.1a — Set with Keyring Available
**Full Text**: When `set(key, value)` is called and the OS keyring is available, SecureStore shall store the value in the OS keyring under the configured `serviceName` and the provided `key`.
**Behavior**:
- GIVEN: A SecureStore with working keytar adapter and temp fallback dir
- WHEN: `set('mykey', 'myvalue')` is called
- THEN: Value is stored in keyring and retrievable via `get('mykey')`
**Why This Matters**: The keyring is the primary, most secure storage path.

#### R3.1b — Set with Keyring Unavailable
**Full Text**: When `set(key, value)` is called and the OS keyring is unavailable, SecureStore shall store the value in the encrypted fallback file (subject to `fallbackPolicy` per R4.1 and R4.2).
**Behavior**:
- GIVEN: A SecureStore with keytarLoader returning null and `fallbackPolicy: 'allow'`
- WHEN: `set('mykey', 'myvalue')` is called
- THEN: Value is stored as encrypted file `{fallbackDir}/mykey.enc` and retrievable via `get('mykey')`
**Why This Matters**: Ensures secrets persist when no OS keyring is available.

#### R3.2 — Get from Keyring
**Full Text**: When `get(key)` is called and the key exists in the OS keyring, SecureStore shall return the value from the keyring.
**Behavior**:
- GIVEN: A key stored in the keyring
- WHEN: `get('mykey')` is called
- THEN: The stored value is returned
**Why This Matters**: Primary read path from the authoritative store.

#### R3.3 — Get from Fallback
**Full Text**: When `get(key)` is called and the key does not exist in the keyring but exists in the encrypted fallback file, SecureStore shall return the value from the fallback file.
**Behavior**:
- GIVEN: A key exists only in the encrypted fallback file (keyring unavailable or key not in keyring)
- WHEN: `get('mykey')` is called
- THEN: The value is decrypted from the fallback file and returned
**Why This Matters**: Keys saved during keyring-unavailable periods must still be retrievable.

#### R3.4 — Get Returns Null When Not Found
**Full Text**: When `get(key)` is called and the key exists in neither the keyring nor the fallback file, SecureStore shall return `null`.
**Behavior**:
- GIVEN: No key named `'nonexistent'` in keyring or fallback
- WHEN: `get('nonexistent')` is called
- THEN: `null` is returned
**Why This Matters**: Callers need a clear signal to distinguish "not found" from errors.

#### R3.5 — Keyring Wins Over Fallback
**Full Text**: When both the keyring and the encrypted fallback file contain a value for the same key and `get(key)` is called, SecureStore shall return the keyring value. The keyring is the primary store; the fallback file is a safety net.
**Behavior**:
- GIVEN: Key `'mykey'` exists in keyring (value `'keyring-val'`) and fallback (value `'fallback-val'`)
- WHEN: `get('mykey')` is called
- THEN: `'keyring-val'` is returned
**Why This Matters**: Establishes clear precedence — keyring is authoritative.

#### R3.6 — Delete from Both Stores
**Full Text**: When `delete(key)` is called, SecureStore shall remove the key from both the OS keyring and the encrypted fallback file.
**Behavior**:
- GIVEN: Key `'mykey'` exists in both keyring and fallback
- WHEN: `delete('mykey')` is called
- THEN: Key is removed from both stores
**Why This Matters**: Prevents stale secrets lingering in one store after deletion.

#### R3.7 — List Deduplicates Across Stores
**Full Text**: When `list()` is called, SecureStore shall return a best-effort enumeration of all keys by combining keyring enumeration (via `findCredentials` if available) with a directory scan of fallback files, deduplicated by key name.
**Behavior**:
- GIVEN: Keys `'a'`, `'b'` in keyring and `'b'`, `'c'` as fallback files
- WHEN: `list()` is called
- THEN: `['a', 'b', 'c']` returned (deduplicated, sorted)
**Why This Matters**: Users need a complete inventory of keys regardless of backend.

#### R3.8 — Has Throws on Non-NOT_FOUND Errors
**Full Text**: When `has(key)` is called and the key does not exist, SecureStore shall return `false`. When `has(key)` is called and an error other than not-found occurs (unavailable, locked, denied, corrupt), SecureStore shall throw with the appropriate error taxonomy code.
**Behavior**:
- GIVEN: Key `'mykey'` does not exist
- WHEN: `has('mykey')` is called
- THEN: `false` is returned
- AND GIVEN: A LOCKED error occurs during `has('mykey')`
- THEN: `SecureStoreError` with code `LOCKED` is thrown
**Why This Matters**: Distinguishes safe "not found" from actionable errors.

### R4: Encrypted File Fallback

#### R4.1 — Fallback When Keyring Unavailable (Allow Policy)
**Full Text**: While the OS keyring is unavailable and `fallbackPolicy` is `'allow'` (the default), SecureStore shall store and retrieve values using AES-256-GCM encrypted files in the configured `fallbackDir`.
**Behavior**:
- GIVEN: Keyring unavailable, `fallbackPolicy: 'allow'`
- WHEN: `set('key', 'value')` then `get('key')` is called
- THEN: Value is stored/retrieved as AES-256-GCM encrypted file in `fallbackDir`
**Why This Matters**: Ensures the tool works on systems without keyring support.

#### R4.2 — Fallback Denied Policy
**Full Text**: While the OS keyring is unavailable and `fallbackPolicy` is `'deny'`, SecureStore shall throw an error with taxonomy code `UNAVAILABLE` and actionable remediation message. It shall not fall back to encrypted files.
**Behavior**:
- GIVEN: Keyring unavailable, `fallbackPolicy: 'deny'`
- WHEN: `set('key', 'value')` is called
- THEN: `SecureStoreError` with code `UNAVAILABLE` and remediation text is thrown
**Why This Matters**: Security-conscious users can enforce keyring-only storage.

#### R4.3 — Async Scrypt Key Derivation
**Full Text**: SecureStore shall use async `scrypt` (not `scryptSync`) for key derivation with parameters N=16384, r=8, p=1. The key derivation input shall include a machine-specific identifier (hostname + username hash).
**Behavior**:
- GIVEN: A fallback file write operation
- WHEN: Encryption key is derived
- THEN: Async `scrypt` (not sync) is used with N=16384, r=8, p=1 and machine-specific salt
**Why This Matters**: Async scrypt avoids blocking the event loop; machine-specific salt prevents file portability.

#### R4.4 — One File Per Key
**Full Text**: SecureStore shall store each key as a separate encrypted file named `{key}.enc` in the `fallbackDir`.
**Behavior**:
- GIVEN: Fallback write for key `'mykey'`
- WHEN: Write completes
- THEN: File exists at `{fallbackDir}/mykey.enc`
**Why This Matters**: Per-key files enable independent CRUD without monolithic file rewrites.

#### R4.5 — Versioned Envelope Format
**Full Text**: All encrypted fallback files shall use a versioned envelope format: `{"v":1, "crypto":{"alg":"aes-256-gcm","kdf":"scrypt","N":16384,"r":8,"p":1,"saltLen":16}, "data":"<base64 ciphertext>"}`
**Behavior**:
- GIVEN: A fallback file written by SecureStore
- WHEN: File content is parsed as JSON
- THEN: It matches `{"v":1, "crypto":{...}, "data":"<base64>"}` with correct KDF params
**Why This Matters**: Versioned format enables future upgrades without breaking existing data.

#### R4.6 — Unrecognized Envelope Version Error
**Full Text**: If SecureStore reads a fallback file with an unrecognized envelope version, it shall emit a clear error with upgrade instructions rather than attempting to parse the data or silently returning null.
**Behavior**:
- GIVEN: A fallback file with `{"v":99, ...}`
- WHEN: `get(key)` reads this file
- THEN: `SecureStoreError` with code `CORRUPT` is thrown with upgrade instructions
**Why This Matters**: Prevents silent data corruption from version mismatches.

#### R4.7 — Atomic Write
**Full Text**: SecureStore shall write fallback files atomically: write to a temporary file in the same directory, `fsync` the file descriptor, `rename` to the final path, and set permissions to `0o600`.
**Behavior**:
- GIVEN: A fallback file write
- WHEN: Write completes
- THEN: File was written via temp → fsync → rename → chmod 0o600 sequence
**Why This Matters**: Atomic write prevents partial/corrupt files on crash or power loss.

#### R4.8 — Fallback Directory Creation
**Full Text**: SecureStore shall create the `fallbackDir` with permissions `0o700` if it does not exist.
**Behavior**:
- GIVEN: `fallbackDir` does not exist
- WHEN: A fallback write is attempted
- THEN: Directory is created with permissions `0o700`
**Why This Matters**: Secure default permissions prevent other system users from reading secrets.

### R5: No Backward Compatibility

#### R5.1 — Own Format Only
**Full Text**: SecureStore shall use its own envelope format exclusively. It shall not read, parse, or attempt to migrate encrypted files created by previous implementations (ToolKeyStorage `.key` files, FileTokenStorage `mcp-oauth-tokens-v2.json`). There are no migration shims, no legacy format readers, and no backward compatibility adapters.
**Behavior**:
- GIVEN: A file in legacy ToolKeyStorage `.key` format in fallback directory
- WHEN: SecureStore reads it
- THEN: File is treated as corrupt, not parsed as legacy format
**Why This Matters**: Clean break eliminates complex migration code and reduces attack surface.

#### R5.2 — Corrupt on Unrecognized Format
**Full Text**: If SecureStore encounters a fallback file that does not match the expected versioned envelope format, it shall treat the file as corrupt (taxonomy code `CORRUPT`) and shall not attempt legacy format detection or migration.
**Behavior**:
- GIVEN: A fallback file containing plain text or old `.key` format
- WHEN: SecureStore reads it
- THEN: `SecureStoreError` with code `CORRUPT` is thrown; no legacy detection attempted
**Why This Matters**: Treating unknown formats as corrupt is fail-safe.

### R6: Error Taxonomy

#### R6.1 — Error Code Mapping
**Full Text**: SecureStore shall map all errors to the following taxonomy codes and include the corresponding remediation text in user-facing messages: `UNAVAILABLE` (Keyring backend not present), `LOCKED` (Keyring present but locked), `DENIED` (Permission denied), `CORRUPT` (Stored data failed validation), `TIMEOUT` (Operation timed out), `NOT_FOUND` (Key does not exist).
**Behavior**:
- GIVEN: An error occurs during a SecureStore operation
- WHEN: The error is thrown
- THEN: It is a `SecureStoreError` with `code` from `{UNAVAILABLE, LOCKED, DENIED, CORRUPT, TIMEOUT, NOT_FOUND}` and a `remediation` string
**Why This Matters**: Actionable errors reduce user frustration and support burden.

### R7B: Resilience

#### R7B.1 — Mid-Session Keyring Failure
**Full Text**: When the OS keyring becomes unavailable mid-session (e.g., daemon restart, keyring locked after startup) and `fallbackPolicy` is `'allow'`, SecureStore shall fall back to encrypted files for subsequent operations rather than crashing.
**Behavior**:
- GIVEN: Keyring was available but becomes unavailable mid-session, `fallbackPolicy: 'allow'`
- WHEN: `set('key', 'value')` is called
- THEN: Value is stored in encrypted fallback instead of crashing
**Why This Matters**: Long-running sessions must survive transient keyring failures.

#### R7B.2 — Interrupted Write Safety
**Full Text**: If a fallback file write is interrupted (process kill, disk full), SecureStore's atomic write contract (R4.7) shall prevent partial or corrupt files from being left in the `fallbackDir`. A concurrent reader shall see either the old complete value or the new complete value, never a partial write.
**Behavior**:
- GIVEN: A fallback write in progress
- WHEN: Process is killed before rename
- THEN: No partial `.enc` file exists; readers see old complete value
**Why This Matters**: Crash safety prevents data corruption.

#### R7B.3 — Concurrent Writer Safety
**Full Text**: If two processes write to the same fallback file concurrently, SecureStore's atomic rename shall ensure no data is lost — one write wins, and neither produces a corrupt file.
**Behavior**:
- GIVEN: Two processes writing same fallback file simultaneously
- WHEN: Both complete
- THEN: Final file contains one complete value (last rename wins); no corruption
**Why This Matters**: Parallel terminal sessions must not corrupt stored secrets.

### R8: Observability

#### R8.1 — Structured Debug Logs
**Full Text**: All SecureStore operations shall emit structured debug logs including: operation type (keyring read/write/delete, fallback used, probe result), key identifiers (hashed for privacy in debug logs), timing information, failure reasons, fallback triggers, and error taxonomy code.
**Behavior**:
- GIVEN: A SecureStore operation is executed with debug logging enabled
- WHEN: The operation completes
- THEN: Structured log entry emitted with operation type, hashed key, timing, and outcome
**Why This Matters**: Debug logs are essential for diagnosing keyring issues without exposing secrets.

#### R8.2 — No Secret Logging
**Full Text**: If any code path within SecureStore or its consumers logs a secret value (API key, token, password) at any log level, this is a defect. SecureStore and its consumers shall not emit secret values to any log output. Masked key previews (via `maskKeyForDisplay`) are acceptable in user-facing output only, never in log files.
**Behavior**:
- GIVEN: Any SecureStore operation handling secret values
- WHEN: Log output is emitted
- THEN: No secret values appear in logs; only hashed identifiers acceptable
**Why This Matters**: Secret leakage in logs is a security vulnerability.

### R27: Fault-Injection Tests

#### R27.1 — Fault-Injection Coverage
**Full Text**: SecureStore shall have fault-injection tests covering: write interruption mid-fsync, keyring error after successful fallback write, and lock contention between concurrent writers (per #1350 acceptance criteria).
**Behavior**:
- GIVEN: SecureStore test suite
- WHEN: Fault-injection tests are run
- THEN: Tests cover write interruption mid-fsync, keyring error after fallback write, and concurrent writer lock contention
**Why This Matters**: Fault-injection validates resilience guarantees (R7B) under realistic failure conditions.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/secure-store.test.ts` — Comprehensive behavioral tests
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P05`
  - MUST include: `@requirement:R1.1` through `@requirement:R8.2`

### Test Infrastructure

```typescript
// Follow pattern from tool-key-storage.test.ts:
// - createMockKeytar() — in-memory Map<string, string> with findCredentials
// - fs.mkdtemp() for temp fallbackDir
// - Inject via keytarLoader option
// - NO mocking of fs or crypto — use real filesystem and real crypto
```

### Required Tests (minimum 32 behavioral tests)

#### Keyring Access (R1)
1. Store value in keyring when available
2. Retrieve value from keyring
3. Handle keyring unavailable (keytarLoader returns null)
4. keytarLoader injection works for testing

#### Availability Probe (R2)
5. Probe returns true when keyring works
6. Probe returns false when keyring fails
7. Probe result cached for 60 seconds
8. Transient error invalidates cache

#### CRUD Operations (R3)
9. set() stores in keyring when available
10. set() stores in fallback when keyring unavailable
11. get() retrieves from keyring
12. get() retrieves from fallback when not in keyring
13. get() returns null when not found anywhere
14. get() keyring value wins over fallback value (R3.5)
15. delete() removes from both keyring and fallback
16. list() combines keyring and fallback, deduplicated
17. has() returns true when key exists
18. has() returns false when key not found
19. has() throws on non-NOT_FOUND errors

#### Encrypted File Fallback (R4)
20. Fallback uses AES-256-GCM encryption
21. Fallback files use versioned envelope format
22. Unrecognized envelope version throws CORRUPT error
23. Atomic write prevents corruption (temp+fsync+rename)
24. Fallback directory created with 0o700 permissions
25. File permissions set to 0o600

#### No Backward Compatibility (R5)
26. Legacy format files treated as CORRUPT
27. No migration attempt on unrecognized format

#### Error Taxonomy (R6)
28. UNAVAILABLE error with remediation
29. CORRUPT error on bad envelope
30. NOT_FOUND handling

#### Resilience (R7B)
31. Mid-session keyring failure falls back to file
32. Atomic write prevents partial files on interruption

#### Key Validation (Path Safety)
33. Key with path separator (`/` or ``) rejected with CORRUPT error
34. Key with null byte rejected with CORRUPT error
35. Key with `.` or `..` component rejected with CORRUPT error
36. list() skips malformed filenames (e.g., containing path separators) with debug log

#### Probe Cache Invalidation on Repeated Failures
37. Probe cache invalidated after N consecutive keyring operation failures (e.g., 3)
38. Consecutive failure counter resets on successful keyring operation
39. After cache invalidation, next isKeychainAvailable() re-probes instead of returning stale result

#### Fault Injection (R27.1)
40. Write interruption mid-fsync
41. Keyring error after successful fallback write
42. Concurrent writer safety

### Test Pattern Requirements

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P05
 * @requirement R3.1a
 * @scenario Store value when keyring is available
 * @given A SecureStore with working keytar adapter and temp fallback dir
 * @when set('mykey', 'myvalue') is called
 * @then Value is stored in keyring and retrievable via get('mykey')
 */
it('stores value in keyring when available', async () => {
  const store = new SecureStore('test-service', {
    keytarLoader: () => Promise.resolve(createMockKeytar()),
    fallbackDir: tempDir,
  });
  await store.set('mykey', 'myvalue');
  const result = await store.get('mykey');
  expect(result).toBe('myvalue');
});
```

### FORBIDDEN Patterns

- `expect(mockService.method).toHaveBeenCalled()` — mock theater
- `expect(result).toHaveProperty('field')` — structure-only test
- `expect(() => fn()).not.toThrow()` — reverse testing
- `expect(fn).toThrow('NotYetImplemented')` — testing stubs
- Tests that pass with empty implementations

## Verification Commands

```bash
# 1. Test file exists
ls packages/core/src/storage/secure-store.test.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P05" packages/core/src/storage/secure-store.test.ts
# Expected: 5+

# 3. Requirement markers
grep -c "@requirement" packages/core/src/storage/secure-store.test.ts
# Expected: 10+

# 4. Test count
grep -c "it(" packages/core/src/storage/secure-store.test.ts
# Expected: 32+

# 5. No mock theater
grep -c "toHaveBeenCalled\|toHaveBeenCalledWith" packages/core/src/storage/secure-store.test.ts
# Expected: 0

# 6. No reverse testing
grep -c "toThrow.*NotYetImplemented\|not\.toThrow" packages/core/src/storage/secure-store.test.ts
# Expected: 0

# 7. No structure-only tests
grep -c "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/storage/secure-store.test.ts
# Expected: 0 (or only with specific value checks)

# 8. Behavioral assertions present
grep -c "toBe(\|toEqual(\|toMatch(\|toContain(" packages/core/src/storage/secure-store.test.ts
# Expected: 25+

# 9. Tests fail naturally (not with NotYetImplemented)
npm test -- packages/core/src/storage/secure-store.test.ts 2>&1 | tail -20
# Expected: failures with "Cannot read property" or "is not a function", NOT "NotYetImplemented"
```

## Structural Verification Checklist

- [ ] Test file created
- [ ] 32+ behavioral tests
- [ ] Plan markers on all test blocks
- [ ] Requirement markers present
- [ ] No mock theater patterns
- [ ] No reverse testing patterns
- [ ] Tests use real filesystem (fs.mkdtemp for temp dir)
- [ ] Tests use injected keytarLoader (not mocked fs)

### Deferred Implementation Detection (MANDATORY)

```bash
# Not applicable for TDD phase (tests expected to fail)
# But verify no implementation was snuck into the stub:
grep -rn -E "(TODO|FIXME|HACK)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
```

## Semantic Verification Checklist (MANDATORY)

1. **Do tests verify BEHAVIOR, not structure?**
   - [ ] Each test asserts specific output values
   - [ ] Tests exercise real crypto (encrypted data changes each time)
   - [ ] Tests verify actual file contents on disk

2. **Would tests catch a broken implementation?**
   - [ ] Remove implementation → test fails
   - [ ] Wrong encryption → test fails
   - [ ] Missing fallback → test fails

3. **Are integration points tested?**
   - [ ] SecureStore → keytar adapter interaction
   - [ ] SecureStore → filesystem interaction
   - [ ] Error propagation tested

## Success Criteria

- 32+ behavioral tests covering R1-R8, R7B, R27.1, key validation, probe cache invalidation
- All tests fail naturally (not via NotYetImplemented check)
- No mock theater or reverse testing
- Tests use real filesystem and injected keytar adapter

## Failure Recovery

1. `git checkout -- packages/core/src/storage/secure-store.test.ts`
2. Re-run Phase 05

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P05.md`

=== PHASE: 06-securestore-impl.md ===
# Phase 06: SecureStore Implementation

## Phase ID

`PLAN-20260211-SECURESTORE.P06`

## Prerequisites

- Required: Phase 05a completed
- Verification: `ls .completed/P05a.md`
- Expected files:
  - `packages/core/src/storage/secure-store.ts` (stub from P04)
  - `packages/core/src/storage/secure-store.test.ts` (tests from P05)

## Requirements Implemented (Expanded)

### R1: Keyring Access

#### R1.1 — Keyring Loading
**Full Text**: SecureStore shall dynamically import `@napi-rs/keyring` and wrap `AsyncEntry` instances to provide `getPassword`, `setPassword`, `deletePassword`, and optionally `findCredentials` operations against the OS keyring.
**Behavior**:
- GIVEN: A SecureStore instance with default keytarLoader
- WHEN: Any operation requiring keyring access is called for the first time
- THEN: `@napi-rs/keyring` is dynamically imported and an adapter wrapping `AsyncEntry` is created with `getPassword`, `setPassword`, `deletePassword`, and `findCredentials` methods
**Why This Matters**: Dynamic import avoids hard dependency on native module; wrapping AsyncEntry provides a testable adapter interface.

#### R1.2 — Module-Not-Found Detection
**Full Text**: When `@napi-rs/keyring` cannot be loaded (module not found, dlopen failed), SecureStore shall detect the failure via error codes `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, `ERR_DLOPEN_FAILED`, or error messages containing `'@napi-rs/keyring'`, and shall treat the keyring as unavailable.
**Behavior**:
- GIVEN: A system where `@napi-rs/keyring` is not installed or the native binary cannot load
- WHEN: SecureStore attempts to load the keyring module
- THEN: The error is detected via codes `ERR_MODULE_NOT_FOUND`, `MODULE_NOT_FOUND`, `ERR_DLOPEN_FAILED`, or message containing `'@napi-rs/keyring'`, and the keyring is marked unavailable (adapter set to null)
**Why This Matters**: Graceful degradation on systems without native keyring support prevents crashes and enables fallback-based operation.

#### R1.3 — keytarLoader Injection
**Full Text**: SecureStore shall accept a `keytarLoader` option in its constructor to allow injection of a mock keyring adapter for testing.
**Behavior**:
- GIVEN: A SecureStore constructor call with `keytarLoader` in the options
- WHEN: The instance needs a keyring adapter
- THEN: The injected `keytarLoader` function is called instead of the default dynamic import loader
**Why This Matters**: Enables deterministic testing without real OS keyring, making tests fast and CI-friendly.

### R2: Availability Probing

#### R2.1 — Probe Mechanism
**Full Text**: When `isKeychainAvailable()` is called, SecureStore shall perform a set-get-delete test cycle using a randomly-named test account to determine whether the OS keyring is functional.
**Behavior**:
- GIVEN: A SecureStore instance with a loaded keyring adapter
- WHEN: `isKeychainAvailable()` is called
- THEN: A set-get-delete cycle is performed using a randomly-named test account; returns `true` if the cycle succeeds, `false` if it fails
**Why This Matters**: A real round-trip probe detects locked/broken keyrings that would fail silently on individual operations.

#### R2.2 — Probe Caching
**Full Text**: SecureStore shall cache the availability probe result for 60 seconds. Subsequent calls to `isKeychainAvailable()` within the TTL shall return the cached result without re-probing.
**Behavior**:
- GIVEN: A previous successful call to `isKeychainAvailable()` within the last 60 seconds
- WHEN: `isKeychainAvailable()` is called again
- THEN: The cached result is returned without performing a new probe cycle
**Why This Matters**: Avoids expensive keyring round-trips on every operation while still detecting mid-session failures within a reasonable window.

#### R2.3 — Transient Error Cache Invalidation
**Full Text**: When a transient error (timeout) occurs during probing, SecureStore shall immediately invalidate the cached probe result so a subsequent call can retry without waiting for the TTL to expire.
**Behavior**:
- GIVEN: A cached probe result indicating the keyring is available
- WHEN: A transient error (timeout) occurs during a subsequent probe or operation
- THEN: The cached result is immediately invalidated so the next `isKeychainAvailable()` call re-probes
**Why This Matters**: Prevents stale positive cache from masking a keyring that has become temporarily unavailable.

### R3: CRUD Operations

#### R3.1a — Set with Keyring Available
**Full Text**: When `set(key, value)` is called and the OS keyring is available, SecureStore shall store the value in the OS keyring under the configured `serviceName` and the provided `key`.
**Behavior**:
- GIVEN: A SecureStore where `isKeychainAvailable()` returns `true`
- WHEN: `set('mykey', 'myvalue')` is called
- THEN: The value `'myvalue'` is stored in the OS keyring under `serviceName` / `'mykey'`
**Why This Matters**: The keyring is the primary, most secure storage path; this is the happy-path write.

#### R3.1b — Set with Keyring Unavailable
**Full Text**: When `set(key, value)` is called and the OS keyring is unavailable, SecureStore shall store the value in the encrypted fallback file (subject to `fallbackPolicy` per R4.1 and R4.2).
**Behavior**:
- GIVEN: A SecureStore where the OS keyring is unavailable and `fallbackPolicy` is `'allow'`
- WHEN: `set('mykey', 'myvalue')` is called
- THEN: The value is stored in the encrypted fallback file `{fallbackDir}/mykey.enc`
**Why This Matters**: Ensures secrets can still be persisted when no OS keyring is available (CI, containers, headless Linux).

#### R3.2 — Get from Keyring
**Full Text**: When `get(key)` is called and the key exists in the OS keyring, SecureStore shall return the value from the keyring.
**Behavior**:
- GIVEN: A key `'mykey'` stored in the OS keyring
- WHEN: `get('mykey')` is called
- THEN: The stored value is returned from the keyring
**Why This Matters**: Primary read path — keyring is the authoritative source of truth.

#### R3.3 — Get from Fallback
**Full Text**: When `get(key)` is called and the key does not exist in the keyring but exists in the encrypted fallback file, SecureStore shall return the value from the fallback file.
**Behavior**:
- GIVEN: A key `'mykey'` that does not exist in the keyring but exists as an encrypted fallback file
- WHEN: `get('mykey')` is called
- THEN: The value is decrypted and returned from the fallback file
**Why This Matters**: Ensures keys saved during keyring-unavailable periods are still retrievable.

#### R3.4 — Get Returns Null When Not Found
**Full Text**: When `get(key)` is called and the key exists in neither the keyring nor the fallback file, SecureStore shall return `null`.
**Behavior**:
- GIVEN: A key `'nonexistent'` that does not exist in the keyring or fallback
- WHEN: `get('nonexistent')` is called
- THEN: `null` is returned
**Why This Matters**: Callers need a clear signal (null) to distinguish "not found" from errors.

#### R3.5 — Keyring Wins Over Fallback
**Full Text**: When both the keyring and the encrypted fallback file contain a value for the same key and `get(key)` is called, SecureStore shall return the keyring value. The keyring is the primary store; the fallback file is a safety net.
**Behavior**:
- GIVEN: A key `'mykey'` exists in both keyring (value `'keyring-val'`) and fallback (value `'fallback-val'`)
- WHEN: `get('mykey')` is called
- THEN: `'keyring-val'` is returned (keyring wins)
**Why This Matters**: Establishes clear precedence — keyring is authoritative, fallback is only a safety net.

#### R3.6 — Delete from Both Stores
**Full Text**: When `delete(key)` is called, SecureStore shall remove the key from both the OS keyring and the encrypted fallback file.
**Behavior**:
- GIVEN: A key `'mykey'` exists in both the keyring and the fallback file
- WHEN: `delete('mykey')` is called
- THEN: The key is removed from both the keyring and the fallback file
**Why This Matters**: Prevents stale secrets from lingering in one store after deletion from the other.

#### R3.7 — List Deduplicates Across Stores
**Full Text**: When `list()` is called, SecureStore shall return a best-effort enumeration of all keys by combining keyring enumeration (via `findCredentials` if available) with a directory scan of fallback files, deduplicated by key name.
**Behavior**:
- GIVEN: Keys `'a'`, `'b'` in the keyring and `'b'`, `'c'` as fallback files
- WHEN: `list()` is called
- THEN: `['a', 'b', 'c']` is returned (deduplicated, sorted)
**Why This Matters**: Users need a complete inventory of stored keys regardless of which backend holds each one.

#### R3.8 — Has Throws on Non-NOT_FOUND Errors
**Full Text**: When `has(key)` is called and the key does not exist, SecureStore shall return `false`. When `has(key)` is called and an error other than not-found occurs (unavailable, locked, denied, corrupt), SecureStore shall throw with the appropriate error taxonomy code.
**Behavior**:
- GIVEN: A key `'mykey'` that does not exist
- WHEN: `has('mykey')` is called
- THEN: `false` is returned
- AND GIVEN: A keyring error of type LOCKED occurs during `has('mykey')`
- THEN: A `SecureStoreError` is thrown with code `LOCKED`
**Why This Matters**: Distinguishes "not found" (safe) from real errors (need user action) — prevents silent failures.

### R4: Encrypted File Fallback

#### R4.1 — Fallback When Keyring Unavailable (Allow Policy)
**Full Text**: While the OS keyring is unavailable and `fallbackPolicy` is `'allow'` (the default), SecureStore shall store and retrieve values using AES-256-GCM encrypted files in the configured `fallbackDir`.
**Behavior**:
- GIVEN: A SecureStore where the keyring is unavailable and `fallbackPolicy` is `'allow'`
- WHEN: `set('key', 'value')` or `get('key')` is called
- THEN: Values are stored/retrieved as AES-256-GCM encrypted files in `fallbackDir`
**Why This Matters**: Ensures the tool remains functional on systems without keyring support (CI, containers).

#### R4.2 — Fallback Denied Policy
**Full Text**: While the OS keyring is unavailable and `fallbackPolicy` is `'deny'`, SecureStore shall throw an error with taxonomy code `UNAVAILABLE` and actionable remediation message. It shall not fall back to encrypted files.
**Behavior**:
- GIVEN: A SecureStore where the keyring is unavailable and `fallbackPolicy` is `'deny'`
- WHEN: `set('key', 'value')` is called
- THEN: A `SecureStoreError` is thrown with code `UNAVAILABLE` and remediation text
**Why This Matters**: Security-conscious users can enforce keyring-only storage, preventing unintended file-based fallback.

#### R4.3 — Async Scrypt Key Derivation
**Full Text**: SecureStore shall use async `scrypt` (not `scryptSync`) for key derivation with parameters N=16384, r=8, p=1. The key derivation input shall include a machine-specific identifier (hostname + username hash).
**Behavior**:
- GIVEN: A fallback file write operation
- WHEN: The encryption key is derived
- THEN: Async `scrypt` is used with N=16384, r=8, p=1 and a machine-specific salt input (hostname + username hash)
**Why This Matters**: Async scrypt avoids blocking the event loop; machine-specific input prevents fallback file portability (intentional security measure).

#### R4.4 — One File Per Key
**Full Text**: SecureStore shall store each key as a separate encrypted file named `{key}.enc` in the `fallbackDir`.
**Behavior**:
- GIVEN: A fallback file write for key `'mykey'`
- WHEN: The write completes
- THEN: The file is stored at `{fallbackDir}/mykey.enc`
**Why This Matters**: Per-key files enable independent CRUD operations without parsing/rewriting a monolithic store file.

#### R4.5 — Versioned Envelope Format
**Full Text**: All encrypted fallback files shall use a versioned envelope format: `{"v":1, "crypto":{"alg":"aes-256-gcm","kdf":"scrypt","N":16384,"r":8,"p":1,"saltLen":16}, "data":"<base64 ciphertext>"}`
**Behavior**:
- GIVEN: A fallback file is written
- WHEN: The file content is read as JSON
- THEN: It matches the schema `{"v":1, "crypto":{...}, "data":"<base64>"}` with correct algorithm and KDF parameters
**Why This Matters**: Versioned envelope enables future format upgrades without breaking existing stored secrets.

#### R4.6 — Unrecognized Envelope Version
**Full Text**: If SecureStore reads a fallback file with an unrecognized envelope version, it shall emit a clear error with upgrade instructions rather than attempting to parse the data or silently returning null.
**Behavior**:
- GIVEN: A fallback file with `{"v":99, ...}`
- WHEN: `get(key)` reads this file
- THEN: A `SecureStoreError` is thrown with code `CORRUPT` and a message including upgrade instructions
**Why This Matters**: Prevents silent data corruption when a newer version's files are read by older code.

#### R4.7 — Atomic Write
**Full Text**: SecureStore shall write fallback files atomically: write to a temporary file in the same directory, `fsync` the file descriptor, `rename` to the final path, and set permissions to `0o600`.
**Behavior**:
- GIVEN: A fallback file write operation
- WHEN: The write completes
- THEN: The sequence was: write temp file → `fsync` fd → `rename` to final path → `chmod 0o600`
**Why This Matters**: Atomic write prevents partial/corrupt files on crash, power loss, or concurrent access.

#### R4.8 — Fallback Directory Creation
**Full Text**: SecureStore shall create the `fallbackDir` with permissions `0o700` if it does not exist.
**Behavior**:
- GIVEN: `fallbackDir` does not exist
- WHEN: A fallback file write is attempted
- THEN: `fallbackDir` is created with permissions `0o700`
**Why This Matters**: Secure default permissions prevent other users on the system from reading stored secrets.

### R5: No Backward Compatibility

#### R5.1 — Own Format Only
**Full Text**: SecureStore shall use its own envelope format exclusively. It shall not read, parse, or attempt to migrate encrypted files created by previous implementations (ToolKeyStorage `.key` files, FileTokenStorage `mcp-oauth-tokens-v2.json`). There are no migration shims, no legacy format readers, and no backward compatibility adapters.
**Behavior**:
- GIVEN: A file in legacy ToolKeyStorage `.key` format exists in the fallback directory
- WHEN: SecureStore attempts to read it
- THEN: The file is treated as corrupt (not parsed as legacy format)
**Why This Matters**: Clean break from legacy formats eliminates complex migration code and reduces attack surface.

#### R5.2 — Corrupt on Unrecognized Format
**Full Text**: If SecureStore encounters a fallback file that does not match the expected versioned envelope format, it shall treat the file as corrupt (taxonomy code `CORRUPT`) and shall not attempt legacy format detection or migration.
**Behavior**:
- GIVEN: A fallback file containing non-envelope data (e.g., plain text, old `.key` format)
- WHEN: SecureStore reads it
- THEN: A `SecureStoreError` with code `CORRUPT` is thrown; no legacy detection is attempted
**Why This Matters**: Treating unknown formats as corrupt is fail-safe — prevents misinterpretation of data.

### R6: Error Taxonomy

#### R6.1 — Error Code Mapping
**Full Text**: SecureStore shall map all errors to the following taxonomy codes and include the corresponding remediation text in user-facing messages: `UNAVAILABLE` (Keyring backend not present), `LOCKED` (Keyring present but locked), `DENIED` (Permission denied), `CORRUPT` (Stored data failed validation), `TIMEOUT` (Operation timed out), `NOT_FOUND` (Key does not exist).
**Behavior**:
- GIVEN: An error occurs during any SecureStore operation
- WHEN: The error is thrown or propagated
- THEN: It is a `SecureStoreError` with a `code` from `{UNAVAILABLE, LOCKED, DENIED, CORRUPT, TIMEOUT, NOT_FOUND}` and a `remediation` string with user-actionable guidance
**Why This Matters**: Actionable error messages reduce user frustration and support-ticket burden.

### R7B: Resilience

#### R7B.1 — Mid-Session Keyring Failure
**Full Text**: When the OS keyring becomes unavailable mid-session (e.g., daemon restart, keyring locked after startup) and `fallbackPolicy` is `'allow'`, SecureStore shall fall back to encrypted files for subsequent operations rather than crashing.
**Behavior**:
- GIVEN: A SecureStore whose keyring was initially available but has become unavailable mid-session
- WHEN: `set('key', 'value')` is called
- THEN: The value is stored in the encrypted fallback file instead of crashing
**Why This Matters**: Long-running CLI sessions must survive transient keyring failures gracefully.

#### R7B.2 — Interrupted Write Safety
**Full Text**: If a fallback file write is interrupted (process kill, disk full), SecureStore's atomic write contract (R4.7) shall prevent partial or corrupt files from being left in the `fallbackDir`. A concurrent reader shall see either the old complete value or the new complete value, never a partial write.
**Behavior**:
- GIVEN: A fallback file write is in progress
- WHEN: The process is killed or disk becomes full before rename
- THEN: No partial or corrupt `.enc` file is left (only the temp file may remain); concurrent readers see the old complete value
**Why This Matters**: Crash safety prevents data corruption that would require manual intervention to fix.

#### R7B.3 — Concurrent Writer Safety
**Full Text**: If two processes write to the same fallback file concurrently, SecureStore's atomic rename shall ensure no data is lost — one write wins, and neither produces a corrupt file.
**Behavior**:
- GIVEN: Two processes writing to the same fallback file simultaneously
- WHEN: Both complete their write operations
- THEN: The final file contains one complete value (last rename wins); no corrupt or partial data
**Why This Matters**: Multi-process CLI usage (e.g., parallel terminal sessions) must not corrupt stored secrets.

### R8: Observability

#### R8.1 — Structured Debug Logs
**Full Text**: All SecureStore operations shall emit structured debug logs including: operation type (keyring read/write/delete, fallback used, probe result), key identifiers (hashed for privacy in debug logs), timing information, failure reasons, fallback triggers, and error taxonomy code.
**Behavior**:
- GIVEN: A SecureStore operation (e.g., `set`, `get`, `delete`) is executed
- WHEN: Debug logging is enabled
- THEN: A structured log entry is emitted containing operation type, hashed key identifier, timing, and outcome (success/failure with taxonomy code)
**Why This Matters**: Debug logs are essential for diagnosing keyring issues in production without exposing secret values.

#### R8.2 — No Secret Logging
**Full Text**: If any code path within SecureStore or its consumers logs a secret value (API key, token, password) at any log level, this is a defect. SecureStore and its consumers shall not emit secret values to any log output. Masked key previews (via `maskKeyForDisplay`) are acceptable in user-facing output only, never in log files.
**Behavior**:
- GIVEN: Any SecureStore operation handling secret values
- WHEN: Log output is emitted at any level
- THEN: No secret values (API keys, tokens, passwords) appear in the log; only hashed key identifiers or masked previews are acceptable
**Why This Matters**: Secret leakage in logs is a security vulnerability — logs are often stored in plaintext and shared for debugging.

## Implementation Tasks

### Files to Modify

- `packages/core/src/storage/secure-store.ts` — UPDATE existing stub (do NOT create new file)
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P06`
  - MUST include: `@requirement` for each method
  - MUST include: `@pseudocode lines X-Y` references

### MANDATORY: Follow Pseudocode Line-by-Line

Implementation MUST reference pseudocode from `analysis/pseudocode/secure-store.md`:

#### SecureStoreError (pseudocode lines 7–16)
- Line 7: Class extending Error
- Line 8: code property with taxonomy type
- Line 9: remediation property
- Lines 10–15: Constructor implementation

#### Constructor (pseudocode lines 17–33)
- Line 28: Validate serviceName
- Line 29: Set serviceName
- Line 30: Set fallbackDir with default
- Line 31: Set fallbackPolicy with default
- Line 32: Set keytarLoader with default

#### getKeytar() (pseudocode lines 34–48)
- Line 35: Check keytarLoadAttempted flag
- Line 38: Set flag before attempting load
- Line 40: AWAIT keytarLoader() — MUST be injected, not hardcoded
- Line 41–46: Store result, handle errors

#### defaultKeytarLoader() (pseudocode lines 49–81)
- Line 51: Dynamic import of @napi-rs/keyring
- Line 52: Handle default export pattern
- Lines 54–69: Create adapter with all four methods
- Lines 72–79: Detect module-not-found errors

#### isKeychainAvailable() (pseudocode lines 82–116)
- Lines 84–89: Check cache with TTL
- Lines 92–96: Get adapter, return false if null
- Lines 98–99: Generate random test account
- Lines 101–103: Set-get-delete probe cycle
- Lines 108–113: Handle transient errors (cache invalidation)

#### set() (pseudocode lines 117–148)
- Lines 118–119: Validate inputs
- Lines 122–134: Try keyring, fall through on failure
- Lines 137–143: Check fallback policy, throw UNAVAILABLE if denied
- Line 146: Write fallback file

#### get() (pseudocode lines 149–178)
- Lines 154–166: Try keyring first
- Lines 169–173: Try fallback file
- Lines 175–177: Return null if not found anywhere

#### delete() (pseudocode lines 179–210)
- Lines 187–194: Delete from keyring
- Lines 197–205: Delete fallback file
- Line 207: Return OR of both deletions

#### list() (pseudocode lines 211–247)
- Lines 217–229: Enumerate from keyring via findCredentials
- Lines 232–244: Scan fallback directory for .enc files
- Line 246: Return sorted array

#### has() (pseudocode lines 248–276)
- Lines 252–266: Check keyring, rethrow non-NOT_FOUND errors
- Lines 269–275: Check fallback file existence

#### writeFallbackFile() (pseudocode lines 277–316)
- Line 279: Ensure directory exists with 0o700
- Lines 282–285: Derive key with async scrypt (NOT scryptSync)
- Lines 288–291: AES-256-GCM encryption
- Lines 294–299: Build versioned envelope
- Lines 302–315: Atomic write (temp → fsync → rename → chmod)

#### readFallbackFile() (pseudocode lines 317–383)
- Lines 320–327: Read file, return null on ENOENT
- Lines 330–339: Parse JSON, throw CORRUPT on failure
- Lines 342–348: Check envelope version
- Lines 351–357: Validate envelope structure
- Lines 360–382: Decrypt with same KDF params

#### Helper Functions (pseudocode lines 384–441)
- Lines 384–386: getFallbackFilePath
- Lines 388–391: hashForLog
- Lines 393–410: classifyError, isTransientError
- Lines 412–420: isValidEnvelope
- Lines 422–431: getRemediation
- Lines 433–440: scryptAsync (promisified)

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P06
 * @requirement R3.1a
 * @pseudocode lines 117-148
 */
async set(key: string, value: string): Promise<void> {
  // Implementation following pseudocode...
}
```

## Verification Commands

### Automated Checks

```bash
# 1. All tests pass
npm test -- packages/core/src/storage/secure-store.test.ts
# Expected: ALL PASS

# 2. No test modifications
git diff packages/core/src/storage/secure-store.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}"
# Expected: no changes to test file

# 3. Plan markers
grep -c "@plan.*SECURESTORE.P06" packages/core/src/storage/secure-store.ts
# Expected: 5+

# 4. Pseudocode references
grep -c "@pseudocode" packages/core/src/storage/secure-store.ts
# Expected: 5+

# 5. No debug code
grep -n "console\.\|TODO\|FIXME\|XXX" packages/core/src/storage/secure-store.ts
# Expected: no matches (debug logging via proper log system is OK)

# 6. TypeScript compiles
npm run typecheck

# 7. No duplicate files
find packages/core/src -name "*SecureStoreV2*" -o -name "*SecureStoreCopy*"
# Expected: no matches

# 8. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/storage/secure-store.ts | grep -v ".test.ts"
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/storage/secure-store.ts | grep -v ".test.ts" | grep -v "readFallbackFile"
# Expected: no matches (except legitimate null returns in get/readFallbackFile)
```

### Pseudocode Compliance Check

```bash
# Verify pseudocode was followed (the verifier MUST read both files and compare):
# 1. Open analysis/pseudocode/secure-store.md
# 2. Open packages/core/src/storage/secure-store.ts
# 3. Verify every numbered pseudocode line has a corresponding implementation
# 4. Verify algorithm matches (no shortcuts)
# 5. Verify error handling matches
# 6. Report deviations
```

## Structural Verification Checklist

- [ ] All 25+ tests pass
- [ ] No test modifications
- [ ] Plan markers present
- [ ] Pseudocode line references present
- [ ] TypeScript compiles
- [ ] No debug code
- [ ] No duplicate files

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/storage/secure-store.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/storage/secure-store.ts
grep -rn -E "return \[\]$|return \{\}$|return null$|return undefined$" packages/core/src/storage/secure-store.ts
# Expected: No matches in implementation code
```

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions

1. **Does SecureStore actually encrypt data?**
   - [ ] Read the writeFallbackFile method
   - [ ] Verify AES-256-GCM is used with random IV
   - [ ] Verify async scrypt is used (not scryptSync)
   - [ ] Verify envelope format matches R4.5

2. **Does atomic write actually work?**
   - [ ] Read the atomic write code
   - [ ] Verify temp file → fsync → rename → chmod sequence
   - [ ] Verify cleanup on failure

3. **Does probe caching work?**
   - [ ] Read isKeychainAvailable
   - [ ] Verify 60-second TTL
   - [ ] Verify transient error invalidation

4. **Does keyring-over-fallback precedence work?**
   - [ ] Read get() method
   - [ ] Verify keyring is checked first
   - [ ] Verify fallback only used when keyring fails/unavailable

5. **Is the feature REACHABLE?**
   - [ ] SecureStore is exported from the file
   - [ ] Other code can import and use it
   - [ ] Constructor is accessible

## Holistic Functionality Assessment

### What was implemented?
[Describe the implementation in your own words]

### Does it satisfy the requirements?
[For each R1-R8 group, explain how]

### What is the data flow?
[Trace: set('key','value') → keyring or fallback → get('key') → return value]

### What could go wrong?
[Identify edge cases not covered by tests]

### Verdict
[PASS/FAIL]

## Success Criteria

- All tests pass without modification
- Pseudocode compliance verified
- No deferred implementation patterns
- TypeScript compiles cleanly
- Real encryption with proper envelope format

## Failure Recovery

1. `git checkout -- packages/core/src/storage/secure-store.ts`
2. Do NOT revert test file
3. Re-run Phase 06

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P06.md`
Contents:
```markdown
Phase: P06
Completed: [timestamp]
Files Modified: packages/core/src/storage/secure-store.ts [line count, diff stats]
Tests Passing: [count]
Pseudocode Compliance: [assessment]
Verification: [paste outputs]
```

=== PHASE: 06a-securestore-impl-verification.md ===
# Phase 06a: SecureStore Implementation Verification

## Phase ID

`PLAN-20260211-SECURESTORE.P06a`

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -r "@plan.*SECURESTORE.P06" packages/core/src/storage/secure-store.ts`
- Expected: All P05 tests pass

## Verification Commands

```bash
# 1. All tests pass
npm test -- packages/core/src/storage/secure-store.test.ts
# Expected: ALL PASS

# 2. No test modifications
git diff --stat packages/core/src/storage/secure-store.test.ts
# Expected: 0 files changed (or minimal test infrastructure changes)

# 3. Plan markers
grep -c "@plan.*SECURESTORE.P06" packages/core/src/storage/secure-store.ts
# Expected: 5+

# 4. Pseudocode references
grep -c "@pseudocode" packages/core/src/storage/secure-store.ts
# Expected: 5+

# 5. TypeScript compiles
npm run typecheck

# 6. Full test suite still passes
npm test

# 7. Deferred implementation detection
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/storage/secure-store.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/storage/secure-store.ts
# Expected: No matches

# 8. Lint passes
npm run lint

# 9. Format passes
npm run format
```

## Structural Verification Checklist

- [ ] All P05 tests pass
- [ ] Tests not modified
- [ ] Plan markers present
- [ ] Pseudocode references present
- [ ] TypeScript compiles
- [ ] Full test suite passes
- [ ] No deferred implementation patterns
- [ ] Lint passes

## Semantic Verification Checklist (MANDATORY)

### Pseudocode Compliance Audit

The verifier MUST open both files side-by-side and verify:

| Pseudocode Section | Lines | Implemented? | Deviations |
|-------------------|-------|-------------|------------|
| SecureStoreError | 7–16 | [ ] | |
| Constructor | 17–33 | [ ] | |
| getKeytar | 34–48 | [ ] | |
| defaultKeytarLoader | 49–81 | [ ] | |
| isKeychainAvailable | 82–116 | [ ] | |
| set | 117–148 | [ ] | |
| get | 149–178 | [ ] | |
| delete | 179–210 | [ ] | |
| list | 211–247 | [ ] | |
| has | 248–276 | [ ] | |
| writeFallbackFile | 277–316 | [ ] | |
| readFallbackFile | 317–383 | [ ] | |
| Helper functions | 384–441 | [ ] | |

### Feature Actually Works

```bash
# Create a test script to verify end-to-end:
node -e "
const { SecureStore } = require('./packages/core/dist/storage/secure-store');
// This should work after build
console.log('SecureStore class loaded successfully');
"
```

### Integration Points Verified

- [ ] SecureStore is importable from packages/core/src/storage/secure-store.ts
- [ ] Constructor accepts serviceName and SecureStoreOptions
- [ ] keytarLoader injection works (verified by tests)
- [ ] Fallback directory creation works (verified by tests)
- [ ] Error taxonomy codes match R6.1

### Lifecycle Verified

- [ ] Keytar loaded lazily on first use
- [ ] Probe cached and TTL works
- [ ] Async operations properly awaited
- [ ] Temp files cleaned up on failure

### Edge Cases Verified

- [ ] Empty key name rejected
- [ ] Corrupt fallback file handled
- [ ] Missing fallback directory created
- [ ] Keyring unavailable → fallback path works
- [ ] Keyring available → keyring path works

## Holistic Functionality Assessment

### What was implemented?
[Describe what the SecureStore actually does — not markers, but observed behavior]

### Does it satisfy the requirements?
[For R1-R8, explain HOW each is fulfilled with specific code references]

### What is the data flow?
[Trace one complete path: set → encrypt → write file → get → read file → decrypt → return]

### What could go wrong?
[List risks for subsequent phases]

### Verdict
[PASS/FAIL with explanation]

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P06a.md`

=== PHASE: 07-wrapper-contract-tests.md ===
# Phase 07: Thin Wrapper Contract Tests

## Phase ID

`PLAN-20260211-SECURESTORE.P07`

## Prerequisites

- Required: Phase 06a completed
- Verification: `ls .completed/P06a.md`
- Expected files: `packages/core/src/storage/secure-store.ts` (implemented)

## Requirements Implemented (Expanded)

### R7.6: Contract Tests for Thin Wrappers

**Full Text**: Each surviving refactored thin wrapper (ToolKeyStorage, KeychainTokenStorage, ExtensionSettingsStorage) shall pass contract tests proving identical observable behavior to the original implementation.
**Behavior**:
- GIVEN: Existing test suites for ToolKeyStorage and KeychainTokenStorage
- WHEN: The wrappers are refactored to use SecureStore
- THEN: All existing tests continue to pass, proving behavioral equivalence
**Why This Matters**: Refactoring must not break existing consumers.

### R7A.1: Behavioral Delta Audit (continued from P02)

**Full Text**: Intentional behavioral differences shall be preserved in the thin wrappers.
**Behavior**:
- GIVEN: Documented behavioral differences from P02 analysis
- WHEN: Contract tests are written
- THEN: Tests verify that intentional differences are preserved

### R7C.1: Legacy Data Startup Messaging

**Full Text**: When SecureStore detects an unreadable fallback file at a path previously used by a legacy implementation, it shall emit a user-facing message with actionable remediation.
**Behavior**:
- GIVEN: A legacy .key file exists in the ToolKeyStorage directory
- WHEN: SecureStore tries to read it
- THEN: CORRUPT error with remediation message is thrown

## Implementation Tasks

### Contract Test Strategy

The existing test suites serve as contract tests. This phase adds:

1. **Integration tests** that verify ToolKeyStorage → SecureStore wiring
2. **Integration tests** that verify KeychainTokenStorage → SecureStore wiring
3. **Integration tests** that verify ExtensionSettingsStorage → SecureStore wiring
4. **Legacy format detection tests** for R7C.1

### Files to Create

- `packages/core/src/storage/secure-store-integration.test.ts` — Integration tests
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P07`
  - Tests that verify SecureStore works correctly when used by thin wrappers
  - Tests for legacy format file detection

### Files to Verify (NOT modify)

- `packages/core/src/tools/tool-key-storage.test.ts` — Must continue passing post-refactoring
- `packages/core/src/mcp/token-storage/keychain-token-storage.test.ts` (if exists) — Must continue passing

### Required Tests

#### ToolKeyStorage Contract Tests
1. saveKey stores and retrieves via SecureStore backend
2. getKey retrieves from SecureStore
3. deleteKey removes from SecureStore
4. hasKey delegates to SecureStore
5. resolveKey chain works with SecureStore backend
6. Registry validation still enforced
7. Keyfile operations unchanged

#### KeychainTokenStorage Contract Tests
8. setCredentials stores JSON-serialized credentials via SecureStore
9. getCredentials retrieves and deserializes from SecureStore
10. sanitizeServerName still applied
11. validateCredentials still enforced
12. listServers works via SecureStore.list()

#### ExtensionSettingsStorage Contract Tests
13. Sensitive settings stored via SecureStore
14. Non-sensitive settings still use .env files
15. Service name formatting preserved

#### Legacy Format Detection (R7C.1)
16. Old ToolKeyStorage .key format file → CORRUPT error with remediation
17. Old FileTokenStorage format → CORRUPT error with remediation

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P07
 * @requirement R7.6
 */
```

## Verification Commands

```bash
# 1. Integration test file created
ls packages/core/src/storage/secure-store-integration.test.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P07" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 3+

# 3. Test count
grep -c "it(" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 15+

# 4. Existing test suites still pass
npm test -- packages/core/src/tools/tool-key-storage.test.ts
# Expected: ALL PASS (existing tests unchanged)

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/storage/secure-store-integration.test.ts
# Expected: 0
```

## Structural Verification Checklist

- [ ] Integration test file created
- [ ] 15+ contract tests
- [ ] Existing tool-key-storage tests unchanged and passing
- [ ] Plan markers present
- [ ] No mock theater

## Semantic Verification Checklist (MANDATORY)

1. **Do contract tests verify observable behavior?**
   - [ ] Tests check actual stored/retrieved values
   - [ ] Tests verify error messages match current behavior
   - [ ] Tests verify data format compatibility

2. **Are intentional behavioral differences preserved?**
   - [ ] ToolKeyStorage serialization (raw strings)
   - [ ] KeychainTokenStorage serialization (JSON)
   - [ ] ExtensionSettingsStorage no-fallback behavior

## Failure Recovery

1. `git checkout -- packages/core/src/storage/secure-store-integration.test.ts`
2. Re-run Phase 07

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P07.md`

=== PHASE: 09-eliminate-legacy.md ===
# Phase 09: Eliminate FileTokenStorage + HybridTokenStorage

## Phase ID

`PLAN-20260211-SECURESTORE.P09`

## Prerequisites

- Required: Phase 08a completed
- Verification: `ls .completed/P08a.md`
- Expected: All wrappers refactored and tests passing

## Requirements Implemented (Expanded)

### R7.3: FileTokenStorage Eliminated

**Full Text**: FileTokenStorage shall be eliminated. Its encrypted-file role is absorbed by SecureStore's fallback path. Tests for FileTokenStorage shall be deleted.
**Behavior**:
- GIVEN: FileTokenStorage code exists
- WHEN: This phase completes
- THEN: The file is deleted along with its tests
- AND: No imports reference it

### R7.4: HybridTokenStorage Eliminated

**Full Text**: HybridTokenStorage shall be eliminated. SecureStore handles the keyring-to-fallback orchestration internally. Tests for HybridTokenStorage shall be deleted. Consumers (`OAuthTokenStorage`, `OAuthCredentialStorage`) shall be updated.
**Behavior**:
- GIVEN: HybridTokenStorage mediates between keychain and file storage
- WHEN: This phase completes
- THEN: Consumers use KeychainTokenStorage directly (which uses SecureStore)
- AND: HybridTokenStorage file and tests are deleted

### R7.7: No Duplicate Keyring Imports (verification)

**Full Text**: After refactoring, no duplicate @napi-rs/keyring import/wrapping code shall remain outside of SecureStore.

## Implementation Tasks

### Pre-Elimination Caller Inventory (MANDATORY — complete before any deletion)

Before deleting any files, the implementer MUST perform a full codebase grep to build
a verified inventory of every file that imports the modules being removed:

```bash
# 1. Find all imports of FileTokenStorage
grep -rn "FileTokenStorage\|file-token-storage" packages/ --include="*.ts" | grep -v node_modules | grep -v ".test."

# 2. Find all imports of HybridTokenStorage
grep -rn "HybridTokenStorage\|hybrid-token-storage" packages/ --include="*.ts" | grep -v node_modules | grep -v ".test."
```

**Document every file found** and verify that each has already been updated to use
`SecureStore` or `KeychainTokenStorage` in Phase 08. If ANY caller still imports
`FileTokenStorage` or `HybridTokenStorage` and has NOT been migrated, STOP and
complete the migration before proceeding with deletion.

The inventory must be recorded as a comment in the P09 completion marker file
(`.completed/P09.md`) so reviewers can verify it was done.

### Files to Delete

- `packages/core/src/mcp/token-storage/file-token-storage.ts` — DELETE entire file
- `packages/core/src/mcp/token-storage/hybrid-token-storage.ts` — DELETE entire file
- Associated test files for FileTokenStorage and HybridTokenStorage — DELETE

### Files to Modify

#### `packages/core/src/mcp/oauth-token-storage.ts`
- Line 27 (approx): Change `new HybridTokenStorage(...)` → `new KeychainTokenStorage(...)`
- Remove HybridTokenStorage import
- ADD: `@plan:PLAN-20260211-SECURESTORE.P09`

#### `packages/core/src/code_assist/oauth-credential-storage.ts`
- Line 30 (approx): Same change — use KeychainTokenStorage directly
- Remove HybridTokenStorage import
- ADD: `@plan:PLAN-20260211-SECURESTORE.P09`

#### Barrel exports (if applicable)
- Remove FileTokenStorage and HybridTokenStorage exports

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P09
 * @requirement R7.3, R7.4
 */
```

## Verification Commands

```bash
# 1. Deleted files are gone
ls packages/core/src/mcp/token-storage/file-token-storage.ts 2>&1
# Expected: No such file

ls packages/core/src/mcp/token-storage/hybrid-token-storage.ts 2>&1
# Expected: No such file

# 2. No remaining imports
grep -rn "FileTokenStorage\|file-token-storage" packages/core/src packages/cli/src --include="*.ts" | grep -v "node_modules"
# Expected: 0 matches

grep -rn "HybridTokenStorage\|hybrid-token-storage" packages/core/src packages/cli/src --include="*.ts" | grep -v "node_modules"
# Expected: 0 matches

# 3. Consumers updated
grep "KeychainTokenStorage" packages/core/src/mcp/oauth-token-storage.ts
# Expected: found

grep "KeychainTokenStorage" packages/core/src/code_assist/oauth-credential-storage.ts
# Expected: found

# 4. TypeScript compiles
npm run typecheck

# 5. ALL tests pass
npm test

# 6. No duplicate keyring code (R7.7 final check)
grep -rn "@napi-rs/keyring\|scryptSync\|deriveEncryptionKey" packages/core/src packages/cli/src --include="*.ts" | grep -v "secure-store" | grep -v ".test." | grep -v "node_modules"
# Expected: 0 matches

# 7. Plan markers
grep -r "@plan.*SECURESTORE.P09" packages/core/src --include="*.ts"
# Expected: 2+ (one per modified consumer)
```

## Structural Verification Checklist

- [ ] FileTokenStorage file deleted
- [ ] HybridTokenStorage file deleted
- [ ] Associated test files deleted
- [ ] OAuthTokenStorage uses KeychainTokenStorage directly
- [ ] OAuthCredentialStorage uses KeychainTokenStorage directly
- [ ] No remaining imports of deleted files
- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] No duplicate keyring code (R7.7)

## Semantic Verification Checklist (MANDATORY)

1. **Do consumers still work?**
   - [ ] OAuthTokenStorage still stores/retrieves credentials
   - [ ] OAuthCredentialStorage still stores/retrieves credentials
   - [ ] The fallback path now works via SecureStore (not HybridTokenStorage)

2. **Is there any orphaned code?**
   - [ ] No references to deleted files
   - [ ] No dead imports
   - [ ] No unused test utilities

## Failure Recovery

1. `git checkout -- packages/core/src/mcp/token-storage/`
2. `git checkout -- packages/core/src/mcp/oauth-token-storage.ts`
3. `git checkout -- packages/core/src/code_assist/oauth-credential-storage.ts`
4. Re-run Phase 09

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P09.md`

=== PHASE: 10-provider-key-storage-stub.md ===
# Phase 10: ProviderKeyStorage Stub

## Phase ID

`PLAN-20260211-SECURESTORE.P10`

## Prerequisites

- Required: Phase 09a completed
- Verification: `ls .completed/P09a.md`
- Expected: SecureStore implemented, wrappers refactored, legacy eliminated

## Requirements Implemented (Expanded)

### R9.1: ProviderKeyStorage Backed by SecureStore

**Full Text**: ProviderKeyStorage shall be backed by a SecureStore instance with service name `llxprt-code-provider-keys` and fallback directory `~/.llxprt/provider-keys/` with fallback policy `'allow'`.
**Behavior (stub)**: Class constructor creates SecureStore instance with correct config.

### R10.1: Key Name Validation

**Full Text**: ProviderKeyStorage shall validate key names against the regex `^[a-zA-Z0-9._-]{1,64}$`.
**Behavior (stub)**: Validation function exists with correct regex.

## Implementation Tasks

### Files to Create

- `packages/core/src/storage/provider-key-storage.ts` — ProviderKeyStorage class stub
  - MUST include: `@plan:PLAN-20260211-SECURESTORE.P10`
  - MUST include: `@requirement:R9.1, R10.1`
  - Class: `ProviderKeyStorage`
  - Functions: `validateKeyName`, `getProviderKeyStorage`, `resetProviderKeyStorage`
  - Constants: `KEY_NAME_REGEX`, `SERVICE_NAME`, `FALLBACK_DIR`
  - Methods: `saveKey`, `getKey`, `deleteKey`, `listKeys`, `hasKey` — all throw NotYetImplemented
  - Maximum ~60 lines

### Stub Structure

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P10
 * @requirement R9.1
 */
export class ProviderKeyStorage {
  private readonly secureStore: SecureStore;

  constructor(options?: { secureStore?: SecureStore }) {
    this.secureStore = options?.secureStore ?? new SecureStore(SERVICE_NAME, {
      fallbackDir: FALLBACK_DIR,
      fallbackPolicy: 'allow',
    });
  }

  async saveKey(name: string, apiKey: string): Promise<void> {
    throw new Error('NotYetImplemented');
  }
  // ... etc
}
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-SECURESTORE.P10
 * @requirement R9.1
 */
```

## Verification Commands

```bash
# 1. File created
ls packages/core/src/storage/provider-key-storage.ts

# 2. Plan markers
grep -c "@plan.*SECURESTORE.P10" packages/core/src/storage/provider-key-storage.ts
# Expected: 2+

# 3. TypeScript compiles
npm run typecheck

# 4. Class exported
grep "export class ProviderKeyStorage" packages/core/src/storage/provider-key-storage.ts

# 5. All methods present
for method in "saveKey" "getKey" "deleteKey" "listKeys" "hasKey"; do
  grep -q "$method" packages/core/src/storage/provider-key-storage.ts && echo "OK: $method" || echo "MISSING: $method"
done

# 6. Key name validation present
grep "KEY_NAME_REGEX\|validateKeyName" packages/core/src/storage/provider-key-storage.ts

# 7. Singleton present
grep "getProviderKeyStorage" packages/core/src/storage/provider-key-storage.ts

# 8. No TODO comments
grep "TODO" packages/core/src/storage/provider-key-storage.ts
```

## Structural Verification Checklist

- [ ] File created at correct path
- [ ] ProviderKeyStorage class exported
- [ ] All 5 public methods present
- [ ] Constructor creates SecureStore with correct config
- [ ] Key name validation function present
- [ ] Singleton function present
- [ ] TypeScript compiles
- [ ] No TODO comments

## Semantic Verification Checklist (MANDATORY)

1. **Does the stub have the correct API surface?**
   - [ ] `ProviderKeyStorage` class exported with correct constructor signature (`options?: { secureStore?: SecureStore }`)
   - [ ] All five public methods present: `saveKey(name, apiKey)`, `getKey(name)`, `deleteKey(name)`, `listKeys()`, `hasKey(name)`
   - [ ] Constructor accepts optional `SecureStore` injection for testing
   - [ ] Singleton functions exported: `getProviderKeyStorage()`, `resetProviderKeyStorage()`
   - [ ] `KEY_NAME_REGEX` constant exported with pattern `^[a-zA-Z0-9._-]{1,64}$`
   - [ ] `validateKeyName()` function exported

2. **Is this a valid stub (not empty shell)?**
   - [ ] All five CRUD methods throw `NotYetImplemented` (not return `undefined` silently)
   - [ ] `validateKeyName()` has real regex validation (not a stub — this is needed for TDD tests)
   - [ ] TypeScript strict mode satisfied (correct return types, no `any` escapes)
   - [ ] Constructor creates `SecureStore` with service name `'llxprt-code-provider-keys'`, fallback dir `~/.llxprt/provider-keys/`, policy `'allow'`

3. **Would TDD tests be writable against this stub?**
   - [ ] Tests can import `ProviderKeyStorage`, `getProviderKeyStorage`, `resetProviderKeyStorage`, `validateKeyName`
   - [ ] Tests can construct with custom `SecureStore` injection
   - [ ] Tests would fail with `NotYetImplemented` (not compile error)
   - [ ] `getProviderKeyStorage()` returns the same instance on repeated calls
   - [ ] `resetProviderKeyStorage()` clears the singleton so tests get fresh instances

## Failure Recovery

1. `git checkout -- packages/core/src/storage/provider-key-storage.ts`
2. Re-run Phase 10

## Phase Completion Marker

Create: `project-plans/issue1350_1353_1355_1356/.completed/P10.md`

=== PHASE: 11-provider-key-storage-tdd.md ===
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

=== PHASE: 12-provider-key-storage-impl.md ===
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
