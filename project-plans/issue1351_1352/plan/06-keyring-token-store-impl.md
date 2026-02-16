# Phase 06: KeyringTokenStore Implementation

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P06`

## Prerequisites

- Required: Phase 05 completed (TDD tests written, failing against stub)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P05" packages/core/src/auth/__tests__/keyring-token-store.test.ts`
- Expected files from previous phase:
  - `packages/core/src/auth/__tests__/keyring-token-store.test.ts` (40+ failing tests)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R1.1: TokenStore Interface Implementation

**Full Text**: KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.
**Behavior**:
- GIVEN: The stub class with NotYetImplemented methods
- WHEN: All methods are fully implemented
- THEN: All 40+ Phase 05 tests pass
**Why This Matters**: This is the core deliverable — a working TokenStore backed by SecureStore.

### R1.2: SecureStore Delegation

**Full Text**: KeyringTokenStore shall delegate all credential storage operations (set, get, delete, list) to a SecureStore instance configured with service name `llxprt-code-oauth` and fallback policy `allow`.
**Behavior**:
- GIVEN: A SecureStore instance (injected or default)
- WHEN: Token operations are performed
- THEN: All data flows through SecureStore.set/get/delete/list
**Why This Matters**: The thin-wrapper pattern — KeyringTokenStore must NOT implement its own storage.

### R1.3: Optional SecureStore Injection

**Full Text**: Constructor accepts optional SecureStore for testability.
**Behavior**:
- GIVEN: `new KeyringTokenStore({ secureStore: myStore })`
- WHEN: Operations are performed
- THEN: `myStore` is used (not a default instance)
**Why This Matters**: Tests inject test stores; production uses default.

### R2.1: Account Key Format

**Full Text**: Map provider+bucket to `{provider}:{bucket}`.
**Behavior**:
- GIVEN: provider='anthropic', bucket='default'
- WHEN: accountKey() is called
- THEN: Returns 'anthropic:default'
**Why This Matters**: Consistent naming enables correct list parsing.
**Pseudocode**: Lines 29-34

### R2.2: Default Bucket

**Full Text**: Omitted bucket → `'default'`.
**Behavior**:
- GIVEN: bucket is undefined
- WHEN: accountKey() resolves bucket
- THEN: Uses 'default'
**Why This Matters**: Implicit default simplifies common usage.
**Pseudocode**: Line 30

### R2.3: Name Validation

**Full Text**: Validate against `/^[a-zA-Z0-9_-]+$/`.
**Behavior**:
- GIVEN: name contains disallowed characters
- WHEN: validateName() is called
- THEN: Throws with descriptive error
**Why This Matters**: Prevents key injection and filesystem issues.
**Pseudocode**: Lines 24-28

### R2.4: Throw Before Storage

**Full Text**: Validate before any storage operation.
**Behavior**:
- GIVEN: Invalid provider name
- WHEN: saveToken is called
- THEN: Error thrown before secureStore.set() is reached
**Why This Matters**: Fail-fast prevents partial state changes.
**Pseudocode**: Lines 31-32 (called from accountKey, which is called before storage ops)

### R3.1: saveToken Serialization

**Full Text**: Validate with `OAuthTokenSchema.passthrough().parse()` and store as JSON.
**Behavior**:
- GIVEN: A valid OAuthToken
- WHEN: saveToken stores it
- THEN: SecureStore receives JSON.stringify of validated token
**Why This Matters**: Consistent serialization format.
**Pseudocode**: Lines 38-44

### R3.2: getToken Deserialization

**Full Text**: Parse with JSON.parse + OAuthTokenSchema.passthrough().parse().
**Behavior**:
- GIVEN: SecureStore contains valid JSON token
- WHEN: getToken reads it
- THEN: Returns parsed and validated OAuthToken
**Why This Matters**: Read-path validation catches corruption.
**Pseudocode**: Lines 45-77

### R3.3: Passthrough Preservation

**Full Text**: .passthrough() preserves extra fields.
**Behavior**:
- GIVEN: Token with extra fields (Codex account_id)
- WHEN: Round-tripped through save+get
- THEN: Extra fields preserved
**Why This Matters**: Data integrity for provider-specific tokens.
**Pseudocode**: Lines 40, 71

### R4.1: Corrupt JSON Handling

