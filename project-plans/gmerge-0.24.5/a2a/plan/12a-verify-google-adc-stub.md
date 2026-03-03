# Phase 12a: Google ADC Auth Provider - Stub Verification

## Phase ID

`PLAN-20260302-A2A.P12a`

## Prerequisites

- Required: Phase 12 completed
- Files expected:
  - `packages/core/src/agents/auth-providers.ts` (modified with GoogleADCAuthProvider)

## Verification Procedure

Run ALL checks from Phase 12 "Verification Commands" section:

### 1. Structural Checks

```bash
# Class exists
grep "export class GoogleADCAuthProvider" packages/core/src/agents/auth-providers.ts
# MUST return: 1 match

# Plan markers
grep -c "@plan:PLAN-20260302-A2A.P12" packages/core/src/agents/auth-providers.ts
# MUST return: 1

# Requirements
grep "@requirement:A2A-AUTH-003" packages/core/src/agents/auth-providers.ts
# MUST return: 1 match

# Import
grep "import.*GoogleAuth.*google-auth-library" packages/core/src/agents/auth-providers.ts
# MUST return: 1 match
```

### 2. Compilation Checks

```bash
# TypeScript (import error expected)
npx tsc --noEmit packages/core/src/agents/auth-providers.ts 2>&1 | grep "Cannot find module 'google-auth-library'"
# EXPECT: Module not found error (acceptable until P14)
```

### 3. Deferred Implementation Detection

```bash
# No TODO in class body
grep "@plan:PLAN-20260302-A2A.P12" packages/core/src/agents/auth-providers.ts -A 20 | grep -E "(TODO|FIXME|HACK)" | grep -v "STUB:"
# MUST return: Empty (STUB: comment OK)
```

### 4. Semantic Verification

**Manual checks:**

- [ ] GoogleADCAuthProvider class exists and is exported
- [ ] Class implements RemoteAgentAuthProvider interface
- [ ] getAuthHandler method has correct signature
- [ ] Method returns AuthenticationHandler (stub)
- [ ] Handler has headers() and shouldRetryWithHeaders() methods
- [ ] JSDoc includes @plan and @requirement A2A-AUTH-003
- [ ] GoogleAuth import added with NOTE about availability
- [ ] No TODO in class body

## Success Criteria

- [x] All structural checks pass
- [x] Compilation checks pass (ignoring expected import error)
- [x] All deferred implementation checks pass
- [x] All semantic verification checklist items checked
- [x] No blocking issues found

## Verification Report

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P12a-report.md`

Contents:
```markdown
Phase: P12a
Verified: [YYYY-MM-DD HH:MM timestamp]
Phase 12 Status: PASS / FAIL

### Structural Checks
[Paste grep outputs]

### Compilation Checks
[Paste tsc output showing expected error]

### Issues Found
[None / List issues]

### Recommendation
PROCEED to Phase 13 / FIX Phase 12
```

## Next Steps

- If ALL checks pass → Proceed to Phase 13 (Google ADC TDD)
- If ANY check fails → Return to Phase 12, fix issues, re-run verification
