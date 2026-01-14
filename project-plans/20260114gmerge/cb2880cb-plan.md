# REIMPLEMENT Plan: Hook Execution Planning and Matching

**Upstream SHA:** `cb2880cb93e9797f3b97319323ce437a7fee9671`  
**Subject:** feat(hooks): Hook Execution Planning and Matching (#9090)

## Overview

This commit adds hook planner and registry - the final piece of the hooks system foundation.

## Files Changed (Upstream)

- `packages/core/src/hooks/hookPlanner.test.ts` (+324 lines - new)
- `packages/core/src/hooks/hookPlanner.ts` (+154 lines - new)
- `packages/core/src/hooks/hookRegistry.test.ts` (+504 lines - new)
- `packages/core/src/hooks/hookRegistry.ts` (+273 lines - new)

## LLxprt Considerations

1. **All New Files** - Should be clean cherry-pick
2. **Dependencies** - Relies on previous hook commits (Batch 14-18)
3. **Multi-Provider** - Hook matching should work across providers

## Implementation Steps

1. Verify `packages/core/src/hooks/` has files from previous batches
2. Cherry-pick the commit
3. Check imports align with LLxprt structure
4. Run hook tests

## Verification

```bash
npm run lint && npm run typecheck
npm run test --workspace @vybestack/llxprt-code-core -- hooks
```

## Decision

- [x] Likely clean cherry-pick (all new files)

---

*Plan to be executed during Batch 19*
