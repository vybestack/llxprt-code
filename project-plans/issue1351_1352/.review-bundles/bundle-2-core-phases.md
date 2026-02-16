# BUNDLE 2: Core Implementation Phases (P04-P06)

# Phase 04: KeyringTokenStore Stub

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P04`

## Prerequisites

- Required: Phase 03 completed (pseudocode)
- Verification: `test -f project-plans/issue1351_1352/.completed/P03.md`
- Expected files from previous phase:
  - `analysis/pseudocode/keyring-token-store.md` (numbered lines)
  - `analysis/pseudocode/wiring-and-elimination.md` (numbered lines)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R1.1: TokenStore Interface Implementation

**Full Text**: KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.
**Behavior**:
- GIVEN: The TokenStore interface defines 8 methods
- WHEN: KeyringTokenStore stub class is created
- THEN: The class declares `implements TokenStore` and has all 8 method signatures with correct types
**Why This Matters**: The stub must compile against the interface — any signature mismatch is caught here before tests are written.

### R1.2: SecureStore Delegation

**Full Text**: KeyringTokenStore shall delegate all credential storage operations (set, get, delete, list) to a `SecureStore` instance configured with service name `llxprt-code-oauth` and fallback policy `allow`.
**Behavior**:
- GIVEN: SecureStore is the storage backend
- WHEN: KeyringTokenStore stub is constructed
- THEN: The constructor creates or accepts a SecureStore instance with correct service name and fallback policy
**Why This Matters**: Even in stub phase, the constructor must establish the correct SecureStore wiring.

### R1.3: Optional SecureStore Injection

**Full Text**: KeyringTokenStore shall accept an optional `SecureStore` instance in its constructor for testability and shared-instance wiring. When not provided, it shall construct a default instance.
**Behavior**:
- GIVEN: Tests need to inject a test SecureStore
- WHEN: KeyringTokenStore stub constructor is defined
- THEN: Constructor accepts `options?: { secureStore?: SecureStore }` and falls back to default construction
**Why This Matters**: Testability must be designed in from the start — retrofitting injection is error-prone.

## Implementation Tasks

### Files to Create

- `packages/core/src/auth/keyring-token-store.ts`
  - MUST include: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P04`
  - MUST include: `@requirement:R1.1, R1.2, R1.3`
  - Class: `KeyringTokenStore implements TokenStore`
  - Constructor: accepts optional `{ secureStore?: SecureStore }`
  - Default SecureStore: `new SecureStore('llxprt-code-oauth', { fallbackDir: ..., fallbackPolicy: 'allow' })`
  - All 8 methods: throw `new Error('NotYetImplemented')` OR return typed empty values
  - Constants: SERVICE_NAME, NAME_REGEX, DEFAULT_BUCKET, LOCK_DIR, timing constants
  - Private helper stubs: validateName, accountKey, hashIdentifier, lockFilePath, ensureLockDir
  - Maximum 150 lines total
  - Must compile with `npm run typecheck`

### Files to Modify

None in this phase. The stub is a new file.

### Required Code Markers

Every function/class in this phase MUST include:

```typescript
/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P04
 * @requirement R1.1, R1.2, R1.3
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P04" packages/core/src/auth/keyring-token-store.ts | wc -l
# Expected: 1+ occurrences

# Check requirements covered
grep -r "@requirement" packages/core/src/auth/keyring-token-store.ts | wc -l
# Expected: 1+ occurrences

# Verify TypeScript compiles
npm run typecheck
# Expected: No errors

# Verify file exists
test -f packages/core/src/auth/keyring-token-store.ts && echo "OK" || echo "FAIL"

# Verify implements TokenStore
grep "implements TokenStore" packages/core/src/auth/keyring-token-store.ts
# Expected: 1 match

# Verify all 8 methods exist
for method in saveToken getToken removeToken listProviders listBuckets getBucketStats acquireRefreshLock releaseRefreshLock; do
  grep -c "$method" packages/core/src/auth/keyring-token-store.ts || echo "FAIL: $method missing"
done

# Check for TODO comments (NotYetImplemented is OK in stubs)
grep -r "TODO" packages/core/src/auth/keyring-token-store.ts
# Expected: No TODO comments

# Check for version duplication
find packages/core/src/auth -name "*V2*" -o -name "*New*" -o -name "*Copy*"
# Expected: No matches

# Verify tests don't EXPECT NotYetImplemented (no tests yet, but check)
grep -r "expect.*NotYetImplemented\|toThrow.*NotYetImplemented" packages/core/src/auth/ 2>/dev/null
# Expected: No matches
```

