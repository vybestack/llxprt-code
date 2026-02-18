# Phase 28a: --resume Flag Removal — TDD Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P28a`

## Prerequisites

- Required: Phase 28 completed
- Verification: `test -f project-plans/issue1385/.completed/P28.md`

## Verification Commands

### Automated Checks

```bash
# 1. Test file exists
test -f packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts && echo "OK" || echo "MISSING"

# 2. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P28" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 8+

# 3. Requirements covered
for req in REQ-RR-001 REQ-RR-002 REQ-RR-004 REQ-RR-005 REQ-RR-006 REQ-RR-007 REQ-RR-008; do
  count=$(grep -c "@requirement:$req" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts)
  echo "$req: $count"
done
# Expected: Each ≥ 1

# 4. Test count
grep -c "it(" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 8+

# 5. Property tests
grep -c "fc\.\|fast-check" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 1+

# 6. Forbidden patterns
grep -n "vi.mock\|jest.mock\|toHaveBeenCalled" packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts
# Expected: 0

# 7. Preservation tests pass (these work already)
npm run test -- --run packages/cli/src/config/__tests__/continueFlagRemoval.spec.ts 2>&1 | grep -E "pass|PASS"
# Expected: At least the preservation tests pass
```

### Semantic Verification Checklist

1. **Removal tests exist and will fail until P29?**
   - [ ] `--resume` rejection test exists
   - [ ] `-r` rejection test exists
   - [ ] `resume` field absence test exists

2. **Preservation tests exist and pass now?**
   - [ ] `--continue` test passes
   - [ ] `-C` test passes
   - [ ] `--list-sessions` test passes
   - [ ] `--delete-session` test passes

### Pass/Fail Criteria

- **PASS**: 8+ tests, requirements covered, preservation tests pass, removal tests fail expectedly
- **FAIL**: Missing tests, preservation tests fail, or forbidden patterns found

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P28a.md`
