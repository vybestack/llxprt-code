# Phase 10: Core Config Type TDD

## Phase ID

`PLAN-20260325-HOOKSPLIT.P10`

## Prerequisites

- Required: Phase 09a (Config Types Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P09a.md`
- Expected files from previous phase: Updated `Config` class with type changes, constructor wiring, key changes

## Requirements Implemented (Expanded)

### REQ-211-CC01: Config Constructor Uses `disabledHooks` Param

**Full Text**: Constructing a `Config` with `disabledHooks: ['x']` results in `getDisabledHooks()` returning a list containing `'x'`.
**Behavior**:
- GIVEN: `Config` constructed with `disabledHooks: ['x']`
- WHEN: `getDisabledHooks()` called immediately
- THEN: Returns `['x']`
**Why This Matters**: Eliminates the window between construction and post-construction setDisabledHooks().

### REQ-211-CC03: SettingsService Persistence Key Updated

**Full Text**: `setDisabledHooks()` persists under `'hooksConfig.disabled'`, `getDisabledHooks()` reads from `'hooksConfig.disabled'`.
**Behavior**:
- GIVEN: `config.setDisabledHooks(['a'])`
- WHEN: Settings service is checked
- THEN: `'hooksConfig.disabled'` key has value `['a']`
**Why This Matters**: Matches the new schema structure.

### REQ-211-T02: Core Config Tests Updated

**Full Text**: Tests for `Config` construction and `getDisabledHooks()`/`setDisabledHooks()` shall use the new parameter and persistence key.
**Behavior**:
- GIVEN: Tests construct Config with `disabledHooks` parameter
- WHEN: Tests verify getDisabledHooks
- THEN: Tests verify correct values returned
**Why This Matters**: Tests must verify the constructor wiring and key changes.

### REQ-211-T03: Hook System Tests Use Split Schema

**Full Text**: All hook system test files that construct mock configs shall provide `disabledHooks` as a separate parameter.
**Behavior**:
- GIVEN: Hook system tests
- WHEN: They construct mock configs
- THEN: `disabledHooks` is separate, not inside `hooks` object
**Why This Matters**: Test configs must match the new schema shape.

### REQ-211-HD01: Hook Registration Unaffected

**Full Text**: Hook registration continues to use `config.getDisabledHooks()` API.
**Behavior**:
- GIVEN: A hook whose name is in the disabled list
- WHEN: Registered
- THEN: Registered with `enabled: false`
**Why This Matters**: Behavioral preservation — hooks system still works.

## Implementation Tasks

### Files to Modify

- `packages/core/src/hooks/hookSystem.test.ts`
  - UPDATE mock config to use `disabledHooks` as separate param (not inside `hooks` object)
  - ADD tests verifying `getDisabledHooks()` returns constructor-provided values
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P10` marker
  - ADD `@requirement:REQ-211-T03` marker

- `packages/core/src/hooks/__tests__/hookSystem-integration.test.ts` (if it uses hook configs with `disabled`)
  - UPDATE mock configs to use separate `disabledHooks`
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P10` marker

- Any other test files under `packages/core/src/hooks/__tests__/` that construct configs with `hooks.disabled`
  - Search: `grep -r "disabled.*hooks\|hooks.*disabled" packages/core/src/hooks/ --include="*.test.ts"`
  - UPDATE to use `disabledHooks` separately

### Test Cases Required

1. **Test: Config constructor wires disabledHooks** (AC-CC01.1)
   - Construct Config with `disabledHooks: ['hook-a', 'hook-b']`
   - Assert `getDisabledHooks()` returns `['hook-a', 'hook-b']`

2. **Test: Config constructor defaults disabledHooks to empty** (AC-CC01.2)
   - Construct Config without `disabledHooks`
   - Assert `getDisabledHooks()` returns `[]`

3. **Test: setDisabledHooks persists under new key** (AC-CC03.1)
   - Call `config.setDisabledHooks(['a'])`
   - Verify settings service `set` was called with key `'hooksConfig.disabled'`

4. **Test: setDisabledHooks does NOT write to old key** (AC-CC03.2)
   - Call `config.setDisabledHooks(['a'])`
   - Verify settings service was NOT called with key `'hooks.disabled'`

5. **Test: getDisabledHooks reads from new key when empty** (AC-CC03.3)
   - Construct Config with empty disabledHooks
   - Mock settings service to return `['x']` for `'hooksConfig.disabled'`
   - Assert `getDisabledHooks()` returns `['x']`

6. **Test: Existing hook tests still pass with separate disabledHooks**
   - Update existing `mockConfig` to use `disabledHooks: []` instead of `hooks.disabled`
   - Verify existing tests still pass

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P10
 * @requirement:REQ-211-T02, REQ-211-T03
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P10" packages/core/src/hooks/hookSystem.test.ts
# Expected: 1+

# Check no test uses hooks.disabled inside hooks object
grep -r "hooks:.*disabled\|hooks.*{.*disabled" packages/core/src/hooks/ --include="*.test.ts" | grep -v "disabledHooks\|getDisabledHooks\|setDisabledHooks"
# Expected: 0 matches

# Run hook system tests
npm test -- packages/core/src/hooks/
# Expected: All pass (P09 already made the Config changes)
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
   - [ ] Tests verify constructor wiring of disabledHooks
   - [ ] Tests verify persistence key change
   - [ ] Tests use separate disabledHooks param

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests assert specific values
   - [ ] Tests verify actual Config behavior

3. **Would the test FAIL if implementation was removed?**
   - [ ] If constructor didn't wire disabledHooks, test 1 would fail
   - [ ] If key was still 'hooks.disabled', test 3-5 would fail

## Success Criteria

- Tests verify constructor wiring
- Tests verify persistence key
- All mock configs updated to use separate `disabledHooks`
- All hook system tests pass
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/hooks/`
2. Re-read pseudocode `config-types.md`
3. Retry test updates

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P10.md`