**Full Text**: Failed JSON.parse() → log warning + return null.
**Behavior**:
- GIVEN: Non-JSON data in SecureStore
- WHEN: getToken reads it
- THEN: Returns null, warning logged with hashed ID
**Why This Matters**: Graceful degradation on corruption.
**Pseudocode**: Lines 63-68

### R4.2: Invalid Schema Handling

**Full Text**: Failed schema validation → log warning + return null.
**Behavior**:
- GIVEN: Valid JSON but wrong schema in SecureStore
- WHEN: getToken reads it
- THEN: Returns null, warning logged with hashed ID
**Why This Matters**: Schema mismatch should not crash.
**Pseudocode**: Lines 70-76

### R4.3: No Deletion

**Full Text**: Corrupt entries NOT deleted.
**Behavior**:
- GIVEN: Corrupt data detected
- WHEN: getToken returns null
- THEN: Data still exists in SecureStore
**Why This Matters**: Preserves evidence for debugging.
**Pseudocode**: No delete call in getToken (lines 45-77)

### R4.4: SHA-256 Hash in Logs

**Full Text**: Hashed identifier in warnings, not raw.
**Behavior**:
- GIVEN: Corruption detected for 'provider:bucket'
- WHEN: Warning is logged
- THEN: Log contains SHA-256(provider:bucket), not raw string
**Why This Matters**: Privacy in logs.
**Pseudocode**: Lines 35-37 (hashIdentifier method), 52, 66, 74

### R5.1: removeToken

**Full Text**: Call secureStore.delete().
**Behavior**:
- GIVEN: Token exists
- WHEN: removeToken called
- THEN: Token deleted from SecureStore
**Why This Matters**: Logout must actually remove credentials.
**Pseudocode**: Lines 78-86

### R5.2: removeToken Swallows Errors

**Full Text**: Errors caught and logged, not propagated.
**Behavior**:
- GIVEN: SecureStore.delete() throws
- WHEN: removeToken called
- THEN: Returns normally, error logged
**Why This Matters**: Best-effort cleanup semantics.
**Pseudocode**: Lines 80-85

### R6.1: listProviders

**Full Text**: Parse keys, unique providers, sorted.
**Behavior**:
- GIVEN: Multiple keys in SecureStore
- WHEN: listProviders() called
- THEN: Unique providers, sorted alphabetically
**Why This Matters**: Correct provider enumeration.
**Pseudocode**: Lines 87-102

### R6.2: listBuckets

**Full Text**: Filter by provider prefix, extract buckets, sorted.
**Behavior**:
- GIVEN: Multiple keys for same provider
- WHEN: listBuckets(provider) called
- THEN: Only that provider's buckets, sorted
**Why This Matters**: Correct bucket enumeration per provider.
**Pseudocode**: Lines 103-119

### R6.3: List Error Degradation

**Full Text**: Errors → empty array.
**Behavior**:
- GIVEN: SecureStore.list() throws
- WHEN: listProviders() or listBuckets() called
- THEN: Returns [] (no error propagation)
**Why This Matters**: Informational methods degrade gracefully.
**Pseudocode**: Lines 98-101, 115-118

### R7.1–R7.2: getBucketStats

**Full Text**: Token exists → stats object; no token → null.
**Behavior**:
- GIVEN: Token exists/doesn't exist
- WHEN: getBucketStats called
- THEN: Returns stats/null respectively
**Why This Matters**: Correct stats reporting.
**Pseudocode**: Lines 120-132

### R8.1–R8.6: Lock Acquisition

**Full Text**: File-based locks, exclusive write, stale detection, polling, timeout, corrupt handling.
**Behavior**:
- GIVEN: Various lock states (free, held, stale, corrupt)
- WHEN: acquireRefreshLock called
- THEN: Appropriate action (acquire, wait, break, timeout)
**Why This Matters**: Prevents concurrent refresh.
**Pseudocode**: Lines 144-199

### R9.1–R9.2: Lock Release

**Full Text**: Delete lock file; ENOENT ignored.
**Behavior**:
- GIVEN: Lock held / not held
- WHEN: releaseRefreshLock called
- THEN: File deleted / no error
**Why This Matters**: Idempotent release.
**Pseudocode**: Lines 200-210

### R10.1–R10.2: Lock Infrastructure

