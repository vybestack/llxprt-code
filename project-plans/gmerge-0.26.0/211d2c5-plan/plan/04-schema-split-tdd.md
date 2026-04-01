# Phase 04: Schema Split TDD

## Phase ID

`PLAN-20260325-HOOKSPLIT.P04`

## Prerequisites

- Required: Phase 03a (Schema Split Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P03a.md`
- Expected files from previous phase: Modified `packages/cli/src/config/settingsSchema.ts` with hooksConfig schema

## Requirements Implemented (Expanded)

### REQ-211-S01: New `hooksConfig` Settings Key

**Full Text**: The settings schema shall define a top-level `hooksConfig` key of type `object` with properties: `enabled`, `disabled`, `notifications`.
**Behavior**:
- GIVEN: `SETTINGS_SCHEMA` is accessed
- WHEN: `hooksConfig` key is inspected
- THEN: It has type `'object'`, properties for `enabled` (boolean, default false), `disabled` (array, default []), `notifications` (boolean, default true)
**Why This Matters**: Schema defines the type system that all other code depends on.

### REQ-211-T01: Schema Helper Tests Updated

**Full Text**: All tests for `getEnableHooks()` and `getEnableHooksUI()` shall use the new `hooksConfig` settings structure.
**Behavior**:
- GIVEN: Tests for `getEnableHooks()`
- WHEN: Tests pass `hooksConfig: { enabled: true }` (new format)
- THEN: `getEnableHooks()` returns `true`
- AND WHEN: Tests pass only `hooks: { enabled: true }` (old format, no migration)
- THEN: `getEnableHooks()` returns `false` (old path no longer read by this function)
**Why This Matters**: Tests must verify the function reads from the correct location.

### REQ-211-C01: `enableHooks` Reads from `hooksConfig`

**Full Text**: `getEnableHooks()` reads `settings.hooksConfig?.enabled` instead of `settings.hooks?.enabled`.
**Behavior**:
- GIVEN: Settings with `hooksConfig: { enabled: true }`
- WHEN: `getEnableHooks(settings)` is called
- THEN: Returns `true`
**Why This Matters**: Without this, hooks can never be enabled via the new schema path.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/config/settingsSchema.test.ts`
  - UPDATE existing `getEnableHooks` test suite (around lines 337-373)
  - Change all tests to use `hooksConfig: { enabled: ... }` instead of `hooks: { enabled: ... }`
  - ADD test: `hooks: { enabled: true }` alone does NOT enable hooks (verifies old path removed)
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P04` marker to updated tests
  - ADD `@requirement:REQ-211-T01` and `@requirement:REQ-211-C01` markers

### Test Cases Required

Since this is a REFACTORING task, tests verify the new behavior of `getEnableHooks()`:

1. **Test: Returns false when no settings provided** (existing, unchanged)
   - `getEnableHooks({} as Settings)` → `false`

2. **Test: Returns false when only tools.enableHooks is true** (update input)
   - `getEnableHooks({ tools: { enableHooks: true } } as Settings)` → `false`
   - (hooksConfig.enabled defaults to false)

3. **Test: Returns true when hooksConfig.enabled is true** (NEW — replaces hooks.enabled test)
   - `getEnableHooks({ hooksConfig: { enabled: true } } as Settings)` → `true`

4. **Test: Returns true when both gates explicitly true** (update input)
   - `getEnableHooks({ tools: { enableHooks: true }, hooksConfig: { enabled: true } } as Settings)` → `true`

5. **Test: Returns false when tools.enableHooks is false** (update input)
   - `getEnableHooks({ tools: { enableHooks: false }, hooksConfig: { enabled: true } } as Settings)` → `false`

6. **Test: Returns false when hooksConfig.enabled is false** (update input)
   - `getEnableHooks({ tools: { enableHooks: true }, hooksConfig: { enabled: false } } as Settings)` → `false`

7. **Test: OLD PATH — hooks.enabled alone does NOT enable hooks** (NEW test)
   - `getEnableHooks({ hooks: { enabled: true } } as Settings)` → `false`
   - Verifies the function no longer reads from hooks.enabled

8. **Test: getEnableHooksUI is unchanged** (existing, verify unchanged)
   - `getEnableHooksUI({} as Settings)` → `true` (default)
   - `getEnableHooksUI({ tools: { enableHooks: false } } as Settings)` → `false`

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P04
 * @requirement:REQ-211-T01, REQ-211-C01
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers in test file
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P04" packages/cli/src/config/settingsSchema.test.ts
# Expected: 1+

# Check requirement markers
grep -c "@requirement:REQ-211-T01\|@requirement:REQ-211-C01" packages/cli/src/config/settingsSchema.test.ts
# Expected: 1+

# Check new test for old path
grep -c "hooks.*enabled.*true.*false\|old path\|old location\|no longer read" packages/cli/src/config/settingsSchema.test.ts
# Expected: 1+

# Run the specific test file
npm test -- packages/cli/src/config/settingsSchema.test.ts
# Expected: All tests pass (schema was already updated in P03)
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
   - [ ] Tests verify `getEnableHooks` reads from `hooksConfig.enabled`
   - [ ] Tests verify `hooks.enabled` alone does NOT work

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests have concrete input/output assertions
   - [ ] No `toHaveBeenCalled` mock theater

3. **Would the test FAIL if implementation was removed?**
   - [ ] If `getEnableHooks` still read `hooks.enabled`, the old-path test would fail
   - [ ] If `getEnableHooks` didn't read `hooksConfig.enabled`, the new tests would fail

4. **Is the feature REACHABLE?**
   - [ ] `getEnableHooks` is called from CLI config loading (verified in preflight)

## Success Criteria

- All `getEnableHooks` tests updated to use `hooksConfig`
- New test verifies old `hooks.enabled` path is dead
- All tests pass
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settingsSchema.test.ts`
2. Re-read pseudocode `schema-split.md` lines 39-46
3. Retry test updates

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P04.md`