### Structural Verification Checklist

- [ ] File created at correct path
- [ ] Implements TokenStore interface
- [ ] All 8 methods present with correct signatures
- [ ] Constructor accepts optional SecureStore
- [ ] Default SecureStore uses 'llxprt-code-oauth' service name
- [ ] Constants defined (SERVICE_NAME, NAME_REGEX, etc.)
- [ ] TypeScript compiles without errors
- [ ] No TODO comments
- [ ] No duplicate versions

### Deferred Implementation Detection (MANDATORY)

```bash
# Stubs ARE expected to have empty implementations, so check for non-stub issues:

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches (NotYetImplemented errors are OK, but no TODO comments)

# Check for "cop-out" comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] R1.1: Class declares `implements TokenStore` — verified by reading file
   - [ ] R1.2: Constructor creates/accepts SecureStore with correct config
   - [ ] R1.3: Constructor parameter is optional

2. **Is this REAL implementation, not placeholder?**
   - [ ] This IS a stub phase — stubs throwing NotYetImplemented or returning empty values are expected
   - [ ] But: constructor MUST actually create SecureStore (not stub this)
   - [ ] Constants MUST be real values, not placeholders

3. **Would the test FAIL if implementation was removed?**
   - [ ] N/A — no tests yet (TDD phase is next)
   - [ ] But: typecheck MUST pass — removing a method would break compilation

4. **Is the feature REACHABLE by users?**
   - [ ] Not yet — wiring happens in Phase 07-09
   - [ ] But: the class CAN be imported and instantiated

5. **What's MISSING?**
   - [ ] Method implementations (Phase 06)
   - [ ] Tests (Phase 05)
   - [ ] Wiring into existing system (Phase 07-09)

#### Feature Actually Works

```bash
# Verify stub compiles and can be instantiated (TypeScript check only)
npm run typecheck
# Expected: No errors related to keyring-token-store.ts
```

## Success Criteria

- `keyring-token-store.ts` created and compiles
- All 8 TokenStore methods present with correct signatures
- Constructor correctly configured for SecureStore delegation
- Constants defined with real values
- No TODO or placeholder comments
- TypeScript strict mode passes

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/keyring-token-store.ts`
2. Or if file doesn't exist in git: `rm packages/core/src/auth/keyring-token-store.ts`
3. Re-run Phase 04 with corrected approach
4. Cannot proceed to Phase 05 until stub compiles

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P04.md`
Contents:

```markdown
Phase: P04
Completed: YYYY-MM-DD HH:MM
Files Created: [packages/core/src/auth/keyring-token-store.ts with line count]
Files Modified: [none]
Tests Added: 0
Verification: [paste of typecheck output]
```

---

# Phase 05: KeyringTokenStore TDD

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P05`

## Prerequisites

- Required: Phase 04 completed (stub compiles)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P04" packages/core/src/auth/keyring-token-store.ts`
- Expected files from previous phase:
  - `packages/core/src/auth/keyring-token-store.ts` (stub, compiles)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R1.1: TokenStore Interface Implementation

**Full Text**: KeyringTokenStore shall implement the `TokenStore` interface from `packages/core/src/auth/token-store.ts`.
**Behavior**:
- GIVEN: KeyringTokenStore stub exists and compiles
- WHEN: Behavioral tests are written for all 8 interface methods
- THEN: Tests verify actual input→output transformations, not just that methods exist
**Why This Matters**: Tests define the behavioral contract — implementation in Phase 06 must satisfy these exact behaviors.

### R1.2: SecureStore Delegation

**Full Text**: KeyringTokenStore shall delegate all credential storage operations to SecureStore('llxprt-code-oauth', allow).
**Behavior**:
- GIVEN: A test SecureStore instance (with injectable keyring adapter)
- WHEN: KeyringTokenStore operations are performed
- THEN: Data appears in/disappears from the SecureStore (verified by reading back)
**Why This Matters**: Tests prove the delegation actually works, not just that SecureStore methods are called.