**Full Text**: Naming convention, directory creation.
**Behavior**:
- GIVEN: Lock operations requested
- WHEN: Lock path computed, directory ensured
- THEN: Correct path format, directory with 0o700
**Why This Matters**: Consistent lock file management.
**Pseudocode**: Lines 133-143

### R11.1–R11.2: saveToken Error Propagation

**Full Text**: All SecureStoreErrors propagate from saveToken.
**Behavior**:
- GIVEN: SecureStore.set() throws
- WHEN: saveToken called
- THEN: Error propagates to caller
**Why This Matters**: Login command shows actionable errors.
**Pseudocode**: Line 43 (comment: errors propagate)

### R12.1–R12.3: getToken Error Handling

**Full Text**: null → null; CORRUPT → log + null; others → propagate.
**Behavior**:
- GIVEN: Various SecureStore.get() outcomes
- WHEN: getToken called
- THEN: Correct behavior per error code
**Why This Matters**: Asymmetric error handling per code.
**Pseudocode**: Lines 48-57

### R19.1: Clear Error Messages

**Full Text**: Invalid name errors include the name and allowed characters.
**Behavior**:
- GIVEN: Invalid name provided
- WHEN: Validation fails
- THEN: Error message includes the invalid name and regex description
**Why This Matters**: Actionable error messages.
**Pseudocode**: Line 26

### R15.1: Dual-Mode Operation

**Full Text**: KeyringTokenStore shall function correctly in both keyring-available and keyring-unavailable (fallback-only) environments. SecureStore handles the fallback transparently.
**Behavior**:
- GIVEN: KeyringTokenStore delegates all storage to SecureStore
- WHEN: SecureStore is initialized (keyring available OR fallback-only)
- THEN: All KeyringTokenStore operations work identically because SecureStore handles the fallback internally — no conditional logic needed in KeyringTokenStore
**Why This Matters**: This requirement is satisfied by design — KeyringTokenStore never checks keyring availability itself; it trusts SecureStore's transparent fallback. No special implementation needed.
**Pseudocode**: N/A (satisfied by SecureStore delegation architecture)

## Implementation Tasks

### Files to Modify

- `packages/core/src/auth/keyring-token-store.ts` (UPDATE the stub — do NOT create new file)
  - Replace NotYetImplemented stubs with real implementations
  - MUST reference pseudocode line numbers from `analysis/pseudocode/keyring-token-store.md`
  - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P06`
  - Every method MUST have `@pseudocode lines X-Y` annotation

  Implementation by pseudocode reference:
  - **Constructor** (pseudocode lines 13-23): SecureStore creation, DebugLogger setup
  - **validateName** (pseudocode lines 24-28): NAME_REGEX test, descriptive error
  - **accountKey** (pseudocode lines 29-34): Resolve bucket, validate both, format
  - **hashIdentifier** (pseudocode lines 35-37): SHA-256 hash, truncate to 16 chars
  - **saveToken** (pseudocode lines 38-44): accountKey → passthrough().parse() → JSON.stringify → secureStore.set()
  - **getToken** (pseudocode lines 45-77): accountKey → secureStore.get() → null check → JSON.parse → passthrough().parse() → error handling
  - **removeToken** (pseudocode lines 78-86): accountKey → secureStore.delete() → catch+log
  - **listProviders** (pseudocode lines 87-102): secureStore.list() → parse → unique → sort → catch→[]
  - **listBuckets** (pseudocode lines 103-119): secureStore.list() → filter → extract → sort → catch→[]
  - **getBucketStats** (pseudocode lines 120-132): getToken → null check → stats object
  - **lockFilePath** (pseudocode lines 133-140): provider/bucket → path format
  - **ensureLockDir** (pseudocode lines 141-143): mkdir recursive with 0o700
  - **acquireRefreshLock** (pseudocode lines 144-199): validate → lockPath → loop: wx write → stale check → poll → timeout
  - **releaseRefreshLock** (pseudocode lines 200-210): lockPath → unlink → ENOENT ignored

### Files NOT to Modify

- `packages/core/src/auth/__tests__/keyring-token-store.test.ts` — DO NOT MODIFY TESTS
- `packages/core/src/auth/token-store.ts` — DO NOT MODIFY (interface unchanged)
- `packages/core/src/storage/secure-store.ts` — DO NOT MODIFY

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P06
 * @requirement R[X].[Y]
 * @pseudocode lines X-Y
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# All Phase 05 tests pass
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: All pass

# Check plan markers
grep -c "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P06" packages/core/src/auth/keyring-token-store.ts
# Expected: 5+ (class + major methods)

# Check pseudocode references
grep -c "@pseudocode" packages/core/src/auth/keyring-token-store.ts
# Expected: 10+ (one per method/helper)

# No test modifications
git diff packages/core/src/auth/__tests__/keyring-token-store.test.ts | grep -E "^[+-]" | grep -v "^[+-]{3}" | wc -l
# Expected: 0 (no changes to test file)

# TypeScript compiles
npm run typecheck
# Expected: No errors

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

# Lint passes
npm run lint
# Expected: No errors
```

