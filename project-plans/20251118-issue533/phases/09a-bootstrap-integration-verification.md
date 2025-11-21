# Phase 09a: Bootstrap Integration TDD Verification

## Phase ID
`PLAN-20251118-ISSUE533.P09a`

## Prerequisites
- Required: Phase 09 completed (12 tests written)
- Verification: `grep -c "@plan:PLAN-20251118-ISSUE533.P09" packages/cli/src/config/__tests__/profileBootstrap.test.ts`
- Expected: 12 tests exist

## Verification Tasks

### Automated Verification

```bash
# 1. Verify test count
grep -c "@plan:PLAN-20251118-ISSUE533.P09" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: 12

# 2. Verify requirement markers
grep "@requirement:REQ-INT" packages/cli/src/config/__tests__/profileBootstrap.test.ts | wc -l
# Expected: 12+ matches

# 3. Verify tests exist in suite
npm test packages/cli/src/config/__tests__/profileBootstrap.test.ts -- --grep "@plan:.*P09"
# Expected: 12 tests run (fail naturally)

# 4. Verify no reverse testing
grep -n "NotYetImplemented" packages/cli/src/config/__tests__/profileBootstrap.test.ts
# Expected: No matches in P09 tests
```

### Manual Verification Checklist

- [ ] Phase 09 completion marker exists
- [ ] 12 tests created
- [ ] All tests have plan markers
- [ ] All tests have requirement markers
- [ ] All tests have behavioral annotations
- [ ] Tests fail naturally (applyBootstrapProfile doesn't handle profileJson yet)
- [ ] No reverse testing

## Exit Criteria

- All verification commands pass
- 12 tests exist and fail naturally
- Ready for Phase 10 implementation

## Phase Completion Marker

Create: `project-plans/20251118-issue533/.completed/P09a.md`

```markdown
Phase: P09a
Completed: [YYYY-MM-DD HH:MM]
Verification Results:
  - Test count: 12 [OK]
  - Plan markers: 12 [OK]
  - Requirement markers: 12 [OK]
  - Tests fail naturally: [OK]
  - No reverse testing: [OK]
All Checks: PASS
```
