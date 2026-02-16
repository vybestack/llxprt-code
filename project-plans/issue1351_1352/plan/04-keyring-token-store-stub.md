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