### Structural Verification Checklist

- [ ] All Phase 05 tests pass
- [ ] Plan markers present (P06)
- [ ] Pseudocode line references present
- [ ] No test modifications
- [ ] TypeScript compiles
- [ ] No debug code
- [ ] Lint passes

### Deferred Implementation Detection (MANDATORY)

```bash
# MANDATORY: Check for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

# MANDATORY: Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

# MANDATORY: Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined|throw new Error\('Not" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches (all stubs should be replaced with real logic)
# NOTE: return null in getToken for "not found" is CORRECT, not a stub
# NOTE: return [] in listProviders/listBuckets error handler is CORRECT, not a stub
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read each method implementation
   - [ ] Trace the data flow: input → validation → SecureStore call → output
   - [ ] Verify error handling per method matches requirements

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] Every method has actual logic, not empty returns
   - [ ] Error handling distinguishes between error codes

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual token round-trips
   - [ ] Tests verify error propagation differences
   - [ ] Tests verify list parsing correctness

4. **Is the feature REACHABLE by users?**
   - [ ] Not yet — wiring happens in Phase 07-09
   - [ ] But the class is importable and functional

5. **What's MISSING?**
   - [ ] Wiring into existing system (Phase 07-09)
   - [ ] Export from core/index.ts (Phase 09)
   - [ ] Deletion of MultiProviderTokenStore (Phase 10)

#### Feature Actually Works

```bash
# Run ALL tests to verify nothing is broken
npm test -- --run
# Expected: All tests pass (existing + new)

# Run just KeyringTokenStore tests
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: All pass
```

#### Pseudocode Compliance Verification

```bash
# Verify each pseudocode section has corresponding implementation:
# Lines 13-23 (constructor) → constructor method exists
# Lines 24-28 (validateName) → validateName method exists
# Lines 29-34 (accountKey) → accountKey method exists
# Lines 35-37 (hashIdentifier) → hashIdentifier method exists
# Lines 38-44 (saveToken) → saveToken method exists with passthrough().parse()
# Lines 45-77 (getToken) → getToken with three-layer error handling
# Lines 78-86 (removeToken) → removeToken with catch-and-log
# Lines 87-102 (listProviders) → listProviders with parse-and-sort
# Lines 103-119 (listBuckets) → listBuckets with filter-and-sort
# Lines 120-132 (getBucketStats) → getBucketStats with existence check
# Lines 133-143 (lock infrastructure) → lockFilePath + ensureLockDir
# Lines 144-199 (acquireRefreshLock) → full acquisition algorithm
# Lines 200-210 (releaseRefreshLock) → unlink with ENOENT handling

grep "passthrough" packages/core/src/auth/keyring-token-store.ts
# Expected: 2+ occurrences (saveToken and getToken)

grep "sha256\|createHash" packages/core/src/auth/keyring-token-store.ts
# Expected: 1+ occurrences (hashIdentifier)

grep "wx" packages/core/src/auth/keyring-token-store.ts
# Expected: 1 occurrence (exclusive lock write)
```

## Success Criteria

- ALL Phase 05 tests pass
- No test modifications
- TypeScript compiles
- Lint passes
- All pseudocode sections implemented
- Deferred implementation detection passes
- No debug code

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/keyring-token-store.ts`
2. Re-run Phase 06 with corrected implementation
3. Cannot proceed to Phase 07 until all tests pass
4. DO NOT modify tests to make them pass

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P06.md`
Contents:

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [packages/core/src/auth/keyring-token-store.ts with diff stats]
Tests Added: 0 (all tests from P05)
Tests Passing: [count]
Verification: [paste of test run + typecheck + lint output]
Pseudocode Compliance: [list of verified sections]
```
