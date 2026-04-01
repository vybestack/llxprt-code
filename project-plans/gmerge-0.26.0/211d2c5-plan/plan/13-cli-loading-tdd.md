# Phase 13: CLI Loading + Commands TDD

## Phase ID

`PLAN-20260325-HOOKSPLIT.P13`

## Prerequisites

- Required: Phase 12a (CLI Loading Stub Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P12a.md`
- Expected files from previous phase: Updated CLI config loading, hooksCommand, migrate command, hookRegistry

## Requirements Implemented (Expanded)

### REQ-211-T06: CLI Config Loading Tests

**Full Text**: Tests shall verify CLI config loading correctly extracts `disabledHooks` from `hooksConfig.disabled` and passes it to Config constructor.
**Behavior**:
- GIVEN: `effectiveSettings.hooksConfig.disabled` is `['x']`
- WHEN: Config is loaded
- THEN: `config.getDisabledHooks()` returns list containing `'x'`
**Why This Matters**: Verifies the parameter flow from settings to Config.

### REQ-211-CMD02: User-Facing Messages Reference `hooksConfig.enabled`

**Full Text**: Message displayed when hooks are not enabled references `hooksConfig.enabled`.
**Behavior**:
- GIVEN: Hooks system not enabled
- WHEN: `/hooks list` invoked
- THEN: Message contains `hooksConfig.enabled`
**Why This Matters**: Correct user guidance.

### REQ-211-T03: Hook System Tests Use Split Schema

**Full Text**: All hook system test files provide `disabledHooks` as separate parameter.
**Behavior**: No test uses `hooks: { disabled: [...] }`.
**Why This Matters**: Test configs must match new schema.

### REQ-211-HD03: Trust Scan Treats Project Hooks as Pure Event Map

**Full Text**: Trust scan doesn't skip 'disabled' key.
**Why This Matters**: Confirms dead code removed.

## Implementation Tasks

### Files to Modify

1. **`packages/cli/src/ui/commands/hooksCommand.test.ts`**
   - UPDATE test for disabled message: verify it references `hooksConfig.enabled` (not `hooks.enabled`)
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P13` marker
   - ADD `@requirement:REQ-211-CMD02` marker

2. **`packages/cli/src/config/settingsSchema.test.ts`** (if not already complete from P04)
   - Verify all tests use `hooksConfig` format
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P13` marker if any changes

3. **Hook system test files** (search for old patterns)
   - `grep -r "hooks:.*disabled\|hooks.*{.*disabled" packages/ --include="*.test.ts" --include="*.test.tsx"`
   - Update any remaining old-format test configs
   - ADD `@plan:PLAN-20260325-HOOKSPLIT.P13` marker

4. **`packages/cli/src/config/extension.test.ts`** (if it references hooks.enabled)
   - `grep "hooks.*enabled\|hooks.*disabled" packages/cli/src/config/extension.test.ts`
   - Update to hooksConfig format if needed

### Test Cases Required

1. **Test: hooksCommand shows correct message when hooks disabled** (AC-CMD02.1)
   - Invoke hooksCommand list when hooks not enabled
   - Assert output contains `hooksConfig.enabled`
   - Assert output does NOT contain `hooks.enabled`

2. **Test: existing hooksCommand enable/disable tests pass** (AC-CMD01.1)
   - Existing tests for enable/disable should still pass
   - These use `config.getDisabledHooks()` / `config.setDisabledHooks()` which are correct

3. **Test: hook system tests use separate disabledHooks** (AC-T03.1)
   - Search and update any remaining old-format mock configs

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-HOOKSPLIT.P13
 * @requirement:REQ-211-T06, REQ-211-CMD02, REQ-211-T03
 */
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P13" packages/cli/src/ui/commands/hooksCommand.test.ts
# Expected: 1+

# No old-format hooks.disabled in any test
grep -rn "hooks:.*{.*disabled:" packages/ --include="*.test.ts" --include="*.test.tsx" | grep -v node_modules | grep -v dist | grep -v "disabledHooks\|getDisabledHooks\|setDisabledHooks"
# Expected: 0 matches

# No old hooks.enabled in tests (except for "old path doesn't work" test)
grep -rn "hooks:.*{.*enabled:" packages/ --include="*.test.ts" --include="*.test.tsx" | grep -v node_modules | grep -v dist | grep -v hooksConfig
# Expected: 0 matches (or only in "old path fails" test)

# Run affected test files
npm test -- packages/cli/src/ui/commands/hooksCommand.test.ts
npm test -- packages/cli/src/config/settingsSchema.test.ts

# Check message text in hooksCommand test
grep "hooksConfig.enabled" packages/cli/src/ui/commands/hooksCommand.test.ts
# Expected: 1+ match
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
   - [ ] hooksCommand test verifies new message text
   - [ ] No old-format configs remain in tests

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests assert specific message content
   - [ ] Tests have behavioral assertions

3. **Would the test FAIL if implementation was removed?**
   - [ ] Message test would fail if text reverted to hooks.enabled

## Success Criteria

- hooksCommand test verifies `hooksConfig.enabled` in message
- No old-format `hooks.disabled` or `hooks.enabled` in test configs
- All affected tests pass
- Plan markers present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/commands/hooksCommand.test.ts`
2. Re-read pseudocode `cli-loading.md` lines 30-34
3. Retry test updates

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P13.md`
