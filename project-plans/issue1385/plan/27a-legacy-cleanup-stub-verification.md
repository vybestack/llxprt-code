# Phase 27a: --resume Flag Removal — Stub Verification

## Phase ID
`PLAN-20260214-SESSIONBROWSER.P27a`

## Prerequisites

- Required: Phase 27 completed
- Verification: `test -f project-plans/issue1385/.completed/P27.md`

## Verification Commands

### Automated Checks

```bash
# 1. Deprecation markers in config.ts
grep -c "@deprecated.*P27" packages/cli/src/config/config.ts
# Expected: 4

# 2. Deprecation markers in sessionUtils.ts
grep -c "@deprecated.*P27" packages/cli/src/utils/sessionUtils.ts
# Expected: 3

# 3. Preserved exports still present
grep "export interface SessionInfo" packages/cli/src/utils/sessionUtils.ts && echo "SessionInfo: OK"
grep "export interface SessionFileEntry" packages/cli/src/utils/sessionUtils.ts && echo "SessionFileEntry: OK"
grep "export.*function getSessionFiles" packages/cli/src/utils/sessionUtils.ts && echo "getSessionFiles: OK"
grep "export.*function getAllSessionFiles" packages/cli/src/utils/sessionUtils.ts && echo "getAllSessionFiles: OK"
# Expected: All 4 OK

# 4. --continue flag NOT marked for removal
grep -c "@deprecated.*continue" packages/cli/src/config/config.ts
# Expected: 0

# 5. TypeScript compiles
npm run typecheck
# Expected: Pass

# 6. Full test suite passes (no functional changes)
npm run test
# Expected: Pass
```

### Semantic Verification Checklist

1. **Scope correct?**
   - [ ] Only --resume related items marked
   - [ ] No --continue items touched
   - [ ] No --list-sessions items touched
   - [ ] No --delete-session items touched

2. **All removal targets identified?**
   - [ ] 4 targets in config.ts
   - [ ] 3 targets in sessionUtils.ts
   - [ ] Total: 7 deprecation markers

### Pass/Fail Criteria

- **PASS**: All 7 markers present, preserved items untouched, all tests pass
- **FAIL**: Missing markers, preserved items disturbed, or test failures

## Phase Completion Marker

Create: `project-plans/issue1385/.completed/P27a.md`
