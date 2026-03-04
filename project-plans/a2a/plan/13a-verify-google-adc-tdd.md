# Phase 13a: Google ADC Auth Provider - TDD Verification

## Phase ID

`PLAN-20260302-A2A.P13a`

## Prerequisites

- Required: Phase 13 completed
- Files expected:
  - `packages/core/src/agents/__tests__/auth-providers.test.ts` (modified with GoogleADCAuthProvider tests)

## Verification Procedure

Run ALL checks from Phase 13 "Verification Commands" section:

### 1. Structural Checks

```bash
# Plan markers
grep -c "@plan PLAN-20260302-A2A.P13" packages/core/src/agents/__tests__/auth-providers.test.ts
# MUST return: 5+

# Requirements
grep -c "@requirement A2A-AUTH-003" packages/core/src/agents/__tests__/auth-providers.test.ts
# MUST return: 5+

# Mocking used
grep "vi\.mock.*google-auth-library" packages/core/src/agents/__tests__/auth-providers.test.ts
# MUST return: Matches (mocking external boundary is correct)
```

### 2. Test Execution

```bash
# Run tests (should FAIL on GoogleADCAuthProvider tests)
npm test -- packages/core/src/agents/__tests__/auth-providers.test.ts 2>&1 | grep -E "(FAIL|failing)"
# EXPECT: GoogleADCAuthProvider tests fail (stubs return empty headers, not Bearer tokens)
```

### 3. Semantic Verification

**Manual checks:**

- [ ] Tests verify handler.headers() returns Authorization: Bearer {token}
- [ ] Tests verify GoogleAuth called with correct OAuth scopes
- [ ] Tests verify error thrown when token unavailable
- [ ] Tests verify shouldRetryWithHeaders() refreshes token
- [ ] Tests verify interface compliance
- [ ] All tests have JSDoc markers
- [ ] Mocking used for google-auth-library (external boundary - correct per RULES.md)
- [ ] Tests FAIL against stubs

## Success Criteria

- [x] All structural checks pass
- [x] Tests FAIL on GoogleADCAuthProvider (proving behavioral testing)
- [x] All semantic verification checklist items checked
- [x] No blocking issues found

## Verification Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P13a-report.md`

Contents:
```markdown
Phase: P13a
Verified: [YYYY-MM-DD HH:MM timestamp]
Phase 13 Status: PASS / FAIL

### Test Execution
[Paste npm test output showing GoogleADCAuthProvider tests FAIL]

### Structural Checks
[Paste grep outputs]

### Issues Found
[None / List issues]

### Recommendation
PROCEED to Phase 14 / FIX Phase 13
```

## Next Steps

- If ALL checks pass → Proceed to Phase 14 (Google ADC Implementation)
- If ANY check fails → Return to Phase 13, fix issues, re-run verification