### R1.3: Optional SecureStore Injection

**Full Text**: KeyringTokenStore shall accept an optional SecureStore instance in its constructor.
**Behavior**:
- GIVEN: A test provides a pre-configured SecureStore
- WHEN: KeyringTokenStore is constructed with `{ secureStore: testStore }`
- THEN: All operations use the injected store (verified by data appearing in testStore)
**Why This Matters**: Tests must use injection to avoid hitting the real OS keyring.

### R2.1: Account Key Format

**Full Text**: KeyringTokenStore shall map each provider+bucket combination to a SecureStore account key using the format `{provider}:{bucket}`.
**Behavior**:
- GIVEN: provider='anthropic', bucket='work'
- WHEN: saveToken is called, then listBuckets is called
- THEN: The token is stored under key 'anthropic:work' and bucket 'work' appears in listing
**Why This Matters**: The naming convention enables correct key parsing in list operations.

### R2.2: Default Bucket

**Full Text**: When `bucket` is omitted, KeyringTokenStore shall use `default` as the bucket name.
**Behavior**:
- GIVEN: provider='gemini', bucket is omitted
- WHEN: saveToken(provider, token) is called (no bucket parameter)
- THEN: Token is stored under key 'gemini:default' and retrievable with getToken('gemini')
**Why This Matters**: Most users don't use multi-bucket — the default must work seamlessly.

### R2.3: Name Validation

**Full Text**: KeyringTokenStore shall validate both provider and bucket names against `[a-zA-Z0-9_-]+`.
**Behavior**:
- GIVEN: provider='valid-name_123', bucket='also_valid-1'
- WHEN: saveToken is called
- THEN: Operation succeeds (names pass validation)
- AND GIVEN: provider='invalid name' (space)
- WHEN: saveToken is called
- THEN: Error thrown with message identifying invalid name and allowed characters
**Why This Matters**: Invalid names could cause SecureStore key collisions or filesystem issues.

### R2.4: Throw Before Storage

**Full Text**: When a provider or bucket name fails validation, KeyringTokenStore shall throw immediately.
**Behavior**:
- GIVEN: provider='bad/name'
- WHEN: saveToken is called
- THEN: Error is thrown before any SecureStore operation occurs
**Why This Matters**: Fail-fast prevents partial state changes.

### R3.1: saveToken Validation

**Full Text**: When saveToken is called, validate with `OAuthTokenSchema.passthrough().parse()` and store as JSON.
**Behavior**:
- GIVEN: A valid OAuthToken with extra provider fields (e.g., account_id)
- WHEN: saveToken is called
- THEN: Token round-trips correctly — getToken returns ALL fields including extras
**Why This Matters**: .passthrough() preservation is tested by verifying extra fields survive save+load.

### R3.2: getToken Parsing

**Full Text**: When getToken retrieves a non-null value, parse with JSON.parse + OAuthTokenSchema.passthrough().parse().
**Behavior**:
- GIVEN: A token was previously saved
- WHEN: getToken is called
- THEN: Returns a validated OAuthToken with all fields intact
**Why This Matters**: Read-path validation catches corruption before tokens reach API callers.

### R3.3: Passthrough Preservation

**Full Text**: Use .passthrough() to preserve provider-specific fields.
**Behavior**:
- GIVEN: A Codex token with `{ access_token, refresh_token, expiry, token_type, account_id, id_token }`
- WHEN: saveToken then getToken
- THEN: Returned token includes `account_id` and `id_token` (not stripped)
**Why This Matters**: Without this test, an implementation using .parse() would pass other tests but silently lose Codex data.

### R4.1: Corrupt JSON

**Full Text**: If getToken retrieves a value that fails JSON.parse(), log warning with hashed ID, return null.
**Behavior**:
- GIVEN: SecureStore contains non-JSON data for 'provider:bucket'
- WHEN: getToken('provider', 'bucket') is called
- THEN: Returns null (not throws), and a warning log was emitted
**Why This Matters**: Corrupt data should not crash the application.

