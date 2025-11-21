# Phase 04a: Argument Parsing TDD Verification

## Phase ID
`PLAN-20251118-ISSUE533.P04a`

## Prerequisites
- Required: Phase 04 completed (15 tests written)
- Verification: `grep -c "@plan:PLAN-20251118-ISSUE533.P04" packages/cli/src/config/__tests__/profileBootstrap.test.ts`
- Expected: 15 matches

## Verification Tasks

### 1. Anti-Pattern Detection

```bash
# Check for reverse testing (FORBIDDEN)
grep -n "NotYetImplemented\|NotImplemented" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 0 matches

# Check for mock theater (FORBIDDEN)
grep -n "toHaveBeenCalled\|toHaveBeenCalledWith" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 0 matches (tests verify values, not mock calls)

# Check for structure-only tests (DISCOURAGED)
grep -n "toHaveProperty\|toBeDefined" packages/cli/src/config/__tests__/profileBootstrap.test.ts | \
  grep -v "with.*value\|to.*equal"
# Expected: Minimal matches (structure checks should verify specific values)
```

### 2. Behavioral Annotation Check

```bash
# Verify all tests have @scenario
grep -c "@scenario" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 15

# Verify all tests have @given
grep -c "@given" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 15

# Verify all tests have @when
grep -c "@when" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 15

# Verify all tests have @then
grep -c "@then" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 15
```

### 3. Test Failure Pattern Verification

```bash
# Run tests - should fail naturally
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P04" 2>&1 | tee /tmp/test-output.txt

# Verify natural failure (NOT stub errors)
cat /tmp/test-output.txt | grep -E "undefined|Cannot read property|is not a function"
# Expected: Multiple matches (natural failures)

# Verify NO stub errors
cat /tmp/test-output.txt | grep "NotYetImplemented"
# Expected: 0 matches
```

### 4. Requirement Coverage Check

```bash
# Verify REQ-PROF-001.1 covered (basic parsing)
grep -c "@requirement:REQ-PROF-001.1" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 8+ matches

# Verify REQ-PROF-003.3 covered (size limit)
grep -c "@requirement:REQ-PROF-003.3" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 1+ matches

# Verify REQ-INT-001.2 covered (mutual exclusivity)
grep -c "@requirement:REQ-INT-001.2" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 4+ matches
```

### Manual Verification Checklist

- [ ] All 15 tests have plan markers
- [ ] All 15 tests have requirement markers
- [ ] All 15 tests have behavioral annotations (@scenario, @given, @when, @then)
- [ ] NO reverse testing patterns found
- [ ] NO mock theater patterns found
- [ ] Tests fail naturally (implementation missing, not stub errors)
- [ ] Tests verify actual values (not just structure)
- [ ] Error message tests check specific text content
- [ ] No tests modified implementation code

## Success Criteria

- All verification commands pass
- 15 tests exist with complete markers
- Tests fail naturally without implementation
- No anti-patterns detected
- Requirement coverage complete

## Failure Recovery

If verification fails:

1. **Reverse Testing Found**: Remove tests checking for NotYetImplemented
2. **Mock Theater Found**: Replace mock verification with value verification
3. **Missing Markers**: Add @plan, @requirement, @scenario annotations
4. **Wrong Failure Pattern**: Check implementation wasn't accidentally created
5. Re-run Phase 04 with corrections

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P04a.md`

```markdown
Phase: P04a
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  - Test count: 15 [OK]
  - Plan markers: 15/15 [OK]
  - Requirement markers: 15/15 [OK]
  - Behavioral annotations: 15/15 [OK]
  - No reverse testing: [OK]
  - No mock theater: [OK]
  - Natural test failures: [OK]
All Checks: PASS

Ready for Phase 05 (Implementation)
```
