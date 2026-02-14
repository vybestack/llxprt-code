# BUNDLE 3: Integration + Elimination Phases (P07-P11)

# Phase 07: Integration Stub — Wire KeyringTokenStore into Existing System

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P07`

## Prerequisites

- Required: Phase 06 completed (KeyringTokenStore fully implemented, all unit tests pass)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P06" packages/core/src/auth/keyring-token-store.ts`
- Expected files from previous phase:
  - `packages/core/src/auth/keyring-token-store.ts` (fully implemented)
  - `packages/core/src/auth/__tests__/keyring-token-store.test.ts` (all passing)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R13.1: Replace MultiProviderTokenStore Instantiation Sites

**Full Text**: All production sites that instantiate `MultiProviderTokenStore` shall be changed to use `KeyringTokenStore`.
**Behavior**:
- GIVEN: 6 production files instantiate MultiProviderTokenStore
- WHEN: This stub phase updates imports and type references
- THEN: Import statements change from MultiProviderTokenStore to KeyringTokenStore, but instantiation sites are NOT yet changed (stub phase prepares the wiring)
**Why This Matters**: Preparing imports and type references before changing instantiation ensures compilation is possible.

### R13.3: Replace Exports/Re-exports

**Full Text**: All exports and re-exports of `MultiProviderTokenStore` shall be replaced with `KeyringTokenStore`.
**Behavior**:
- GIVEN: `packages/core/index.ts` exports MultiProviderTokenStore and `packages/cli/src/auth/types.ts` re-exports it
- WHEN: This phase updates both export sites
- THEN: KeyringTokenStore is exported from core and re-exported from CLI
**Why This Matters**: Export changes enable downstream consumers to import the new class.

## Implementation Tasks

### Files to Modify

- `packages/core/index.ts`
  - CHANGE: `export { MultiProviderTokenStore } from './src/auth/token-store.js'`
  - TO: `export { KeyringTokenStore } from './src/auth/keyring-token-store.js'`
  - ALSO ADD: Keep exporting `TokenStore` type (if not already exported)
  - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P07`
  - Implements: `@requirement:R13.3`

- `packages/cli/src/auth/types.ts`
  - CHANGE: `export { MultiProviderTokenStore } from '@vybestack/llxprt-code-core'`
  - TO: `export { KeyringTokenStore } from '@vybestack/llxprt-code-core'`
  - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P07`
  - Implements: `@requirement:R13.3`

**NOTE**: In this stub phase, we update ONLY the export chain. The actual instantiation site changes (new MultiProviderTokenStore() → new KeyringTokenStore()) happen in Phase 09. This phase establishes the import/export path so that Phase 08 can write integration tests that import KeyringTokenStore from the public API.

**IMPORTANT**: Because we're changing the export but NOT yet changing consumers, TypeScript may report errors on files that still import MultiProviderTokenStore. This is expected and acceptable for the stub phase. Those files will be updated in Phase 09. To maintain compilation during this phase, we ALSO temporarily export MultiProviderTokenStore alongside KeyringTokenStore if needed, OR we update the import sites in Phase 09's impl phase.

**ALTERNATIVE APPROACH**: If maintaining compilation is critical, this phase can ALSO update all import statements in consumer files to use KeyringTokenStore, while leaving the `new MultiProviderTokenStore()` → `new KeyringTokenStore()` changes for Phase 09. The key constraint is: DO NOT change the actual construction calls yet — only imports and exports.

### Required Code Markers

```typescript
// @plan PLAN-20260213-KEYRINGTOKENSTORE.P07
// @requirement R13.3
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Check plan markers
grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P07" packages/core/index.ts packages/cli/src/auth/types.ts | wc -l
# Expected: 2+

# Verify KeyringTokenStore is now exported from core
grep "KeyringTokenStore" packages/core/index.ts
# Expected: 1 match (export line)

# Verify KeyringTokenStore is now re-exported from CLI types
grep "KeyringTokenStore" packages/cli/src/auth/types.ts
# Expected: 1 match (re-export line)

# TypeScript compiles (may need temporary dual export)
npm run typecheck 2>&1 | head -20
# Expected: No errors (or only expected errors from consumers not yet updated)
```

### Structural Verification Checklist

- [ ] core/index.ts updated to export KeyringTokenStore
- [ ] cli/auth/types.ts updated to re-export KeyringTokenStore
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Compilation succeeds (or only expected import errors remain)

### Deferred Implementation Detection (MANDATORY)

```bash
# Check the modified files for deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/index.ts packages/cli/src/auth/types.ts
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] R13.3: KeyringTokenStore is exported where MultiProviderTokenStore was
   - [ ] Verified by reading both export files

2. **Is this REAL implementation, not placeholder?**
   - [ ] Export statements reference actual KeyringTokenStore class
   - [ ] Import path is correct (keyring-token-store.js)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Integration tests (Phase 08) will import via these exports
   - [ ] Removing the export would cause import failures

4. **Is the feature REACHABLE by users?**
   - [ ] Not yet — instantiation sites still use MultiProviderTokenStore
   - [ ] Phase 09 completes the wiring

5. **What's MISSING?**
   - [ ] Consumer instantiation changes (Phase 09)
   - [ ] Integration tests (Phase 08)
   - [ ] Legacy deletion (Phase 10)

## Success Criteria

- KeyringTokenStore exported from core and CLI
- Plan and requirement markers present
- TypeScript compiles (with acceptable temporary state)

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/index.ts packages/cli/src/auth/types.ts`
2. Re-run Phase 07 with corrected approach
3. Cannot proceed to Phase 08 until exports are correct

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P07.md`
Contents:

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [packages/core/index.ts, packages/cli/src/auth/types.ts with diff stats]
Tests Added: 0
Verification: [paste of verification command outputs]
```

---

