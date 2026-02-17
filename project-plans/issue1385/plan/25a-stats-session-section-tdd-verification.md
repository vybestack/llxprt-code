# Phase 25a: /stats Session Section — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P25a`

## Prerequisites

- Required: Phase 25 completed
- Verification: `test -f project-plans/issue1385/.completed/P25.md`

## Verification Commands

### Automated Checks

```bash
# 1. Test file exists
test -f packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts && echo "OK" || echo "MISSING"

# 2. Plan markers present
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P25" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 13+

# 3. All requirements covered
for req in REQ-ST-001 REQ-ST-002 REQ-ST-003 REQ-ST-004 REQ-ST-005 REQ-ST-006; do
  count=$(grep -c "@requirement:$req" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# 4. Test count
grep -c "it(" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 13+

# 5. Property-based tests
grep -c "fc\.\|fast-check" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 3+

# 6. Forbidden patterns absent
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled\|NotYetImplemented" packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts
# Expected: 0 matches

# 7. Tests fail (Red phase)
npm run test -- --run packages/cli/src/ui/commands/__tests__/formatSessionSection.spec.ts 2>&1 | grep -E "FAIL|fail|Tests:"
# Expected: Failures
```

### Semantic Verification Checklist

1. **Do tests cover ALL requirements?**
   - [ ] REQ-ST-001: Session header presence
   - [ ] REQ-ST-002: ID truncation to 12 chars
   - [ ] REQ-ST-003: Relative time display
   - [ ] REQ-ST-004: File size display
   - [ ] REQ-ST-005: Resumed yes/no
   - [ ] REQ-ST-006: Null metadata fallback

2. **Are tests behavioral (not implementation)?**
   - [ ] Tests assert output content, not internal calls
   - [ ] No mocking of fs or any dependency

3. **Are property tests meaningful?**
   - [ ] Truncation property checks actual substring
   - [ ] Boolean mapping property checks actual output string

### Pass/Fail Criteria

- **PASS**: 13+ tests, all requirements covered, property tests present, forbidden patterns absent, tests fail naturally
- **FAIL**: Missing tests, missing requirements, mock theater detected, tests pass (would indicate tests are trivial)

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P25a.md`
