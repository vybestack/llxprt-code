# Phase 07: Migration Function TDD

## Phase ID

`PLAN-20260325-HOOKSPLIT.P07`

## Prerequisites

- Required: Phase 06a (Migration Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P06a.md`
- Expected files from previous phase: `migrateHooksConfig` stub in `settings.ts`

## Requirements Implemented (Expanded)

### REQ-211-M01: Automatic Migration on Load

**Full Text**: When settings are loaded from disk, if the `hooks` object contains any of the keys `enabled`, `disabled`, or `notifications`, then those keys shall be moved to the `hooksConfig` object and removed from `hooks`.
**Behavior**:
- GIVEN: `{ hooks: { enabled: true, disabled: ["foo"], BeforeTool: [...] } }`
- WHEN: `migrateHooksConfig()` is called
- THEN: `hooksConfig.enabled === true`, `hooksConfig.disabled` contains `"foo"`, `hooks` contains only `BeforeTool`
**Why This Matters**: Backward compatibility for existing settings files.

### REQ-211-M03: Migration Is Idempotent

**Full Text**: Migration produces the same result when applied to already-migrated settings.
**Behavior**:
- GIVEN: `{ hooksConfig: { enabled: true }, hooks: { BeforeTool: [...] } }`
- WHEN: `migrateHooksConfig()` is called
- THEN: Output is identical to input
**Why This Matters**: Migration runs every time settings are loaded — must be safe to repeat.

### REQ-211-M04: Migration Does Not Overwrite Existing `hooksConfig` Values

**Full Text**: When `hooksConfig` already contains a value for a key being migrated, the existing `hooksConfig` value takes precedence.
**Behavior**:
- GIVEN: `{ hooks: { enabled: false }, hooksConfig: { enabled: true } }`
- WHEN: `migrateHooksConfig()` is called
- THEN: `hooksConfig.enabled === true` (existing value wins)
**Why This Matters**: Prevents data loss when both old and new format coexist.

### REQ-211-T04: Migration Function Tests

**Full Text**: The `migrateHooksConfig()` function shall have dedicated unit tests.
**Behavior**: Tests verify all migration scenarios.
**Why This Matters**: Migration is critical path — must be thoroughly tested.

### REQ-211-ZD01: No Breaking Change for Existing Settings Files

**Full Text**: Existing settings files using the old schema format are transparently converted by the migration function.
**Behavior**:
- GIVEN: Old-format settings file
- WHEN: Loaded
- THEN: All hooks behavior preserved; settings file on disk NOT modified
**Why This Matters**: Users must not need to manually edit settings files.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/config/settings.test.ts`
  - ADD test suite for `migrateHooksConfig`
  - ADD `@plan:PLAN-20260325-HOOKSPLIT.P07` marker
  - ADD `@requirement:REQ-211-T04` markers

### Test Cases Required

**Note**: `migrateHooksConfig` may need to be exported for direct testing, or tests can go through `loadSettings()` integration. Prefer direct unit tests of the function with export.

1. **Test: Migrates old-format settings** (AC-M01.1, AC-T04.1)
   ```
   Input: { hooks: { enabled: true, disabled: ["foo"], BeforeTool: [{...}] } }
   Expected: { hooksConfig: { enabled: true, disabled: ["foo"] }, hooks: { BeforeTool: [{...}] } }
   ```

2. **Test: Removes config fields from hooks after migration** (AC-M01.2)
   ```
   Input: { hooks: { enabled: true, notifications: false } }
   Expected: hooks.enabled === undefined, hooks.notifications === undefined
   ```

3. **Test: Already-migrated settings returned unchanged** (AC-M03.1, AC-T04.2)
   ```
   Input: { hooksConfig: { enabled: true }, hooks: { BeforeTool: [{...}] } }
   Expected: Output identical to input
   ```

4. **Test: Idempotency — double migration produces same result** (AC-M03.2)
   ```
   Input: { hooks: { enabled: true, BeforeTool: [{...}] } }
   first = migrateHooksConfig(input)
   second = migrateHooksConfig(first)
   Expected: first deep-equals second
   ```

5. **Test: Existing hooksConfig values not overwritten** (AC-M04.1, AC-T04.3)
   ```
   Input: { hooks: { enabled: false }, hooksConfig: { enabled: true } }
   Expected: hooksConfig.enabled === true (existing wins)
   ```

6. **Test: Settings with no hooks returned unchanged** (AC-T04.4)
   ```
   Input: { tools: { enableHooks: true } }
   Expected: Output identical to input, no hooksConfig added
   ```

7. **Test: Event hook definitions remain in hooks** (AC-T04.5)
   ```
   Input: { hooks: { enabled: true, disabled: ["x"], BeforeTool: [{...}], AfterTool: [{...}] } }
   Expected: hooks has BeforeTool and AfterTool; no enabled or disabled
   ```

8. **Test: Empty hooks object — no migration needed**
   ```
   Input: { hooks: {} }
   Expected: Output identical to input
   ```

9. **Test: Migrates notifications field**
   ```
   Input: { hooks: { notifications: false } }
   Expected: hooksConfig.notifications === false, hooks.notifications === undefined
   ```

10. **Test: Partial migration — only some config fields present**
    ```
    Input: { hooks: { enabled: true, BeforeTool: [{...}] } }
    Expected: hooksConfig.enabled === true, hooks has only BeforeTool
    ```

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P07
 * @requirement:REQ-211-T04
 */
describe('migrateHooksConfig', () => { ... });
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P07" packages/cli/src/config/settings.test.ts
# Expected: 1+

# Check requirement markers
grep -c "@requirement:REQ-211-T04" packages/cli/src/config/settings.test.ts
# Expected: 1+

# Count migration tests
grep -c "it(" packages/cli/src/config/settings.test.ts | head -1
# Track: should increase by 10+

# Run tests — most should FAIL since stub returns unchanged
npm test -- packages/cli/src/config/settings.test.ts 2>&1 | tail -20
# Expected: Tests that verify migration behavior fail; tests for no-change cases pass
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
   - [ ] Tests verify old-format → new-format migration
   - [ ] Tests verify idempotency
   - [ ] Tests verify precedence (hooksConfig wins)
   - [ ] Tests verify no-change scenarios

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests have concrete input/output assertions with real data
   - [ ] Tests verify specific field values, not just structure

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests that check migration behavior will fail with the stub
   - [ ] Only no-change tests should pass with the stub

4. **No mock theater?**
   - [ ] Tests call `migrateHooksConfig` directly with real data
   - [ ] No mocking of internal functions

## Success Criteria

- 10+ tests for migration function
- Tests cover all AC- acceptance criteria from requirements
- Tests fail naturally with stub (except no-change cases)
- No mock theater or reverse testing
- Plan/requirement markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/config/settings.test.ts`
2. Re-read pseudocode `migration.md`
3. Retry test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P07.md`