### R4.2: Invalid Schema

**Full Text**: If getToken retrieves valid JSON that fails schema validation, log warning with hashed ID, return null.
**Behavior**:
- GIVEN: SecureStore contains `{"wrong": "schema"}` for 'provider:bucket'
- WHEN: getToken('provider', 'bucket') is called
- THEN: Returns null (not throws), and a warning log was emitted
**Why This Matters**: Schema evolution may cause old data to fail new validation.

### R4.3: No Deletion of Corrupt Data

**Full Text**: KeyringTokenStore shall NOT delete corrupt entries.
**Behavior**:
- GIVEN: SecureStore contains corrupt data for 'provider:bucket'
- WHEN: getToken returns null
- THEN: The corrupt data is still present in SecureStore (verified by direct SecureStore.get())
**Why This Matters**: Automatic deletion would destroy evidence needed for debugging.

### R4.4: SHA-256 Hash in Logs

**Full Text**: Warning logs shall include SHA-256 hashed provider:bucket identifier, not raw value.
**Behavior**:
- GIVEN: Corrupt data exists for 'anthropic:default'
- WHEN: getToken reads it and logs a warning
- THEN: Log message contains a hex hash, NOT the string 'anthropic:default'
**Why This Matters**: Log files should not contain provider-identifying information.

### R5.1: removeToken Deletes

**Full Text**: When removeToken is called, call secureStore.delete().
**Behavior**:
- GIVEN: A token was saved for 'gemini:default'
- WHEN: removeToken('gemini') is called, then getToken('gemini')
- THEN: getToken returns null (token was deleted)
**Why This Matters**: Logout must actually remove credentials.

### R5.2: removeToken Swallows Errors

**Full Text**: If removeToken encounters SecureStoreError, log and return normally.
**Behavior**:
- GIVEN: SecureStore.delete() would throw an error
- WHEN: removeToken is called
- THEN: Method returns normally (does not throw)
**Why This Matters**: Logout should succeed even if cleanup has issues.

### R6.1: listProviders

**Full Text**: Call secureStore.list(), parse keys, extract unique providers, return sorted.
**Behavior**:
- GIVEN: Tokens saved for 'anthropic:default', 'gemini:default', 'gemini:work'
- WHEN: listProviders() is called
- THEN: Returns ['anthropic', 'gemini'] (sorted, unique)
**Why This Matters**: /auth status needs to enumerate all configured providers.

### R6.2: listBuckets

**Full Text**: Filter keys by provider, extract buckets, return sorted.
**Behavior**:
- GIVEN: Tokens saved for 'gemini:default', 'gemini:work', 'anthropic:default'
- WHEN: listBuckets('gemini') is called
- THEN: Returns ['default', 'work'] (sorted, only gemini buckets)
**Why This Matters**: /auth status needs to show all buckets for a provider.

### R6.3: List Errors → Empty Array

**Full Text**: If list encounters SecureStoreError, return empty array.
**Behavior**:
- GIVEN: SecureStore.list() would throw an error
- WHEN: listProviders() or listBuckets() is called
- THEN: Returns [] (not throws)
**Why This Matters**: List operations are informational — degraded results keep UI functional.

### R7.1: getBucketStats with Token

**Full Text**: If token exists, return `{ bucket, requestCount: 0, percentage: 0, lastUsed: undefined }`.
**Behavior**:
- GIVEN: Token saved for 'gemini:default'
- WHEN: getBucketStats('gemini', 'default') is called
- THEN: Returns `{ bucket: 'default', requestCount: 0, percentage: 0, lastUsed: undefined }`
**Why This Matters**: Stats are placeholder but must return correct shape.

### R7.2: getBucketStats without Token

**Full Text**: If no token exists, return null.
**Behavior**:
- GIVEN: No token saved for 'gemini:work'
- WHEN: getBucketStats('gemini', 'work') is called
- THEN: Returns null
**Why This Matters**: Callers need to distinguish between "has stats" and "bucket doesn't exist".

### R8.1–R8.6: Refresh Lock Acquisition

