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
