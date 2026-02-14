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

#### CI Dual-Mode Test Strategy (R15.2 + R17.8)

**Environment variable**: `LLXPRT_SECURE_STORE_FORCE_FALLBACK`

When set to `"true"`, the test setup helper shall provide a `keytarLoader` that throws a `MODULE_NOT_FOUND` error (simulating absent keyring). When unset or `"false"`, the test setup helper shall provide a working in-memory `keytarLoader` (simulating available keyring). This is the same injectable-`keytarLoader` pattern already used by `ToolKeyStorage` and `ProviderKeyStorage` tests — no new infrastructure is needed.

**Test file structure**:

The `keyring-token-store.test.ts` file shall read `process.env.LLXPRT_SECURE_STORE_FORCE_FALLBACK` once in its top-level `beforeAll` (or factory helper) to choose which `keytarLoader` to inject into `SecureStore`:

```typescript
const keytarLoader = process.env.LLXPRT_SECURE_STORE_FORCE_FALLBACK === 'true'
  ? async () => { throw Object.assign(new Error('keytar not found'), { code: 'MODULE_NOT_FOUND' }); }
  : async () => createMockKeyringAdapter();  // in-memory Map-backed adapter
```

All behavioral tests are identical in both modes — the assertions do not change. Only the storage backend differs (keyring vs encrypted-file fallback). This guarantees equivalent coverage.

**Local dual-mode validation**:

Developers must be able to verify both paths locally before pushing:

```bash
# Keyring-available mode (default)
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts

# Fallback mode (simulating absent keyring)
LLXPRT_SECURE_STORE_FORCE_FALLBACK=true npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
```

Both runs must pass with identical results. The test output should log which mode is active (e.g., a top-level `console.log` in the test file or a `describe` block name that includes the mode) so that CI job logs clearly show which path was exercised.

**CI workflow change** (owned by P11 — Final Verification):

The `test` job in `.github/workflows/ci.yml` shall gain a `secure-store-mode` matrix dimension with two values: `keyring` and `fallback`. The `fallback` entry sets `LLXPRT_SECURE_STORE_FORCE_FALLBACK: 'true'` as an environment variable. This produces 4 test runs (2 OS × 2 modes) — one exercising the keyring path, one exercising the fallback path per OS. The concrete CI workflow YAML change is specified in P11 (see "CI Dual-Mode Enforcement" section). P11 also contains verification commands to confirm both CI paths exist and pass.

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