# Phase 08: Integration TDD — End-to-End Flow Tests

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P08`

## Prerequisites

- Required: Phase 07 completed (KeyringTokenStore exported from core and CLI)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P07" packages/core/index.ts`
- Expected files from previous phase:
  - `packages/core/index.ts` (exports KeyringTokenStore)
  - `packages/cli/src/auth/types.ts` (re-exports KeyringTokenStore)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R13.1: Replace MultiProviderTokenStore Instantiation Sites

**Full Text**: All production sites that instantiate `MultiProviderTokenStore` shall be changed to use `KeyringTokenStore`.
**Behavior**:
- GIVEN: Integration tests simulate the production usage pattern
- WHEN: Tests create KeyringTokenStore and use it for full token lifecycle
- THEN: Tests verify the same operations that production code performs
**Why This Matters**: Integration tests define the contract that Phase 09 wiring must satisfy.

### R17.1: Equivalent Test Coverage

**Full Text**: All `TokenStore` interface behaviors shall have equivalent coverage in new tests.
**Behavior**:
- GIVEN: Existing tests covered MultiProviderTokenStore behaviors
- WHEN: Integration tests are written for KeyringTokenStore
- THEN: Every TokenStore behavior is tested in context (not just unit isolation)
**Why This Matters**: Ensures the replacement is functionally equivalent.

### R17.2: Multiprocess Race Condition Tests

**Full Text**: Multiprocess race conditions (concurrent refresh, refresh+logout) shall be tested with spawned child processes.
**Behavior**:
- GIVEN: Two processes sharing the same keyring storage
- WHEN: Both attempt concurrent token refresh
- THEN: File-based locks prevent double-refresh; one waits, then succeeds
**Why This Matters**: Real-world scenario — multiple CLI instances running.

### R17.3: Full Lifecycle Test

**Full Text**: The full token lifecycle shall work end-to-end: login → store → read → refresh → logout.
**Behavior**:
- GIVEN: A new KeyringTokenStore instance
- WHEN: login stores token, read retrieves it, refresh cycle updates it, logout removes it
- THEN: Each step produces correct state; final state is clean (no token)
**Why This Matters**: The complete happy path must work.

### R17.4: Multiple Providers Simultaneously

**Full Text**: Multiple providers shall work simultaneously.
**Behavior**:
- GIVEN: KeyringTokenStore with tokens for anthropic, gemini, qwen
- WHEN: Operations target specific providers
- THEN: Each provider's token is independent; listing shows all; operations don't cross-contaminate
**Why This Matters**: Most users authenticate with multiple providers.

### R17.5: /auth login Stores in Keyring

**Full Text**: `/auth login` shall store tokens in keyring (not plaintext files).
**Behavior**:
- GIVEN: KeyringTokenStore is wired into the auth command
- WHEN: A token is saved (simulating login)
- THEN: Token is in SecureStore, NOT in ~/.llxprt/oauth/*.json
**Why This Matters**: This is the primary security improvement.

### R17.6: /auth status Reads from Keyring

**Full Text**: `/auth status` shall read tokens from keyring.
**Behavior**:
- GIVEN: A token was stored via KeyringTokenStore
- WHEN: getToken is called (simulating /auth status)
- THEN: Token is retrieved from SecureStore
**Why This Matters**: Status must read from the same store that login writes to.

### R17.7: Refresh Cycle

**Full Text**: Token refresh shall work: expire → lock → refresh → save → unlock.
**Behavior**:
- GIVEN: An expired token in KeyringTokenStore
- WHEN: Refresh cycle is simulated (acquire lock, save new token, release lock)
- THEN: Lock is acquired, token is updated, lock is released
**Why This Matters**: Background refresh is critical for session continuity.

### R18.1–R18.9: End-to-End Verification Flows

**Full Text**: Various end-to-end flows through KeyringTokenStore.
**Behavior**:
- GIVEN: KeyringTokenStore as the token storage backend
- WHEN: Various operations are performed (login, session start, refresh, renewal, failover, logout, status)
- THEN: Each operation works correctly through the keyring storage layer
**Why This Matters**: Comprehensive end-to-end coverage ensures nothing is missed.

### R18.6: Multi-Bucket Entries

**Full Text**: Multi-bucket configurations shall store each bucket as a separate keyring entry.
**Behavior**:
- GIVEN: provider='gemini', buckets=['default', 'work']
- WHEN: Tokens saved for both buckets
- THEN: SecureStore contains separate entries: 'gemini:default', 'gemini:work'
**Why This Matters**: Buckets must be independent.

### R18.7: Multi-Process Shared Storage

**Full Text**: Multiple processes share the same keyring storage; file locks prevent double-refresh.
**Behavior**:
- GIVEN: Two processes with separate KeyringTokenStore instances
- WHEN: Both attempt to read/write tokens
- THEN: Both see the same data; refresh locks coordinate correctly
**Why This Matters**: Users may have multiple terminal sessions.

## Implementation Tasks

### Files to Create

- `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
  - MUST include: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08`
  - MUST include: `@requirement` tags
  - Integration tests (NOT unit tests) covering:

  **Lifecycle Tests:**
  1. Full lifecycle: save → get → update → get → remove → get(null)
  2. Multi-provider: save anthropic + gemini + qwen → list → individual get → remove one → list shows two
  3. Multi-bucket: save gemini:default + gemini:work → listBuckets → get each → stats for each
  4. Codex round-trip: save token with account_id + id_token → get → verify extra fields preserved

  **Refresh Lock Integration:**
  5. Lock → refresh → save → unlock cycle (sequential)
  6. Stale lock recovery: write fake stale lock → acquire succeeds after break

  **Error Handling Integration:**
  7. Save with unavailable SecureStore → error propagates
  8. Get with corrupt data → null returned, no crash
  9. Remove with error → returns normally
  10. List with error → returns empty array

  **Concurrent Process Tests (spawned child processes):**
  11. Two processes: both read same token → both succeed
  12. Two processes: one refreshes (holds lock), other waits → second acquires after first releases
  13. Two processes: one refreshes, one removes → removal is best-effort

  **Multi-Instance Coherence:**
  14. Two KeyringTokenStore instances (same SecureStore) → save in one, read in other
  15. Save in one instance, list in another → consistent view

  **Property-Based Integration Tests:**
  16. Property: any sequence of save/get/remove for N providers produces consistent state
  17. Property: any sequence of lock/unlock is idempotent and consistent

  Each test has GIVEN/WHEN/THEN and @requirement tag.
  NO mock theater. Tests use real (injectable) SecureStore.
  30%+ property-based using fast-check.

### Files to Modify

None — TDD phase creates only test files.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P08
 * @requirement R[X].[Y]
 * @given [precondition]
 * @when [action]
 * @then [expected outcome]
 */
