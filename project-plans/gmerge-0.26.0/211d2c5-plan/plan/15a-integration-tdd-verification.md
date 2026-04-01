# Phase 15a: Integration TDD Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P15a`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P15" integration-tests/ packages/ --include="*.test.ts"`

## Verification Tasks

### 1. Integration Test Coverage

```bash
# Count integration tests related to hooks schema split
grep -rc "@plan:PLAN-20260325-HOOKSPLIT.P15" integration-tests/ packages/ --include="*.test.ts" --include="*.test.tsx" | grep -v ":0$"
# Expected: 1+ files

# Verify backward compatibility test exists
grep -c "old.*format\|backward\|migration.*end.to.end\|legacy.*settings" integration-tests/ packages/ --include="*.test.ts" -r
# Expected: 1+
```

### 2. Tests Use Real Settings (No Mocks)

```bash
# Verify integration tests don't mock settings loading
grep -c "vi.mock.*settings\|jest.mock.*settings" integration-tests/hooks/ --include="*.test.ts" -r
# Expected: 0 in integration tests
```

### 3. All Tests Pass

```bash
npm test
# Expected: All pass
```

### 4. No Old-Format Configs (Except Intentional Migration Tests)

```bash
# Old-format in integration tests should only be in "migration from old format" test
grep -rn "hooks:.*{.*enabled:" integration-tests/ --include="*.test.ts" | grep -v hooksConfig
# Expected: Only in migration backward-compat test
```

### 5. Plan Markers

```bash
grep -rc "@plan:PLAN-20260325-HOOKSPLIT.P15" integration-tests/ packages/ --include="*.test.ts" | grep -v ":0$"
# Expected: 1+ files
```

## Success Criteria

- Integration tests cover backward compatibility
- Tests use real settings (not mocked)
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
npm test -- integration-tests/hooks/ 2>&1 | tail -20
# Expected behavior: All integration tests pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Integration tests verify old-format → migration → correct Config behavior
- [ ] Integration tests verify new-format → correct Config behavior
- [ ] Integration tests verify scope merging with hooksConfig
- [ ] Integration tests use real settings objects (no mocks for settings loading)

### Edge Cases Verified

- [ ] Old-format settings with all config keys present
- [ ] Old-format settings with only some config keys
- [ ] Mixed old+new format (hooksConfig takes precedence)
- [ ] Settings file on disk NOT modified by migration

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P15a.md`
