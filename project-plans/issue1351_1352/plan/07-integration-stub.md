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
