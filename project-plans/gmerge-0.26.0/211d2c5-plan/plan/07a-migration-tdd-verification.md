# Phase 07a: Migration TDD Verification

## Phase ID

`PLAN-20260325-HOOKSPLIT.P07a`

## Prerequisites

- Required: Phase 07 completed
- Verification: `grep -r "@plan:PLAN-20260325-HOOKSPLIT.P07" packages/cli/src/config/settings.test.ts`

## Verification Tasks

### 1. Test Count and Coverage

```bash
# Count migration-specific tests
grep -c "it(" packages/cli/src/config/settings.test.ts
# Track: compare with baseline

# Verify key scenarios are covered
for scenario in "old-format" "idempoten" "overwrite\|precedence" "unchanged\|no hooks" "event.*remain\|BeforeTool"; do
  grep -ci "$scenario" packages/cli/src/config/settings.test.ts && \
    echo "OK: $scenario found" || echo "WARN: $scenario may be missing"
done
```

### 2. No Mock Theater

```bash
grep -c "toHaveBeenCalled\|mockImplementation\|vi\.fn\|jest\.fn" packages/cli/src/config/settings.test.ts | head -1
# Expected: 0 in migration tests (direct function calls with real data)
```

### 3. No Reverse Testing

```bash
grep -c "not\.toThrow\|NotYetImplemented" packages/cli/src/config/settings.test.ts
# Expected: 0
```

### 4. Behavioral Assertions

```bash
# Verify tests assert specific values
grep -c "toBe(\|toEqual(\|toContain(\|toBeUndefined()\|toStrictEqual(" packages/cli/src/config/settings.test.ts
# Expected: 10+ (multiple assertions per test)
```

### 5. Tests Exist and Have Correct Failure Mode

```bash
# Run migration tests — some should fail with stub
npm test -- packages/cli/src/config/settings.test.ts 2>&1 | grep -c "FAIL\|\|"
# Expected: Several failures (migration tests fail, other tests pass)
```

### 6. Plan Markers

```bash
grep -c "@plan:PLAN-20260325-HOOKSPLIT.P07" packages/cli/src/config/settings.test.ts
# Expected: 1+
```

## Success Criteria

- 10+ migration tests exist
- Tests use real data (no mocks)
- Tests assert specific values (behavioral)
- Migration tests fail naturally with stub
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
npm test -- packages/cli/src/config/settings.test.ts 2>&1 | tail -30
# Expected behavior: Migration tests exist; some fail (stub), no-change cases pass
# Actual behavior: [paste what actually happens]
```

### Integration Points Verified

- [ ] Tests call migrateHooksConfig directly with real Settings objects
- [ ] Tests verify the output structure matches expected split format
- [ ] Tests cover the precedence rule (hooksConfig wins over hooks)
- [ ] Tests cover idempotency (double migration produces same result)

### Edge Cases Verified

- [ ] Empty hooks object — no migration needed
- [ ] Null/undefined hooks — no migration needed
- [ ] Only event keys in hooks — no migration needed
- [ ] All three config keys present (enabled, disabled, notifications)
- [ ] Partial config keys (only some present)

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/211d2c5-plan/.completed/P07a.md`
