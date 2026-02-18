# Phase 13: ProxyProviderKeyStorage — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P13`

## Prerequisites
- Required: Phase 12a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P12" packages/core/src/auth/proxy/`

## Requirements Implemented (Expanded)

### R9.1–R9.5
(See Phase 12 for full requirement expansion)

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P13`
  - 8–12 behavioral tests covering:
    - getKey sends get_api_key operation and returns key value
    - getKey returns null when key not found (NOT_FOUND)
    - listKeys sends list_api_keys and returns string array
    - listKeys returns empty array on error (degraded operation)
    - hasKey returns true when key exists (via get_api_key round-trip)
    - hasKey returns false when key not found
    - saveKey throws "API key management is not available in sandbox mode"
    - deleteKey throws "API key management is not available in sandbox mode"
    - Connection loss throws with correct message
    - UNAUTHORIZED error throws

## Verification Commands

```bash
test -f packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts || echo "FAIL"
grep -r "toHaveBeenCalled\b" packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts && echo "FAIL: Mock theater"
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeNull\(|toThrow\(" packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts
# Expected: 8+ assertions
```

## Success Criteria
- 8–12 behavioral tests
- Tests fail naturally until implementation
- Write method tests verify exact error message

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts`
2. Re-read requirements R9.1–R9.5 and rewrite tests to assert behavior, not mock interactions
3. Re-run verification commands and ensure tests fail naturally (not via reverse-testing patterns)

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P13.md`
