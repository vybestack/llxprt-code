# Phase 05: Schema Split Verification + Cleanup

## Phase ID

`PLAN-20260325-HOOKSPLIT.P05`

## Prerequisites

- Required: Phase 04a (Schema Split TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P04a.md`
- Expected files from previous phase: Updated tests in `settingsSchema.test.ts`

## Requirements Implemented (Expanded)

### REQ-211-S01: New `hooksConfig` Settings Key

**Full Text**: The settings schema shall define a top-level `hooksConfig` key of type `object` with properties: `enabled` (boolean, default `false`), `disabled` (array of strings, default `[]`), `notifications` (boolean, default `true`).
**Behavior**:
- GIVEN: Settings schema
- WHEN: hooksConfig is inspected
- THEN: All three properties exist with correct types and defaults
**Why This Matters**: Foundation for all downstream changes.

### REQ-211-S02: `hooks` Contains Only Event Definitions

**Full Text**: The `hooks` settings schema shall not define `enabled`, `disabled`, or `notifications` as properties.
**Behavior**:
- GIVEN: Updated settings schema
- WHEN: `hooks.properties` is inspected
- THEN: Only event-related properties exist (or no properties, with additionalProperties for events)
**Why This Matters**: Eliminates type confusion at the schema level.

### REQ-211-S03: `hooksConfig` Merge Strategy

**Full Text**: `hooksConfig` shall use `SHALLOW_MERGE`.
**Behavior**:
- GIVEN: Multiple scope settings with different hooksConfig values
- WHEN: Merged
- THEN: Individual fields override; unset fields inherited
**Why This Matters**: Correct merge behavior across scopes.

### REQ-211-SM01: `hooksConfig` Is Merged Across Scopes

**Full Text**: The `mergeSettings()` function shall merge `hooksConfig` objects from all scopes using shallow merge.
**Behavior**:
- GIVEN: User `hooksConfig: { enabled: true }` and workspace `hooksConfig: { disabled: ['x'] }`
- WHEN: Settings are merged
- THEN: Result has `enabled: true` and `disabled: ['x']`
**Why This Matters**: Ensures scope precedence works correctly.

## Implementation Tasks

### Note: Main Work Was Done in P03

The schema structure changes AND the `getEnableHooks()` update were already made in P03 (Schema Split + Helper Update). Schema definitions are declarative — the definition IS the implementation — and `getEnableHooks()` was updated in the same phase to keep typecheck green.

**This phase is primarily verification and cleanup**: confirm that all P04 TDD tests pass with the P03 implementation, fix any issues found during TDD, and verify pseudocode compliance. It is NOT a primary implementation phase.

### Files to Verify/Fix

- `packages/cli/src/config/settingsSchema.ts`
  - Verify `hooksConfig` schema entry is complete (from P03)
  - Verify `hooks` properties are cleaned (from P03)
  - Verify `getEnableHooks()` reads `hooksConfig?.enabled` (from P03)
  - Fix any issues found during TDD

### Verification Against Pseudocode

From `analysis/pseudocode/schema-split.md`:
- Lines 01-27: hooksConfig schema definition — verify complete
- Lines 28-37: hooks modification — verify config fields removed
- Lines 39-42: getEnableHooks update — verify reads hooksConfig
- Lines 44-46: getEnableHooksUI unchanged — verify no change

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P05
 * @requirement:REQ-211-S01, REQ-211-S02, REQ-211-S03
 * @pseudocode schema-split.md lines 01-46
 */
```

## Verification Commands

### Automated Checks

```bash
# All schema tests pass
npm test -- packages/cli/src/config/settingsSchema.test.ts
# Expected: All pass

# TypeScript compiles
npm run typecheck
# Expected: Exit 0

# Verify plan markers for P03 and P05
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P0[35]" packages/cli/src/config/settingsSchema.ts
# Expected: 1+

# Verify no old-format reads in getEnableHooks
grep "getEnableHooks" packages/cli/src/config/settingsSchema.ts | grep -v "hooksConfig\|function\|export\|\/\/"
# Expected: No matches (all reads go through hooksConfig)
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] `SETTINGS_SCHEMA.hooksConfig` has `enabled`, `disabled`, `notifications`
   - [ ] `SETTINGS_SCHEMA.hooks` has no config fields in `properties`
   - [ ] `getEnableHooks()` reads `hooksConfig?.enabled`
   - [ ] `hooksConfig` has `mergeStrategy: SHALLOW_MERGE`

2. **Is this REAL implementation, not placeholder?**
   - [ ] Schema has real types, defaults, descriptions
   - [ ] `getEnableHooks()` has real logic change

3. **Would the test FAIL if implementation was removed?**
   - [ ] P04 tests verify the new path — they'd fail with old code

4. **Is the feature REACHABLE?**
   - [ ] Settings type inferred from schema — type changes propagate automatically

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/config/settingsSchema.ts | grep -v "loading of hooks based on workspace"
# Expected: No new deferred work markers

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/config/settingsSchema.ts
# Expected: No matches
```

## Success Criteria

- All P04 tests pass
- TypeScript compiles cleanly
- Schema structure correct per specification
- `getEnableHooks()` reads from `hooksConfig`
- No deferred implementation markers

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settingsSchema.ts`
2. Re-read pseudocode `schema-split.md`
3. Fix issues identified by failing tests
4. Re-run verification

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P05.md`
