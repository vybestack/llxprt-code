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
