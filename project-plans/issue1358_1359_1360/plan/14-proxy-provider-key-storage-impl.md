# Phase 14: ProxyProviderKeyStorage — Implementation

## Phase ID
`PLAN-20250214-CREDPROXY.P14`

## Prerequisites
- Required: Phase 13a completed
- Verification: `grep -r "@plan:PLAN-20250214-CREDPROXY.P13" packages/core/src/auth/proxy/__tests__/`

## Requirements Implemented (Expanded)

### R9.1–R9.5
(See Phase 12 for full requirement expansion)

## Implementation Tasks

### Files to Modify (NOT create new)
- `packages/core/src/auth/proxy/proxy-provider-key-storage.ts` — UPDATE stub
  - MUST follow pseudocode `analysis/pseudocode/004-proxy-provider-key-storage.md`
  - `getKey` → `get_api_key` operation via ProxySocketClient
  - `listKeys` → `list_api_keys` operation
  - `hasKey` → `get_api_key` round-trip, return true/false
  - `saveKey`/`deleteKey` → throw with sandbox error message

### FORBIDDEN
- Do NOT modify test files
- No TODO/FIXME/HACK comments

### Required Code Markers
```typescript
/**
 * @plan PLAN-20250214-CREDPROXY.P14
 * @requirement R9.1-R9.5
 * @pseudocode analysis/pseudocode/004-proxy-provider-key-storage.md
 */
```

## Verification Commands

```bash
npm test -- packages/core/src/auth/proxy/__tests__/proxy-provider-key-storage.test.ts
git diff packages/core/src/auth/proxy/__tests__/ | grep -E "^[+-]" | grep -v "^[+-]{3}" && echo "FAIL: Tests modified"
npm run typecheck
```

### Deferred Implementation Detection
```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY)" packages/core/src/auth/proxy/proxy-provider-key-storage.ts
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/auth/proxy/proxy-provider-key-storage.ts
```

## Success Criteria
- All tests pass
- No test modifications
- Implementation follows pseudocode

## Failure Recovery
1. `git checkout -- packages/core/src/auth/proxy/proxy-provider-key-storage.ts`
2. Re-read pseudocode and fix

## Phase Completion Marker
Create: `project-plans/issue1358_1359_1360/.completed/P14.md`
