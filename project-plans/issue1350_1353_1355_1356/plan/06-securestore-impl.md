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
