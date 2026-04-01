# Phase 11: Core Config Type Implementation

## Phase ID

`PLAN-20260325-HOOKSPLIT.P11`

## Prerequisites

- Required: Phase 10a (Config Types TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P10a.md`
- Expected files from previous phase: Tests for Config type changes in hook system test files

## Requirements Implemented (Expanded)

### REQ-211-CC01: Config Constructor Uses `disabledHooks` Param

**Full Text**: Config constructor initializes disabled hooks from `disabledHooks` parameter.
**Why This Matters**: Eliminates post-construction hack.

### REQ-211-CC02: `projectHooks` Type Is Pure Event Map

**Full Text**: Private field and return type are `{ [K in HookEventName]?: HookDefinition[] }`.
**Why This Matters**: Type safety — no `disabled` pseudo-key in event map.

### REQ-211-CC03: SettingsService Persistence Key Updated

**Full Text**: Both get and set use `'hooksConfig.disabled'`.
**Why This Matters**: Matches new schema path.

## Implementation Tasks

### Verification That P09 Changes Are Complete

The Config type changes were already made in P09 (stub phase), because type changes and one-line additions are small enough to be the implementation. This phase:

1. Verifies all P10 tests pass with P09 changes
2. Fixes any issues found during TDD
3. Ensures no remaining old-format patterns

### Files to Verify/Fix

- `packages/core/src/config/config.ts`
  - Verify `projectHooks` private field type (should be clean from P09)
  - Verify constructor wiring (should be done from P09)
  - Verify `getProjectHooks()` return type (should be clean from P09)
  - Verify persistence keys (should be changed from P09)
  - Fix any issues found by P10 tests
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P11` marker
  - ADD `@pseudocode config-types.md lines 01-32` reference

### Pseudocode Compliance Check

From `analysis/pseudocode/config-types.md`:
- Lines 01-05: Private field type — verify clean
- Lines 07-12: Constructor wiring — verify `this.disabledHooks = params.disabledHooks ?? []`
- Lines 14-19: getProjectHooks return type — verify clean
- Lines 21-27: getDisabledHooks key — verify `'hooksConfig.disabled'`
- Lines 29-32: setDisabledHooks key — verify `'hooksConfig.disabled'`

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P11
 * @requirement:REQ-211-CC01, REQ-211-CC02, REQ-211-CC03
 * @pseudocode config-types.md lines 01-32
 */
```

## Verification Commands

### Automated Checks

```bash
# All hook system tests pass
npm test -- packages/core/src/hooks/
# Expected: All pass

# TypeScript compiles
npm run typecheck

# No old persistence key
grep "'hooks.disabled'" packages/core/src/config/config.ts
# Expected: 0 matches

# New persistence key present
grep "'hooksConfig.disabled'" packages/core/src/config/config.ts
# Expected: 2 matches (get + set)

# Constructor wiring present
grep "this.disabledHooks.*params" packages/core/src/config/config.ts
# Expected: 1 match

# Plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P\(09\|11\)" packages/core/src/config/config.ts
# Expected: 1+
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
   - [ ] Constructor wires disabledHooks
   - [ ] projectHooks type is clean
   - [ ] Persistence key is hooksConfig.disabled

2. **Is this REAL implementation, not placeholder?**
   - [ ] No TODO/FIXME/STUB markers in modified areas

3. **Would the test FAIL if implementation was removed?**
   - [ ] P10 tests verify constructor wiring and key changes

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/config/config.ts | grep -i "disabled\|hooks\|project" | grep -v "loading of hooks"
# Expected: No deferred work in modified areas
```

## Success Criteria

- All P10 tests pass
- TypeScript compiles
- Pseudocode compliance confirmed
- No old-format patterns remain
- No deferred implementation

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/config/config.ts`
2. Re-read pseudocode `config-types.md`
3. Fix issues identified by failing tests

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P11.md`
