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