**Full Text**: File-based advisory locks in ~/.llxprt/oauth/locks/, exclusive write, stale detection, polling, timeout, corrupt lock handling.
**Behavior**:
- GIVEN: No existing lock
- WHEN: acquireRefreshLock('gemini') is called
- THEN: Returns true, lock file exists with {pid, timestamp}
- AND GIVEN: Lock already held by another process
- WHEN: acquireRefreshLock('gemini', { waitMs: 500 }) is called
- THEN: Waits, then returns false on timeout
- AND GIVEN: Stale lock (age > staleMs)
- WHEN: acquireRefreshLock('gemini') is called
- THEN: Breaks stale lock, acquires, returns true
**Why This Matters**: Lock mechanism prevents concurrent token refresh which could invalidate tokens.

### R9.1–R9.2: Refresh Lock Release

**Full Text**: releaseRefreshLock deletes lock file; ENOENT ignored.
**Behavior**:
- GIVEN: Lock was acquired
- WHEN: releaseRefreshLock('gemini') is called
- THEN: Lock file no longer exists
- AND GIVEN: Lock file doesn't exist
- WHEN: releaseRefreshLock('gemini') is called
- THEN: No error thrown (idempotent)
**Why This Matters**: Release must be safe to call multiple times.

### R10.1: Lock File Naming

**Full Text**: Lock files: `{provider}-refresh.lock` or `{provider}-{bucket}-refresh.lock`.
**Behavior**:
- GIVEN: provider='gemini', default bucket
- WHEN: Lock is acquired
- THEN: Lock file path is `~/.llxprt/oauth/locks/gemini-refresh.lock`
- AND GIVEN: provider='gemini', bucket='work'
- WHEN: Lock is acquired
- THEN: Lock file path is `~/.llxprt/oauth/locks/gemini-work-refresh.lock`
**Why This Matters**: Naming convention must match between acquire and release.

### R10.2: Lock Directory Creation

**Full Text**: ~/.llxprt/oauth/locks/ created on demand with mode 0o700.
**Behavior**:
- GIVEN: Lock directory doesn't exist
- WHEN: acquireRefreshLock is called
- THEN: Directory is created with mode 0o700
**Why This Matters**: First-use scenario must work without manual directory creation.

### R11.1–R11.2: saveToken Error Propagation

**Full Text**: saveToken propagates all SecureStoreError codes.
**Behavior**:
- GIVEN: SecureStore.set() throws SecureStoreError(UNAVAILABLE)
- WHEN: saveToken is called
- THEN: SecureStoreError(UNAVAILABLE) is thrown to caller
**Why This Matters**: Login command needs the error to show user-actionable messages.

### R12.1–R12.3: getToken Error Handling

**Full Text**: null from get → null; UNAVAILABLE/LOCKED/DENIED/TIMEOUT → propagate; CORRUPT → log + null.
**Behavior**:
- GIVEN: secureStore.get() returns null
- WHEN: getToken is called
- THEN: Returns null
- AND GIVEN: secureStore.get() throws SecureStoreError(LOCKED)
- WHEN: getToken is called
- THEN: SecureStoreError(LOCKED) is thrown
- AND GIVEN: secureStore.get() throws SecureStoreError(CORRUPT)
- WHEN: getToken is called
- THEN: Returns null with warning log
**Why This Matters**: Different error codes require different handling — active failures vs corrupt data.

### R14.1: Probe-Once Constraint

**Full Text**: Keyring availability probe happens at most once per process.
**Behavior**:
- GIVEN: A single KeyringTokenStore instance
- WHEN: Multiple getToken/saveToken calls are made
- THEN: SecureStore's probe runs at most once (SecureStore handles this internally)
**Why This Matters**: Multiple probes would slow down operations and potentially give inconsistent results.

### R19.1: Clear Error Messages

**Full Text**: Invalid name errors include the invalid name and allowed character set.
**Behavior**:
- GIVEN: provider='my provider' (has space)
- WHEN: saveToken is called
- THEN: Error message includes 'my provider' and mentions allowed characters
**Why This Matters**: Users need actionable error messages to fix their input.

### R15.1: Dual-Mode Operation

