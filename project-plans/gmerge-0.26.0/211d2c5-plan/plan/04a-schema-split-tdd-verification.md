# Phase 04a: Schema Split TDD Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P04a`

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P04" packages/cli/src/config/settingsSchema.test.ts`

## Verification Tasks

### 1. Test Coverage

```bash
# Count getEnableHooks tests
grep -c "it(" packages/cli/src/config/settingsSchema.test.ts | head -1
# Track: total tests

# Verify old-path test exists
grep "hooks.*enabled.*true" packages/cli/src/config/settingsSchema.test.ts | grep -v hooksConfig
# Expected: At least one test that checks hooks.enabled WITHOUT hooksConfig

# Verify new-path tests exist
grep "hooksConfig.*enabled" packages/cli/src/config/settingsSchema.test.ts
# Expected: Multiple matches
```

### 2. No Mock Theater

```bash
# Check for mock-based assertions
grep -c "toHaveBeenCalled\|toHaveBeenCalledWith\|mockImplementation" packages/cli/src/config/settingsSchema.test.ts
# Expected: 0 in getEnableHooks tests (these are pure functions)
```

### 3. No Reverse Testing

```bash
# Check for reverse testing patterns
grep -c "not\.toThrow\|NotYetImplemented" packages/cli/src/config/settingsSchema.test.ts
# Expected: 0
```

### 4. Tests Pass

```bash
npm test -- packages/cli/src/config/settingsSchema.test.ts
# Expected: All pass
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P04" packages/cli/src/config/settingsSchema.test.ts
# Expected: 1+
```

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/config/settingsSchema.test.ts
# Expected: No matches
```

## Success Criteria

- Tests use `hooksConfig.enabled` for new-path tests
- Old-path test verifies `hooks.enabled` alone returns `false`
- No mock theater or reverse testing
- All tests pass
- Plan markers present

## Semantic Verification Checklist (MANDATORY)

### Behavioral Verification Questions (answer ALL before proceeding)

1. **Does the code DO what the requirement says?**
   - [ ] I read the requirement text
   - [ ] I read the implementation code (not just checked file exists)
   - [ ] I can explain HOW the requirement is fulfilled
2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed (no TODO/HACK/STUB)
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments
3. **Would the test FAIL if implementation was removed?**
   - [ ] Test verifies actual outputs, not just that code ran
   - [ ] Test would catch a broken implementation
4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths
   - [ ] There's a path from UI/CLI/API to this code
5. **What's MISSING?** (list gaps that need fixing before proceeding)
   - [ ] [gap 1]
   - [ ] [gap 2]

### Feature Actually Works

```bash
# Manual test command (RUN THIS and paste actual output):
npm test -- packages/cli/src/config/settingsSchema.test.ts 2>&1 | tail -20
# Expected behavior: All getEnableHooks tests pass using hooksConfig.enabled
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests verify getEnableHooks reads hooksConfig.enabled (verified by reading test assertions)
- [ ] Tests verify hooks.enabled alone returns false (old path dead)
- [ ] Test inputs match the Settings type inferred from the schema
- [ ] getEnableHooksUI tests are unchanged (verified by diff)

### Edge Cases Verified

- [ ] Empty settings object returns false
- [ ] Missing hooksConfig key returns false
- [ ] tools.enableHooks false overrides hooksConfig.enabled true
- [ ] hooksConfig.enabled false overrides tools.enableHooks true

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P04a.md`
