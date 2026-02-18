# Phase 08: Token Sanitization & Merge — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P08`

## Prerequisites
- Required: Phase 07a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P07" packages/core/src/auth/__tests__/`
- Expected files: Test files from P07, stub files from P06

## Requirements Implemented (Expanded)

### R10.1–R10.4, R12.1–R12.5
(See Phase 06 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/core/src/auth/token-sanitization.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/002-token-sanitization-merge.md`
  - Destructure `{ refresh_token, ...sanitized }` from input token
  - Return sanitized copy — provider-specific fields preserved via spread
  - Type: `SanitizedOAuthToken = Omit<OAuthToken, 'refresh_token'> & Record<string, unknown>`

- `packages/core/src/auth/token-merge.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/002-token-sanitization-merge.md`
  - Always: `access_token` = new, `expiry` = new
  - Conditionally: `refresh_token` = new if non-empty, else existing
  - Optionally: `scope`, `token_type`, `resource_url`, provider-specific = new if provided, else existing
  - Operate on `OAuthTokenWithExtras` (`OAuthToken & Record<string, unknown>`)
  - Return new object (immutable)

### FORBIDDEN
- Do NOT modify any test files
- Do NOT create `token-sanitizationV2.ts` or `token-merge-new.ts`
- No TODO/FIXME/HACK comments in implementation
- No `console.log` or debug code

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P08
 * @requirement R10.1, R10.2, R10.3, R12.1-R12.5
 * @pseudocode analysis/pseudocode/002-token-sanitization-merge.md
 */
```

## Verification Commands

```bash
# All tests pass
npm test -- packages/core/src/auth/__tests__/token-sanitization.test.ts
npm test -- packages/core/src/auth/__tests__/token-merge.test.ts

# No test modifications
git diff packages/core/src/auth/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"

# No debug code
grep -rn "console\.\|TODO\|FIXME\|XXX\|HACK" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts

# No duplicate files
find packages/ -name "*token-sanitization*V2*" -o -name "*token-merge*New*" && echo "FAIL"

# TypeScript compiles
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts
# All three must return no matches
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode
- No deferred implementation markers
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/core/src/auth/token-sanitization.ts packages/core/src/auth/token-merge.ts`
2. Re-read pseudocode and fix implementation

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P08.md`
