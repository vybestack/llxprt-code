# Phase 07: Token Sanitization & Merge — TDD

## Phase ID
`PLAN-20250214-CREDPROXY.P07`

## Prerequisites
- Required: Phase 06a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P06" packages/core/src/auth/`
- Expected files: `packages/core/src/auth/token-sanitization.ts`, `packages/core/src/auth/token-merge.ts`

## Requirements Implemented (Expanded)

### R10.1: Refresh Token Stripping
**Behavior**:
- GIVEN: `{ access_token: "at", refresh_token: "rt", expiry: 1700000000, token_type: "Bearer" }`
- WHEN: `sanitizeTokenForProxy(token)` is called
- THEN: Returns object WITHOUT `refresh_token` key; all other fields preserved
**Why This Matters**: Core security guarantee — prevents refresh token leakage across trust boundary.

### R10.3: Provider-Specific Field Preservation
**Behavior**:
- GIVEN: `{ access_token: "at", refresh_token: "rt", expiry: 1234, account_id: "codex-acc", id_token: "jwt" }`
- WHEN: `sanitizeTokenForProxy(token)` is called
- THEN: Returns `{ access_token: "at", expiry: 1234, account_id: "codex-acc", id_token: "jwt" }` — extra fields preserved
**Why This Matters**: Codex `account_id`, Qwen `resource_url`, and other provider-specific fields must reach the inner process.

### R12.1: Access Token Always Uses New Value
**Behavior**:
- GIVEN: Stored `{ access_token: "old" }`, new `{ access_token: "new" }`
- WHEN: `mergeRefreshedToken(stored, newToken)` is called
- THEN: Result has `access_token: "new"`
**Why This Matters**: After refresh, the new access token must be used.

### R12.2: Refresh Token Preserved When New Is Missing
**Behavior**:
- GIVEN: Stored `{ refresh_token: "rt_old" }`, new `{ access_token: "new" }` (no refresh_token)
- WHEN: `mergeRefreshedToken(stored, newToken)` is called
- THEN: Result has `refresh_token: "rt_old"`
**Why This Matters**: Some providers don't return a new refresh token on refresh — the existing one must be kept.

### R12.3: Revocation Clears Refresh Token
**Behavior**:
- GIVEN: Provider signals revocation (refresh token invalid)
- WHEN: The error is handled
- THEN: Stored `refresh_token` is cleared, user must re-auth
**Why This Matters**: Invalid refresh tokens must not persist — they cause repeated failed refresh attempts.

### R12.4: Optional Fields Merge
**Behavior**:
- GIVEN: Stored `{ scope: "read", resource_url: "https://old" }`, new `{ scope: "read write" }` (no resource_url)
- WHEN: `mergeRefreshedToken(stored, newToken)` is called
- THEN: Result has `scope: "read write"` (new), `resource_url: "https://old"` (preserved)
**Why This Matters**: Provider-specific fields must not be lost during refresh.

## Implementation Tasks

### Files to Create
- `packages/core/src/auth/__tests__/token-sanitization.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P07`
  - 10–12 behavioral tests:
    - Strips refresh_token from token with all fields
    - Preserves access_token, expiry, token_type, scope
    - Preserves provider-specific fields (account_id, id_token, resource_url)
    - Handles token with no refresh_token (no-op — same output)
    - Handles token with empty string refresh_token (still stripped)
    - Returns new object (does not mutate input)
    - Handles minimal token (only access_token and expiry)

- `packages/core/src/auth/__tests__/token-merge.test.ts`
  - MUST include: `@plan:PLAN-20250214-CREDPROXY.P07`
  - 12–15 behavioral tests:
    - access_token always uses new value
    - expiry always uses new value
    - refresh_token: uses new if provided and non-empty
    - refresh_token: preserves existing when new is missing
    - refresh_token: preserves existing when new is empty string
    - scope: uses new if provided, keeps existing otherwise
    - token_type: uses new if provided, keeps existing otherwise
    - resource_url: uses new if provided, keeps existing otherwise
    - Provider-specific fields (account_id): uses new if provided, keeps existing
    - Multiple provider-specific fields merged correctly
    - Returns new object (immutable — does not mutate inputs)
    - Handles completely empty new token (only access_token/expiry required)

### Test Rules
- Tests expect REAL BEHAVIOR (actual data transformation)
- NO testing for NotYetImplemented
- NO reverse tests (expect().not.toThrow())
- Each test has `@requirement` and `@scenario` comments
- Tests WILL FAIL naturally until implementation phase

## Verification Commands

```bash
# Check test files exist
test -f packages/core/src/auth/__tests__/token-sanitization.test.ts || echo "FAIL"
test -f packages/core/src/auth/__tests__/token-merge.test.ts || echo "FAIL"

# Check for mock theater
grep -r "toHaveBeenCalled\b" packages/core/src/auth/__tests__/token-sanitization.test.ts packages/core/src/auth/__tests__/token-merge.test.ts && echo "FAIL: Mock verification found"

# Check for reverse testing
grep -r "toThrow.*NotYetImplemented\|expect.*not\.toThrow()" packages/core/src/auth/__tests__/token-sanitization.test.ts packages/core/src/auth/__tests__/token-merge.test.ts && echo "FAIL"

# Check behavioral assertions
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeUndefined\(\)" packages/core/src/auth/__tests__/token-sanitization.test.ts
grep -cE "toBe\(|toEqual\(|toMatch\(|toContain\(|toBeUndefined\(\)" packages/core/src/auth/__tests__/token-merge.test.ts
# Expected: 10+ assertions per file

# Tests should fail naturally
npm test -- packages/core/src/auth/__tests__/token-sanitization.test.ts 2>&1 | head -20
npm test -- packages/core/src/auth/__tests__/token-merge.test.ts 2>&1 | head -20
```

## Success Criteria
- 22–27 behavioral tests across both files
- Tests fail naturally with "NotYetImplemented" or property access errors
- Zero mock theater or reverse testing
- All tests tagged with plan and requirement IDs

## Failure Recovery
1. `git checkout -- packages/core/src/auth/__tests__/token-sanitization.test.ts packages/core/src/auth/__tests__/token-merge.test.ts`
2. Re-read pseudocode 002 and specification R10/R12

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P07.md`