**Full Text**: KeyringTokenStore shall function correctly in both keyring-available and keyring-unavailable (fallback-only) environments. SecureStore handles the fallback transparently.
**Behavior**:
- GIVEN: SecureStore constructed with working keytarLoader (keyring-available)
- WHEN: saveToken, getToken, removeToken, listProviders, listBuckets are called
- THEN: All operations succeed and return correct results
- AND GIVEN: SecureStore constructed with keytarLoader that throws MODULE_NOT_FOUND (keyring-unavailable)
- WHEN: The same operations are called
- THEN: All operations succeed identically via encrypted-file fallback
**Why This Matters**: Users on headless Linux (no D-Bus/keyring) must have identical behavior through the AES-256-GCM fallback path.

### R15.2: Equivalent Test Coverage

**Full Text**: Both the keyring path and the fallback path shall have equivalent behavioral test coverage, exercised in separate CI jobs.
**Behavior**:
- GIVEN: The test suite contains keyring-available and keyring-unavailable test groups
- WHEN: Each group is run independently
- THEN: Both groups exercise save/get/remove/list/corrupt-handling with identical assertions
**Why This Matters**: A regression in the fallback path would silently break headless/CI environments.

## Sanctioned Test Patterns

**This section clarifies what IS and IS NOT mock theater for this test file.**

### SANCTIONED (dependency injection — NOT mock theater)

- Constructing `SecureStore` with an injectable `keytarLoader` that can return a fake keyring, throw `MODULE_NOT_FOUND`, or simulate `LOCKED`/`DENIED` errors. This is the same pattern used by `ToolKeyStorage` tests and `ProviderKeyStorage` tests in this project.
- Creating in-memory SecureStore instances (backed by `Map<string, string>` via the fake keytarLoader) so tests never hit the real OS keyring.
- Using `vi.spyOn(debugLogger, 'debug')` to verify warning logs contain hashed identifiers (log verification, not behavior mocking).

### BANNED (mock theater)

- `vi.fn()` on SecureStore methods (`set`, `get`, `delete`, `list`) then asserting `toHaveBeenCalledWith(...)`. This tests wiring, not behavior.
- Mocking `KeyringTokenStore` internal methods.
- Any `toHaveBeenCalled` assertion on production code functions.
- Tests that would pass if the implementation returned hardcoded values.

### Pattern Reference

See `packages/core/src/tools/__tests__/tool-key-storage.test.ts` for the canonical injectable-keytarLoader pattern used in this project.

## Implementation Tasks

### Files to Create

- `packages/core/src/auth/__tests__/keyring-token-store.test.ts`
  - MUST include: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P05`
  - MUST include: `@requirement` tags on every test
  - ~40-50 behavioral tests covering:
    - Token CRUD (save, get, remove) with real data
    - Round-trip preservation of extra fields (Codex account_id)
    - Name validation (valid names, invalid names, empty, special chars)
    - Default bucket behavior
    - Corrupt token handling (bad JSON, bad schema)
    - SHA-256 hash in warning logs (not raw provider name)
    - List operations (providers, buckets) with sorting
    - List error degradation (empty array on error)
    - getBucketStats (exists vs not exists)
    - Lock acquisition (success, timeout, stale lock breaking)
    - Lock release (normal, idempotent)
    - Lock file naming convention
    - Lock directory creation
    - Error propagation differences (saveToken vs getToken vs removeToken)
  - 30%+ property-based tests using fast-check:
    - Property: any valid provider+bucket combo round-trips correctly
    - Property: any invalid name (with special chars) is rejected
    - Property: token with arbitrary extra fields survives round-trip
    - Property: lock acquire + release is idempotent
  - Each test has GIVEN/WHEN/THEN comment and @requirement tag
  - NO mock theater (no toHaveBeenCalled)
  - NO reverse testing (no toThrow('NotYetImplemented'))
  - NO structure-only tests (no toHaveProperty without value)

### Files to Modify

None — this is a TDD phase, only test files are created.

### Required Code Markers

Every test MUST include:

```typescript
/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P05
 * @requirement R[X].[Y]
 * @given [precondition]
 * @when [action]
 * @then [expected outcome]
 */
it('should [behavior description]', async () => {
  // test implementation
});
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers exist
grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P05" packages/core/src/auth/__tests__/keyring-token-store.test.ts | wc -l
# Expected: 30+ occurrences

