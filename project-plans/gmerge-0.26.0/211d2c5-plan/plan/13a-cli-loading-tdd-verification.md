# Phase 13a: CLI Loading TDD Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P13a`

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P13" packages/cli/src/ui/commands/hooksCommand.test.ts`

## Verification Tasks

### 1. Message Test Coverage

```bash
# Verify hooksCommand test references new message
grep "hooksConfig.enabled" packages/cli/src/ui/commands/hooksCommand.test.ts
# Expected: 1+

# Verify old message not in test expectations
grep "hooks\.enabled" packages/cli/src/ui/commands/hooksCommand.test.ts | grep -v "hooksConfig"
# Expected: 0
```

### 2. No Old-Format Configs Anywhere

```bash
# Comprehensive search across all test files
grep -rn "hooks:.*{" packages/ --include="*.test.ts" --include="*.test.tsx" | grep -v node_modules | grep -v dist | grep "enabled:\|disabled:\|notifications:" | grep -v hooksConfig | grep -v disabledHooks | grep -v getDisabledHooks | grep -v setDisabledHooks
# Expected: 0 matches (no test puts config fields inside hooks object)
```

### 3. Tests Pass

```bash
npm test -- packages/cli/src/ui/commands/hooksCommand.test.ts
npm test -- packages/cli/src/config/settingsSchema.test.ts
npm test -- packages/core/src/hooks/
# Expected: All pass
```

### 4. No Mock Theater in New Tests

```bash
# Any new test assertions should be behavioral
grep -c "toHaveBeenCalled\b" packages/cli/src/ui/commands/hooksCommand.test.ts
# Note: Some mock assertions are expected in command tests (verifying config.setDisabledHooks was called)
# But new tests for message content should use toContain/toBe
```

### 5. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P13" packages/cli/src/ui/commands/hooksCommand.test.ts
# Expected: 1+
```

## Success Criteria

- Message test verifies new text
- No old-format configs in tests
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
npm test -- packages/cli/src/ui/commands/hooksCommand.test.ts packages/cli/src/config/settingsSchema.test.ts 2>&1 | tail -20
# Expected behavior: All tests pass, message tests verify hooksConfig.enabled
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] hooksCommand test asserts message contains 'hooksConfig.enabled' (verified by reading test)
- [ ] No test creates a hooks object with enabled/disabled/notifications inside it
- [ ] Hook system tests all use separate disabledHooks parameter
- [ ] Test assertions are behavioral (toContain, toBe), not structural (toHaveBeenCalled)

### Edge Cases Verified

- [ ] hooksCommand test verifies message does NOT contain old 'hooks.enabled'
- [ ] Tests cover hooks disabled scenario (message shown)
- [ ] Tests cover hooks enabled scenario (no message)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P13a.md`
