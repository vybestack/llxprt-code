# Phase 30a: End-to-End Integration — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P30a`

## Prerequisites

- Required: Phase 30 completed
- Verification: `test -f project-plans/issue1385/.completed/P30.md`

## Verification Commands

### Automated Checks

```bash
# 1. Test file exists
test -f packages/cli/src/__tests__/sessionBrowserE2E.spec.ts && echo "OK" || echo "MISSING"

# 2. Plan markers
grep -c "@plan PLAN-20260214-SESSIONBROWSER.P30" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 1+

# 3. Helper functions defined
grep -c "createTestSession\|setupChatsDir" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 2+

# 4. No mock theater
grep -n "vi.mock\|jest.mock" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 0

# 5. TypeScript compiles
npm run typecheck
# Expected: Pass

# 6. describe blocks present
grep -c "describe(" packages/cli/src/__tests__/sessionBrowserE2E.spec.ts
# Expected: 3+ (at least one per major scenario)
```

### Semantic Verification Checklist

1. **Infrastructure correct?**
   - [ ] Helpers write real JSONL files with correct format
   - [ ] Temp dir cleanup configured
   - [ ] describe blocks match the integration scenarios from requirements

### Pass/Fail Criteria

- **PASS**: File exists, helpers defined, no mocks, compiles
- **FAIL**: Missing file, missing helpers, mock theater detected

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P30a.md`