# Check requirements covered
grep -r "@requirement" packages/core/src/auth/__tests__/keyring-token-store.test.ts | wc -l
# Expected: 30+ occurrences

# Count total tests
grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: 40+

# Check for mock theater (FORBIDDEN)
grep -r "toHaveBeenCalled\|toHaveBeenCalledWith\|jest.fn\|vi.fn" packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: No matches (except where testing SecureStore adapter injection)

# Check for reverse testing (FORBIDDEN)
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: No matches

# Check for structure-only testing (FORBIDDEN)
grep -r "toHaveProperty\|toBeDefined\|toBeUndefined" packages/core/src/auth/__tests__/keyring-token-store.test.ts | grep -v "with specific value"
# Expected: Minimal or no matches

# Verify property-based tests exist (30% minimum)
TOTAL=$(grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|it\.prop" packages/core/src/auth/__tests__/keyring-token-store.test.ts)
echo "Total tests: $TOTAL, Property-based: $PROPERTY"
# Expected: PROPERTY >= TOTAL * 0.3

# Verify behavioral assertions
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toStrictEqual\(" packages/core/src/auth/__tests__/keyring-token-store.test.ts
# Expected: 40+ behavioral assertions

# Run tests - should fail naturally (stub phase)
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>&1 | tail -10
# Expected: Tests exist but fail (NotYetImplemented or empty returns)
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] All plan markers present
- [ ] All requirement tags present
- [ ] 40+ tests written
- [ ] 30%+ property-based tests
- [ ] No mock theater
- [ ] No reverse testing
- [ ] No structure-only tests
- [ ] Behavioral assertions used
- [ ] Tests fail naturally against stub

### Deferred Implementation Detection (MANDATORY)

N/A — this is a TDD phase, not an implementation phase.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the test DO what the requirement says?**
   - [ ] Each test has a clear GIVEN/WHEN/THEN that maps to a requirement
   - [ ] Tests verify actual outputs (values, null returns, error types)
   - [ ] Tests don't just verify something was called

2. **Is this REAL testing, not placeholder?**
   - [ ] Tests have specific expected values, not just type checks
   - [ ] Property-based tests generate meaningful inputs
   - [ ] Error tests verify specific error types and messages

3. **Would the test FAIL if implementation was removed?**
   - [ ] Every test would fail against the stub
   - [ ] Tests require actual data transformation, not just non-throwing

4. **Do tests cover ALL requirements for this phase?**
   - [ ] R1.1–R1.3 (interface, delegation, injection)
   - [ ] R2.1–R2.4 (naming, default bucket, validation)
   - [ ] R3.1–R3.3 (serialization, passthrough)
   - [ ] R4.1–R4.4 (corrupt handling, no deletion, SHA-256)
   - [ ] R5.1–R5.2 (remove, swallow errors)
   - [ ] R6.1–R6.3 (list, sort, error degradation)
   - [ ] R7.1–R7.2 (stats)
   - [ ] R8.1–R8.6 (lock acquisition)
   - [ ] R9.1–R9.2 (lock release)
   - [ ] R10.1–R10.2 (lock naming, dir creation)
   - [ ] R11.1–R11.2 (saveToken errors)
   - [ ] R12.1–R12.3 (getToken errors)
   - [ ] R19.1 (error messages)

5. **What's MISSING?**
   - [ ] [gap 1]
   - [ ] [gap 2]

## Success Criteria

- 40+ behavioral tests created
- 30%+ are property-based (fast-check)
- All tests tagged with plan ID and requirement
- No mock theater, reverse testing, or structure-only tests
- Tests fail naturally against stub
- All requirement groups R1–R12, R14, R19 covered

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/__tests__/keyring-token-store.test.ts`
2. Or: `rm packages/core/src/auth/__tests__/keyring-token-store.test.ts`
3. Re-run Phase 05 with corrected test design
4. Cannot proceed to Phase 06 until tests are correct

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P05.md`
Contents:

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Created: [packages/core/src/auth/__tests__/keyring-token-store.test.ts with line count]
Files Modified: [none]
Tests Added: [count]
Property-Based Tests: [count and percentage]
Verification: [paste of test run output showing failures against stub]
```

---

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
