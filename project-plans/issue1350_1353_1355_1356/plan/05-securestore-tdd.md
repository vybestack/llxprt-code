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