```

## Verification Commands

### Automated Checks (Structural)

```bash
# Verify test file exists
test -f packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts && echo "OK" || echo "FAIL"

# Count tests
grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 15+

# Check plan markers
grep -c "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 15+

# Check for mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 0

# Check for reverse testing
grep -c "NotYetImplemented" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: 0

# Property-based test count
TOTAL=$(grep -c "it(" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts)
PROPERTY=$(grep -c "fc\.\|test\.prop\|it\.prop" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts)
echo "Total: $TOTAL, Property: $PROPERTY"
# Expected: 30%+

# Run integration tests (some should pass now, some may fail until Phase 09 wiring)
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts 2>&1 | tail -10
```

### Structural Verification Checklist

- [ ] Integration test file created
- [ ] 15+ integration tests
- [ ] Plan and requirement markers present
- [ ] No mock theater
- [ ] No reverse testing
- [ ] 30%+ property-based tests
- [ ] Tests use injectable SecureStore (not OS keyring directly)

### Deferred Implementation Detection (MANDATORY)

N/A — TDD phase produces only test files.

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Do tests verify end-to-end flows?**
   - [ ] Lifecycle test covers save → get → update → remove
   - [ ] Multi-provider test uses 3+ providers simultaneously
   - [ ] Refresh test covers full lock → refresh → unlock cycle

2. **Are tests behavioral (not structural)?**
   - [ ] Tests verify actual token values, not just that calls completed
   - [ ] List tests verify specific provider/bucket names
   - [ ] Error tests verify specific error types and null returns

3. **Do concurrent tests use real concurrency?**
   - [ ] Spawned child processes (or at minimum, separate async operations)
   - [ ] Shared storage between concurrent actors
   - [ ] Lock contention is actually tested

4. **Is the feature REACHABLE?**
   - [ ] Tests import KeyringTokenStore from the public export
   - [ ] Tests simulate production usage patterns

5. **What's MISSING?**
   - [ ] Actual wiring into auth commands (Phase 09)
   - [ ] Legacy deletion (Phase 10)

## Success Criteria

- 15+ integration tests created
- Tests cover full lifecycle, multi-provider, multi-bucket, refresh locks, concurrent access
- 30%+ property-based tests
- No mock theater or reverse testing
- Tests that exercise KeyringTokenStore currently pass (unit-level operations)
- Wiring-dependent tests may fail until Phase 09

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
2. Or: `rm packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
3. Re-run Phase 08 with corrected test design
4. Cannot proceed to Phase 09 until integration tests are correct

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P08.md`
Contents:

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Created: [packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts with line count]
Files Modified: [none]
Tests Added: [count]
Property-Based Tests: [count and percentage]
Verification: [paste of test run output]
```

---

# Phase 09: Integration Implementation — Swap at All Sites

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P09`

## Prerequisites

- Required: Phase 08 completed (integration tests written)
- Verification: `grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P08" packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts`
- Expected files from previous phase:
  - `packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts` (integration tests)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R13.1: Replace All MultiProviderTokenStore Instantiation Sites

**Full Text**: All production sites that instantiate `MultiProviderTokenStore` shall be changed to use `KeyringTokenStore`.
**Behavior**:
- GIVEN: 6 production files instantiate `new MultiProviderTokenStore()`
- WHEN: Each site is changed to `new KeyringTokenStore()`
- THEN: All production code uses KeyringTokenStore for token operations
**Why This Matters**: This is the actual swap that makes tokens go to keyring instead of plaintext files.

### R13.3: Replace All Exports/Re-exports (completion)

**Full Text**: All exports and re-exports of `MultiProviderTokenStore` shall be replaced with `KeyringTokenStore`.
**Behavior**:
- GIVEN: Phase 07 already updated core/index.ts and cli/auth/types.ts
- WHEN: This phase ensures ALL remaining references are updated
- THEN: Zero references to MultiProviderTokenStore in production code (test file updates also here)
**Why This Matters**: Complete elimination of all references to the legacy class.

### R17.5: /auth login Stores in Keyring

**Full Text**: `/auth login` shall store tokens in keyring (not plaintext files).
**Behavior**:
- GIVEN: authCommand.ts now creates KeyringTokenStore instead of MultiProviderTokenStore
- WHEN: /auth login runs
- THEN: Token is stored via SecureStore (keyring/fallback), not plaintext
**Why This Matters**: This is the user-facing behavior change.

### R17.6: /auth status Reads from Keyring

**Full Text**: `/auth status` shall read tokens from keyring.
**Behavior**:
- GIVEN: authCommand.ts now uses KeyringTokenStore
- WHEN: /auth status runs
- THEN: Tokens are read from SecureStore, not plaintext files
**Why This Matters**: Status must read from the same store that login writes to.

### R18.1: Login Stores in Keyring/Fallback

**Full Text**: When `/auth login` completes, the token shall be stored in keyring (or encrypted fallback).
**Behavior**:
- GIVEN: authCommand.ts creates KeyringTokenStore
- WHEN: Login flow completes and calls saveToken
- THEN: Token goes to SecureStore (which handles keyring vs fallback transparently)
**Why This Matters**: End-to-end login flow must use new storage.

