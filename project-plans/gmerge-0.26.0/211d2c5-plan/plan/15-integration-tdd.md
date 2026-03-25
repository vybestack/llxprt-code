# Phase 15: Integration Tests

## Phase ID

`PLAN-20260325-HOOKSPLIT.P15`

## Prerequisites

- Required: Phase 14a (CLI Loading Impl Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P14a.md`
- Expected files from previous phase: All production code changes complete (schema, migration, config types, CLI loading)

## Requirements Implemented (Expanded)

### REQ-211-T05: Integration Tests Use Split Schema

**Full Text**: Integration tests that construct settings objects with hooks shall use the split `hooksConfig` + `hooks` structure.
**Behavior**:
- GIVEN: Integration test settings objects
- WHEN: They enable hooks or set disabled hooks
- THEN: They use `hooksConfig: { enabled: true }` not `hooks: { enabled: true }`
**Why This Matters**: Integration tests must match the new schema.

### REQ-211-ZD01: No Breaking Change for Existing Settings Files

**Full Text**: Existing settings files using old schema format are transparently converted. All hooks behavior is preserved.
**Behavior**:
- GIVEN: Old-format settings `{ hooks: { enabled: true, disabled: ["x"], BeforeTool: [...] } }`
- WHEN: Settings are loaded and config is constructed
- THEN: `getEnableHooks()` returns true, `getDisabledHooks()` includes "x", hooks.BeforeTool is available
**Why This Matters**: Zero user impact from schema change.

### REQ-211-HD01: Hook Registration Unaffected

**Full Text**: Hook registration system continues to use `config.getDisabledHooks()` API.
**Behavior**:
- GIVEN: Hook with name in disabled list
- WHEN: Registered via hook registry
- THEN: Registered with `enabled: false`
**Why This Matters**: Core hooks behavior preserved.

### REQ-211-HD02: Hook Execution Guards Unchanged

**Full Text**: `getEnableHooks()` method remains the sole runtime check for hook system activation.
**Behavior**:
- GIVEN: All hook trigger entry points
- WHEN: They check hook enablement
- THEN: They use `config.getEnableHooks()`
**Why This Matters**: No new dispatch guards introduced.

### REQ-211-UI01: StatusDisplay Does Not Regress

**Full Text**: `StatusDisplay` continues to display hook status when active hooks are present, without referencing hooksConfig or hooks.notifications.
**Behavior**:
- GIVEN: Active hooks present
- WHEN: StatusDisplay renders
- THEN: Hook status displays correctly (no regression)
**Why This Matters**: UI behavioral preservation.

### REQ-211-SM01: `hooksConfig` Is Merged Across Scopes

**Full Text**: `mergeSettings()` merges `hooksConfig` using shallow merge across all scopes.
**Behavior**:
- GIVEN: User `hooksConfig.enabled: true`, workspace `hooksConfig.disabled: ['x']`
- WHEN: Merged
- THEN: Result has both `enabled: true` and `disabled: ['x']`
**Why This Matters**: Scope precedence works correctly.

## Implementation Tasks

### Files to Modify

1. **`integration-tests/hooks/hooks-e2e.integration.test.ts`**
   - UPDATE any settings objects to use split schema
   - If test constructs settings with `hooks: { enabled: true, ... }`, change to `hooksConfig: { enabled: true }, hooks: { ... }`
   - ADD integration tests for old-format → migration → correct behavior
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P15` marker
   - ADD `@requirement:REQ-211-T05`, `@requirement:REQ-211-ZD01` markers

2. **`packages/cli/src/config/config.integration.test.ts`** (if it references hooks config)
   - UPDATE settings objects to use split schema
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P15` marker

3. **Other integration-level test files** that construct settings with hooks
   - Search: `grep -rn "hooks:.*enabled\|hooks:.*disabled" integration-tests/ packages/ --include="*.integration.test.ts"`
   - Update to use split schema

### Integration Test Cases

1. **Test: Old-format settings are migrated and hooks work end-to-end** (AC-ZD01.1)
   - Construct settings in old format: `{ hooks: { enabled: true, disabled: ["x"], BeforeTool: [...] } }`
   - Load through `loadSettings()` pipeline (or simulate)
   - Verify: `getEnableHooks()` returns true
   - Verify: `getDisabledHooks()` contains "x"
   - Verify: hooks object has BeforeTool

2. **Test: New-format settings work end-to-end** (AC-T05.1)
   - Construct settings in new format: `{ hooksConfig: { enabled: true }, hooks: { BeforeTool: [...] } }`
   - Load through pipeline
   - Verify same behavior as test 1

3. **Test: Settings merge across scopes with hooksConfig** (AC-SM01.1)
   - User settings: `{ hooksConfig: { enabled: true } }`
   - Workspace settings: `{ hooksConfig: { disabled: ['x'] } }`
   - Verify merged: `enabled: true`, `disabled: ['x']`

4. **Test: Settings file on disk NOT modified by migration** (AC-ZD01.2)
   - Load settings from a test fixture
   - Verify the fixture file is unchanged after load

5. **Test: Hook registration uses correct disabled list after schema split** (AC-HD01.1, AC-HD01.2)
   - Construct config with `disabledHooks: ['my-hook']`
   - Register a hook named 'my-hook'
   - Verify it is registered with `enabled: false`

6. **Test: Trust scan registers project hooks from pure event map** (AC-HD03.1)
   - Construct config with `projectHooks` containing a pure event map (no `disabled` key)
   - Run `checkProjectHooksTrust()` / hook registration through the registry
   - Verify that project hooks with only event entries (e.g., `{ BeforeTool: [...] }`) are registered and executable
   - Verify the stale `if (key === 'disabled') continue;` guard removal does not cause regressions — all event hooks are iterated and registered correctly
   - This confirms REQ-211-HD03: trust scan treats project hooks as a pure event map

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P15
 * @requirement:REQ-211-T05, REQ-211-ZD01
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -rc "@plan:PLAN-20260325-HOOKSPLIT.P15" integration-tests/ packages/ --include="*.test.ts" --include="*.test.tsx" | grep -v ":0$"
# Expected: 1+ files

# Run integration tests
npm test -- integration-tests/hooks/
npm test -- packages/cli/src/config/config.integration.test.ts 2>/dev/null || true

# Run full test suite
npm test
# Expected: All pass

# No old-format settings in integration tests
grep -rn "hooks:.*{.*enabled:" integration-tests/ --include="*.test.ts" | grep -v hooksConfig
# Expected: Only in "migration from old format" test (intentional)
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
   - [ ] Integration tests verify old-format migration works end-to-end
   - [ ] Integration tests verify new-format works end-to-end
   - [ ] Integration tests verify scope merging
   - [ ] Integration tests verify settings files not modified

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests use real settings objects (not mocks)
   - [ ] Tests verify actual behavior (not just that code ran)

3. **Would the test FAIL if implementation was removed?**
   - [ ] Migration tests fail without migrateHooksConfig
   - [ ] Schema tests fail without hooksConfig schema entry

4. **Is the feature REACHABLE?**
   - [ ] Tests simulate the actual user workflow (settings → load → config → hooks)

## Success Criteria

- Integration tests verify old-format backward compatibility
- Integration tests verify new-format correctness
- Integration tests verify scope merging
- All tests pass (npm test)
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- integration-tests/`
2. Re-read specification Section 4 (Target Architecture)
3. Retry integration test creation

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P15.md`
