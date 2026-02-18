# Phase 11: ProxyTokenStore — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P11`

## Prerequisites
- Required: Phase 10a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P10" packages/core/src/auth/proxy/__tests__/`
- Expected files: Test files from P10, stub from P09

## Requirements Implemented (Expanded)

### R8.1–R8.9, R23.3, R29.1–R29.4
(See Phase 09 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/core/src/auth/proxy/proxy-token-store.ts` — UPDATE stub with full implementation
  - MUST follow pseudocode `analysis/pseudocode/003-proxy-token-store.md`
  - Uses `ProxySocketClient` from P05 for framed socket communication
  - Translates each `TokenStore` method to the corresponding proxy operation
  - Error translation: `NOT_FOUND` → `null`, `UNAUTHORIZED`/`INTERNAL_ERROR` → throw
  - `acquireRefreshLock` → no-op returns `true`
  - `releaseRefreshLock` → no-op
  - `getBucketStats` → `get_token` round-trip, returns placeholder stats

### FORBIDDEN
- Do NOT modify any test files
- No TODO/FIXME/HACK comments
- No `console.log` or debug code

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P11
 * @requirement R8.1-R8.9, R23.3, R29.1-R29.4
 * @pseudocode analysis/pseudocode/003-proxy-token-store.md
 */
```

## Verification Commands

```bash
npm test -- packages/core/src/auth/proxy/__tests__/proxy-token-store.test.ts
git diff packages/core/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
grep -rn "console\.\|TODO\|FIXME\|XXX\|HACK" packages/core/src/auth/proxy/proxy-token-store.ts
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/auth/proxy/proxy-token-store.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/auth/proxy/proxy-token-store.ts
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/auth/proxy/proxy-token-store.ts
# Verify: return null only in NOT_FOUND error translation (expected), not as stub
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode
- TypeScript compiles cleanly

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/proxy-token-store.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P11.md`