### R18.8: Logout Removes from Keyring/Fallback

**Full Text**: When `/auth logout` is called, `removeToken` shall delete from keyring (or encrypted fallback).
**Behavior**:
- GIVEN: authCommand.ts creates KeyringTokenStore
- WHEN: Logout calls removeToken
- THEN: Token removed from SecureStore
**Why This Matters**: Logout must remove from the correct store.

### R18.9: Status Reads from Keyring/Fallback

**Full Text**: When `/auth status` is called, `getToken` and `listBuckets` shall read from keyring (or encrypted fallback).
**Behavior**:
- GIVEN: authCommand.ts creates KeyringTokenStore
- WHEN: Status reads tokens and lists buckets
- THEN: Data comes from SecureStore
**Why This Matters**: Status display must reflect actual stored state.

## Pre-Implementation Discovery (MANDATORY)

Before making ANY changes, the worker MUST run a fresh codebase-wide grep to discover ALL instantiation sites. The fixed list below is a starting point, NOT the definitive source:

```bash
# MUST run this FIRST and compare output to the list below
grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v __tests__ | grep -v ".test.ts"
# If ANY sites appear that are NOT in the list below, add them to the changeset.
# If any listed sites no longer exist (code moved/renamed), update accordingly.
```

This prevents drift between plan-time assumptions and actual codebase state.

## Implementation Tasks

### Files to Modify

Referencing pseudocode from `analysis/pseudocode/wiring-and-elimination.md`:

1. **`packages/cli/src/runtime/runtimeContextFactory.ts`** (pseudocode lines 9-22)
   - CHANGE import: `MultiProviderTokenStore` → `KeyringTokenStore`
   - CHANGE import source if needed
   - CHANGE type: `let sharedTokenStore: MultiProviderTokenStore | null = null` → `let sharedTokenStore: KeyringTokenStore | null = null`
   - CHANGE instantiation: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`
   - Implements: `@requirement:R13.1`

2. **`packages/cli/src/ui/commands/authCommand.ts`** (pseudocode lines 23-34)
   - CHANGE import: `MultiProviderTokenStore` → `KeyringTokenStore`
   - CHANGE line ~40: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - CHANGE line ~662: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`
   - Implements: `@requirement:R13.1, R17.5, R17.6, R18.1, R18.8, R18.9`

3. **`packages/cli/src/ui/commands/profileCommand.ts`** (pseudocode lines 35-46)
   - CHANGE import: `MultiProviderTokenStore` → `KeyringTokenStore`
   - CHANGE line ~100: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - CHANGE line ~347: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`
   - Implements: `@requirement:R13.1`

4. **`packages/cli/src/providers/providerManagerInstance.ts`** (pseudocode lines 47-54)
   - CHANGE import: `MultiProviderTokenStore` → `KeyringTokenStore`
   - CHANGE line ~242: `new MultiProviderTokenStore()` → `new KeyringTokenStore()`
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`
   - Implements: `@requirement:R13.1`

5. **`packages/cli/src/providers/oauth-provider-registration.ts`** (pseudocode lines 55-63)
   - CHANGE import: `MultiProviderTokenStore` → use `TokenStore` interface type (or `KeyringTokenStore` if needed)
   - CHANGE parameter type if applicable
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`
   - Implements: `@requirement:R13.1`

6. **Test Files** (pseudocode lines 79-128) — Update ALL test files that reference MultiProviderTokenStore:
   - `packages/cli/src/integration-tests/oauth-timing.integration.test.ts` — update import + instantiation
   - `packages/cli/src/integration-tests/__tests__/oauth-buckets.integration.spec.ts` — update import + instantiation
   - `packages/cli/src/auth/oauth-manager-initialization.spec.ts` — update import + instantiation
   - `packages/cli/src/auth/oauth-manager.refresh-race.spec.ts` — update import + instantiation
   - `packages/cli/src/auth/__tests__/codex-oauth-provider.test.ts` — update import + instantiation
   - `packages/cli/test/auth/gemini-oauth-fallback.test.ts` — update import + type references
   - `packages/cli/test/ui/commands/authCommand-logout.test.ts` — update import + instantiation (multiple sites)
   - `packages/cli/src/ui/commands/__tests__/profileCommand.bucket.spec.ts` — update mock reference
   - ADD marker to each: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09`

### Required Code Markers

```typescript
// @plan PLAN-20260213-KEYRINGTOKENSTORE.P09
// @requirement R13.1
```

## Verification Commands

### Automated Checks (Structural)

```bash
# CRITICAL: Zero remaining references to MultiProviderTokenStore in production code
grep -rn "MultiProviderTokenStore" packages/core/src packages/cli/src --include="*.ts" | grep -v "node_modules" | grep -v ".test." | grep -v ".spec." | grep -v "__tests__"
# Expected: 0 matches in production code

# Check remaining references in test code (should also be zero or minimal)
grep -rn "MultiProviderTokenStore" packages/core/src packages/cli/src packages/cli/test --include="*.ts" | grep -v "node_modules"
# Expected: 0 matches (all tests updated)

# Check plan markers in modified files
grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P09" packages/cli/src packages/core/src | wc -l
# Expected: 10+ (across all modified files)

# TypeScript compiles
npm run typecheck
# Expected: No errors

# All tests pass
npm test -- --run
# Expected: All pass

# Integration tests pass
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
# Expected: All pass

# Lint passes
npm run lint
# Expected: No errors

# Build succeeds
npm run build
# Expected: Success
```

### Structural Verification Checklist

- [ ] Zero MultiProviderTokenStore references in production code
- [ ] Zero MultiProviderTokenStore references in test code
- [ ] All 5 production files updated
- [ ] All 8+ test files updated
- [ ] Plan markers in all modified files
- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] Lint passes
- [ ] Build succeeds

### Deferred Implementation Detection (MANDATORY)

```bash
# Check modified production files
for file in packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/authCommand.ts packages/cli/src/ui/commands/profileCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/providers/oauth-provider-registration.ts; do
  echo "=== $file ==="
  grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" "$file" | head -3
done
# Expected: No matches

# Check for leftover MultiProviderTokenStore in comments
grep -rn "MultiProviderTokenStore" packages/cli/src packages/core/src --include="*.ts" | grep -v "node_modules"
# Expected: 0 matches (even in comments — clean elimination)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] R13.1: Every `new MultiProviderTokenStore()` is now `new KeyringTokenStore()`
   - [ ] Verified by grep: zero remaining references
   - [ ] Import statements updated correctly

2. **Is this REAL implementation, not placeholder?**
   - [ ] Each import actually resolves to KeyringTokenStore class
   - [ ] Each instantiation creates a working KeyringTokenStore
   - [ ] No commented-out old code left behind

3. **Would the test FAIL if implementation was removed?**
   - [ ] If KeyringTokenStore export was removed, TypeScript would fail
   - [ ] If wiring was reverted, integration tests would fail

4. **Is the feature REACHABLE by users?**
   - [ ] YES — authCommand.ts now creates KeyringTokenStore
   - [ ] /auth login → KeyringTokenStore.saveToken → SecureStore
   - [ ] /auth status → KeyringTokenStore.getToken → SecureStore
   - [ ] /auth logout → KeyringTokenStore.removeToken → SecureStore

5. **What's MISSING?**
   - [ ] Deletion of MultiProviderTokenStore class (Phase 10)
   - [ ] Final verification (Phase 11)

#### Feature Actually Works

```bash
# Smoke test: Run the CLI and verify auth commands work
# (This requires the full build)
npm run build
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Starts without token-store-related errors

# Full test suite
npm test -- --run
# Expected: All pass

# Specific auth tests
npm test -- --run --grep "auth\|token\|oauth" 2>&1 | tail -20
# Expected: All pass
```

#### Integration Points Verified

- [ ] runtimeContextFactory creates KeyringTokenStore (shared instance)
- [ ] authCommand creates KeyringTokenStore for login/logout/status
- [ ] profileCommand creates KeyringTokenStore for profile operations
- [ ] providerManagerInstance creates KeyringTokenStore for provider init
- [ ] All test files import and use KeyringTokenStore

## Success Criteria

- Zero MultiProviderTokenStore references in entire codebase (production + tests)
- All 5 production files updated with KeyringTokenStore
- All 8+ test files updated
- TypeScript compiles
- All tests pass (unit + integration)
- Lint passes
- Build succeeds

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/cli/src/runtime/runtimeContextFactory.ts packages/cli/src/ui/commands/authCommand.ts packages/cli/src/ui/commands/profileCommand.ts packages/cli/src/providers/providerManagerInstance.ts packages/cli/src/providers/oauth-provider-registration.ts packages/core/index.ts packages/cli/src/auth/types.ts`
2. Also revert test files: `git checkout -- packages/cli/src/integration-tests/ packages/cli/src/auth/ packages/cli/test/`
3. Re-run Phase 09 with corrected approach
4. Cannot proceed to Phase 10 until all tests pass

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P09.md`
Contents:

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [list all 13+ modified files with diff stats]
Tests Added: 0 (tests from Phase 05 + 08 still pass)
Production Files Updated: 5
Test Files Updated: 8+
Verification: [paste of grep showing 0 MultiProviderTokenStore references, test output, typecheck output]
```

---

# Phase 10: Eliminate Legacy — Delete MultiProviderTokenStore

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P10`

## Prerequisites

- Required: Phase 09 completed (all sites wired to KeyringTokenStore, zero MultiProviderTokenStore references)
- Verification: `grep -r "MultiProviderTokenStore" packages/core/src packages/cli/src packages/cli/test --include="*.ts" | grep -v node_modules | wc -l` returns 0
- **HARD GATE**: Do NOT proceed if the above grep returns ANY matches. P09 must achieve zero references in production AND test code before deletion begins. This is a safety interlock — deleting the class while references exist causes compile failure.
- Expected files from previous phase:
  - All production and test files updated in Phase 09
  - All tests passing
  - `npm run typecheck` passes (proves zero dangling references)
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R13.2: Delete MultiProviderTokenStore Class

**Full Text**: `MultiProviderTokenStore` shall be deleted from the codebase. The `TokenStore` interface shall be preserved.
**Behavior**:
- GIVEN: MultiProviderTokenStore class exists in `packages/core/src/auth/token-store.ts` alongside the TokenStore interface
- WHEN: The class (and its associated LockInfo interface and unused imports) are deleted
- THEN: token-store.ts contains ONLY the TokenStore interface and its necessary type imports; MultiProviderTokenStore class is gone
**Why This Matters**: Dead code must be removed. The class is no longer imported anywhere, keeping it would cause confusion.

### R16.2: No Code Reads Old Plaintext Files

**Full Text**: No code shall read, migrate, or acknowledge the old `~/.llxprt/oauth/*.json` plaintext token files. Old files are inert.
**Behavior**:
- GIVEN: MultiProviderTokenStore was the code that read/wrote `~/.llxprt/oauth/*.json` files
- WHEN: It is deleted
- THEN: No production code references `~/.llxprt/oauth/*.json` or reads plaintext token files
**Why This Matters**: Clean cut — the old storage mechanism is completely gone.

## Implementation Tasks

### Files to Modify

Referencing pseudocode from `analysis/pseudocode/wiring-and-elimination.md` lines 64-73:

1. **`packages/core/src/auth/token-store.ts`** (pseudocode lines 64-73)
   - **PRESERVE**: `TokenStore` interface (all 8 methods + JSDoc)
   - **PRESERVE**: Imports used by TokenStore interface: `OAuthToken`, `OAuthTokenSchema`, `BucketStats` from `./types.js`
   - **DELETE**: `LockInfo` interface
   - **DELETE**: `MultiProviderTokenStore` class (entire class, ~250 lines)
   - **DELETE**: Unused imports that were only used by MultiProviderTokenStore:
     - `promises as fs` from `'fs'` (if only used by the class)
     - `join` from `'path'` (if only used by the class)
     - `homedir` from `'os'` (if only used by the class)
   - **KEEP**: `import { type OAuthToken, OAuthTokenSchema, type BucketStats } from './types.js'`
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P10`
   - Implements: `@requirement:R13.2`

   **RESULT**: token-store.ts is ~90 lines (interface only), down from ~350 lines.

2. **`packages/core/src/auth/token-store.spec.ts`** — DELETE or RENAME
   - This test file tested MultiProviderTokenStore
   - If Phase 09 already rewrote tests → may just need import cleanup
   - If tests still reference MultiProviderTokenStore → delete the file
   - New tests are in `keyring-token-store.test.ts` (Phase 05)
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P10`

3. **`packages/core/src/auth/token-store.refresh-race.spec.ts`** — DELETE or RENAME
   - This test file tested MultiProviderTokenStore's lock mechanism
   - New lock tests are in `keyring-token-store.test.ts` (Phase 05)
   - ADD marker: `@plan:PLAN-20260213-KEYRINGTOKENSTORE.P10`

### Required Code Markers

```typescript
// @plan PLAN-20260213-KEYRINGTOKENSTORE.P10
// @requirement R13.2
```

## Verification Commands

### Automated Checks (Structural)

```bash
# CRITICAL: MultiProviderTokenStore class no longer exists
grep "class MultiProviderTokenStore" packages/core/src/auth/token-store.ts
# Expected: 0 matches

# CRITICAL: TokenStore interface STILL exists
grep "interface TokenStore" packages/core/src/auth/token-store.ts
# Expected: 1 match

# CRITICAL: Zero references to MultiProviderTokenStore ANYWHERE in codebase
grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v "node_modules" | grep -v "project-plans"
# Expected: 0 matches

# CRITICAL: Zero export/re-export of MultiProviderTokenStore in index files or barrel exports
grep -rn "export.*MultiProviderTokenStore" packages/ --include="*.ts" | grep -v "node_modules" | grep -v "project-plans"
# Expected: 0 matches (stale exports would cause build failure)

# Verify token-store.ts is small (interface only)
wc -l packages/core/src/auth/token-store.ts
# Expected: ~90 lines (interface + imports + license)

# Verify LockInfo is gone
grep "interface LockInfo" packages/core/src/auth/token-store.ts
# Expected: 0 matches

# Verify no code reads ~/.llxprt/oauth/*.json
grep -rn "\.llxprt/oauth.*\.json\|oauth.*\.json" packages/ --include="*.ts" | grep -v "node_modules" | grep -v "project-plans" | grep -v ".test." | grep -v ".spec."
# Expected: 0 matches in production code (lock files in locks/ subdir are OK)

# TypeScript compiles
npm run typecheck
# Expected: No errors

# All tests pass
npm test -- --run
# Expected: All pass

# Lint passes
npm run lint
# Expected: No errors

# Build succeeds
npm run build
# Expected: Success

# Plan marker present
grep "@plan:PLAN-20260213-KEYRINGTOKENSTORE.P10" packages/core/src/auth/token-store.ts
# Expected: 1 match
```

### Structural Verification Checklist

- [ ] MultiProviderTokenStore class deleted
- [ ] TokenStore interface preserved
- [ ] LockInfo interface deleted
- [ ] Unused imports removed
- [ ] Old test files deleted or updated
- [ ] Zero references to MultiProviderTokenStore in codebase
- [ ] TypeScript compiles
- [ ] All tests pass
- [ ] Lint passes
- [ ] Build succeeds

### Deferred Implementation Detection (MANDATORY)

```bash
# Verify no deferred work in remaining token-store.ts
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/token-store.ts
# Expected: No matches

# Verify no commented-out MultiProviderTokenStore code
grep -rn "MultiProviderTokenStore" packages/core/src/auth/token-store.ts
# Expected: 0 matches (not even in comments)

# Verify no residual plaintext file operations
grep -rn "fs\.readFile\|fs\.writeFile\|fs\.unlink\|fs\.readdir" packages/core/src/auth/token-store.ts
# Expected: 0 matches (all fs operations were in the deleted class)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] R13.2: MultiProviderTokenStore is deleted, TokenStore preserved
   - [ ] R16.2: No code reads old plaintext files
   - [ ] Verified by reading token-store.ts — only interface remains

2. **Is this REAL elimination, not hiding?**
   - [ ] Class is deleted, not commented out
   - [ ] No `// TODO: remove later` comments
   - [ ] grep confirms zero references anywhere

3. **Would the test FAIL if the interface was broken?**
   - [ ] KeyringTokenStore implements TokenStore — changing the interface would break compilation
   - [ ] All Phase 05 + 08 tests still pass

4. **Is the feature REACHABLE by users?**
   - [ ] YES — all wiring done in Phase 09
   - [ ] This phase only removes dead code

5. **What's MISSING?**
   - [ ] Final verification (Phase 11)

#### Feature Actually Works

```bash
# Full test suite
npm test -- --run
# Expected: All pass

# Build
npm run build
# Expected: Success

# Smoke test
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Runs without errors
```

## Success Criteria

- MultiProviderTokenStore class deleted from codebase
- TokenStore interface preserved
- Zero references to MultiProviderTokenStore anywhere (production + tests)
- No code reads/writes plaintext token files
- TypeScript compiles
- All tests pass
- Lint passes
- Build succeeds

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/core/src/auth/token-store.ts`
2. If test files were deleted: `git checkout -- packages/core/src/auth/token-store.spec.ts packages/core/src/auth/token-store.refresh-race.spec.ts`
3. Re-run Phase 10 with corrected approach
4. Cannot proceed to Phase 11 until elimination is clean

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P10.md`
Contents:

```markdown
Phase: P10
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [packages/core/src/auth/token-store.ts — reduced to ~90 lines]
Files Deleted: [token-store.spec.ts, token-store.refresh-race.spec.ts if applicable]
Tests Added: 0
Verification: [paste of grep showing 0 MultiProviderTokenStore references, test output]
Lines Deleted: ~300 (class + tests)
```

---

# Phase 11: Final Verification — Full Suite, Smoke Test, End-to-End

## Phase ID

`PLAN-20260213-KEYRINGTOKENSTORE.P11`

## Prerequisites

- Required: Phase 10 completed (MultiProviderTokenStore deleted, codebase clean)
- Verification: `grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | wc -l` returns 0
- Expected files from previous phase:
  - `packages/core/src/auth/token-store.ts` (interface only, ~90 lines)
  - All tests passing
  - Build succeeding
- Preflight verification: Phase 01 MUST be completed

## Requirements Implemented (Expanded)

### R15.2: Equivalent Coverage for Both Paths

**Full Text**: Both the keyring path and the fallback path shall have equivalent behavioral test coverage, exercised in separate CI jobs.
**Behavior**:
- GIVEN: Tests exist for both keyring-available and keyring-unavailable scenarios
- WHEN: The full test suite runs
- THEN: Both code paths are exercised and pass
**Why This Matters**: The fallback path must not be a second-class citizen.

### R16.2: No Old Plaintext File Reading

**Full Text**: No code shall read, migrate, or acknowledge the old `~/.llxprt/oauth/*.json` plaintext token files.
**Behavior**:
- GIVEN: Complete codebase scan
- WHEN: Searching for plaintext token file operations
- THEN: Zero results
**Why This Matters**: Final confirmation of clean cut.

### R16.3: --key Flag Unaffected

**Full Text**: The `--key` flag for API key authentication shall remain unaffected.
**Behavior**:
- GIVEN: API key authentication uses ProviderKeyStorage (separate from TokenStore)
- WHEN: --key flag is used
- THEN: Works exactly as before (no regression)
**Why This Matters**: API key auth must not be collateral damage from token store changes.

### R17.1: Equivalent Test Coverage

**Full Text**: All TokenStore interface behaviors shall have equivalent coverage in new tests.
**Behavior**:
- GIVEN: All tests from Phase 05 + Phase 08
- WHEN: Coverage is analyzed
- THEN: Every TokenStore method has behavioral tests
**Why This Matters**: No regression in test quality.

### R17.2: Multiprocess Race Conditions Tested

**Full Text**: Tested with spawned child processes.
**Behavior**:
- GIVEN: Integration tests include concurrent process tests
- WHEN: Tests run
- THEN: Lock contention scenarios are verified
**Why This Matters**: Real-world concurrency must be tested.

### R17.3: Full Lifecycle Works

**Full Text**: login → store → read → refresh → logout.
**Behavior**:
- GIVEN: Integration tests include lifecycle test
- WHEN: Full lifecycle is exercised
- THEN: Each step produces correct state
**Why This Matters**: End-to-end validation of the complete flow.

### R17.4: Multiple Providers Simultaneously

**Full Text**: e.g., anthropic + gemini each in keyring.
**Behavior**:
- GIVEN: Integration tests include multi-provider test
- WHEN: Multiple providers are used concurrently
- THEN: No cross-contamination
**Why This Matters**: Most users have multiple providers.

### R17.5–R17.8: End-to-End Flows

**Full Text**: /auth login stores, /auth status reads, refresh cycle works, CI exercises both paths.
**Behavior**:
- GIVEN: All wiring complete
- WHEN: Auth commands are exercised
- THEN: All flows work through KeyringTokenStore
**Why This Matters**: Final validation of user-facing behavior.

### R18.1–R18.9: End-to-End Verification Flows

**Full Text**: All end-to-end flows through KeyringTokenStore.
**Behavior**:
- GIVEN: Complete integration
- WHEN: Each flow is verified
- THEN: All pass
**Why This Matters**: Comprehensive final verification.

## Implementation Tasks

This phase produces NO new code. It runs comprehensive verification.

### Verification Steps

1. **Full Test Suite**
   ```bash
   npm test -- --run
   ```

2. **TypeScript Compilation**
   ```bash
   npm run typecheck
   ```

3. **Linting**
   ```bash
   npm run lint
   ```

4. **Formatting**
   ```bash
   npm run format
   ```

5. **Build**
   ```bash
   npm run build
   ```

6. **Smoke Test**
   ```bash
   node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
   ```

7. **Zero Legacy References**
   ```bash
   grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans
   # Must return 0 results
   ```

8. **Zero Plaintext Token File Operations**
   ```bash
   grep -rn "\.llxprt/oauth.*\.json" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | grep -v "locks/"
   # Must return 0 results
   ```

9. **KeyringTokenStore Tests Pass**
   ```bash
   npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts
   npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts
   ```

10. **All Plan Markers Present**
    ```bash
    grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE" packages/ --include="*.ts" | wc -l
    # Should be 50+ across all phases
    ```

11. **All Requirement Markers Present**
    ```bash
    grep -r "@requirement" packages/core/src/auth/keyring-token-store.ts | wc -l
    # Should be 10+
    ```

12. **Verify Traceability**
    ```bash
    # Every requirement should have at least one test AND one implementation reference
    for req in R1.1 R1.2 R1.3 R2.1 R2.2 R2.3 R3.1 R3.3 R4.1 R4.3 R5.1 R6.1 R8.1 R9.1 R13.1 R13.2; do
      impl=$(grep -c "$req" packages/core/src/auth/keyring-token-store.ts 2>/dev/null)
      test=$(grep -c "$req" packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>/dev/null)
      echo "$req: impl=$impl test=$test"
    done
    ```

### Required Code Markers

No new code markers — this is a verification-only phase.

## Verification Commands

### Automated Checks (Structural)

```bash
# COMPREHENSIVE VERIFICATION SCRIPT
echo "=== 1. Full Test Suite ==="
npm test -- --run 2>&1 | tail -5

echo "=== 2. TypeScript Compilation ==="
npm run typecheck 2>&1 | tail -3

echo "=== 3. Lint ==="
npm run lint 2>&1 | tail -3

echo "=== 4. Format ==="
npm run format 2>&1 | tail -3

echo "=== 5. Build ==="
npm run build 2>&1 | tail -3

echo "=== 6. Zero Legacy References ==="
LEGACY_COUNT=$(grep -rn "MultiProviderTokenStore" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | wc -l)
echo "MultiProviderTokenStore references: $LEGACY_COUNT"
[ "$LEGACY_COUNT" -ne 0 ] && echo "FAIL: Legacy references remain"

echo "=== 7. Zero Plaintext Token Ops ==="
PLAINTEXT_COUNT=$(grep -rn "\.llxprt/oauth.*\.json" packages/ --include="*.ts" | grep -v node_modules | grep -v project-plans | grep -v "locks/" | wc -l)
echo "Plaintext token file references: $PLAINTEXT_COUNT"
[ "$PLAINTEXT_COUNT" -ne 0 ] && echo "FAIL: Plaintext file operations remain"

echo "=== 8. KeyringTokenStore Tests ==="
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.test.ts 2>&1 | tail -3
npm test -- --run packages/core/src/auth/__tests__/keyring-token-store.integration.test.ts 2>&1 | tail -3

echo "=== 9. Plan Markers ==="
MARKERS=$(grep -r "@plan:PLAN-20260213-KEYRINGTOKENSTORE" packages/ --include="*.ts" | wc -l)
echo "Plan markers found: $MARKERS"

echo "=== 10. Smoke Test ==="
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else" 2>&1 | tail -5
```

### Structural Verification Checklist

- [ ] Full test suite passes
- [ ] TypeScript compiles
- [ ] Lint passes
- [ ] Format is clean
- [ ] Build succeeds
- [ ] Smoke test works
- [ ] Zero MultiProviderTokenStore references
- [ ] Zero plaintext token file operations
- [ ] All plan markers present
- [ ] All requirement markers present
- [ ] Traceability: every requirement has impl + test

### Deferred Implementation Detection (MANDATORY)

```bash
# Final scan of ALL new/modified files
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/keyring-token-store.ts
# Expected: No matches

grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/keyring-token-store.ts | grep -v "// R" | grep -v "degraded\|not found\|best-effort"
# Expected: Only legitimate null/[] returns (documented by requirement)
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the entire feature work end-to-end?**
   - [ ] Token save through KeyringTokenStore reaches SecureStore
   - [ ] Token read through KeyringTokenStore retrieves from SecureStore
   - [ ] Token delete through KeyringTokenStore removes from SecureStore
   - [ ] List operations enumerate providers and buckets correctly
   - [ ] Lock mechanism coordinates concurrent processes
   - [ ] Corrupt data is handled gracefully

2. **Is this REAL, not a facade?**
   - [ ] Smoke test actually starts the application
   - [ ] No errors related to token storage
   - [ ] Build artifacts include KeyringTokenStore

3. **Is the feature REACHABLE by users?**
   - [ ] /auth login → KeyringTokenStore.saveToken → SecureStore [OK]
   - [ ] /auth status → KeyringTokenStore.getToken/listProviders → SecureStore [OK]
   - [ ] /auth logout → KeyringTokenStore.removeToken → SecureStore [OK]
   - [ ] Background refresh → KeyringTokenStore.acquireRefreshLock → lock file [OK]

4. **Are there any gaps?**
   - [ ] R16.3: --key flag still works (API key path unaffected)
   - [ ] R15.1: Fallback path works (tested with unavailable keyring)
   - [ ] R14.1: Probe-once is satisfied by shared instance in runtimeContextFactory

5. **What's MISSING?**
   - [ ] Nothing — this is the final verification phase
   - [ ] (If anything is found, it must be fixed before marking complete)

#### Feature Actually Works

```bash
# Smoke test with actual CLI
node scripts/start.js --profile-load synthetic --keyfile ~/.llxprt/keys/.synthetic2_key "write me a haiku and nothing else"
# Expected: Completes successfully, no token-store errors
# Actual: [PASTE OUTPUT HERE]
```

#### Edge Cases Verified

- [ ] Empty token store (fresh install) → all operations work
- [ ] Multiple providers → independent storage
- [ ] Invalid provider name → clear error message
- [ ] Corrupt data in store → graceful null return with warning
- [ ] Lock contention → second process waits, then succeeds

## Success Criteria

- ALL verification steps pass
- Full test suite: 100% pass rate
- TypeScript: zero errors
- Lint: zero errors
- Build: succeeds
- Smoke test: runs without errors
- Zero legacy references
- Zero plaintext file operations
- All plan markers traceable
- All requirements traceable to impl + tests

## Failure Recovery

If this phase fails:

1. Identify the specific failure
2. Determine which phase introduced the issue
3. Revert to that phase and re-implement
4. Re-run Phase 11 verification

## Phase Completion Marker

Create: `project-plans/issue1351_1352/.completed/P11.md`
Contents:

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created: [none]
Files Modified: [none]
Tests Added: 0

## Final Verification Results
- Full Test Suite: [PASS/FAIL with count]
- TypeScript: [PASS/FAIL]
- Lint: [PASS/FAIL]
- Build: [PASS/FAIL]
- Smoke Test: [PASS/FAIL]
- Legacy References: [count — must be 0]
- Plaintext File Ops: [count — must be 0]
- Plan Markers: [count]
- Requirement Markers: [count]

## Holistic Assessment
[Written assessment of the complete feature]
```
