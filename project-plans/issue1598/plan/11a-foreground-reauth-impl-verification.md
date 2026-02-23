# Phase 11a: Foreground Reauth Implementation Verification

## Phase ID

`PLAN-20260223-ISSUE1598.P11a`

## Prerequisites

- Phase 11 completed

## Verification Commands

```bash
grep -r "@plan:PLAN-20260223-ISSUE1598.P11" packages/cli/src/auth/ | wc -l
# Expected: 1+

npm test -- BucketFailoverHandlerImpl.test.ts
# Expected: All pass (classification + Pass 2 + Pass 3)

npm test && npm run typecheck && npm run build
# Expected: All succeed
```

### Semantic Checklist

1. **Three-pass algorithm works end-to-end**:
   - [ ] Tested scenario: 429 on bucket A → switch to bucket B (valid token)
   - [ ] Verified Pass 1 classified A, Pass 2 found B, returned true
   - [ ] Tested scenario: All buckets expired → Pass 3 reauth attempted
   - [ ] Verified authenticate() called for first eligible bucket

2. **State management verified**:
   - [ ] lastFailoverReasons populated after tryFailover()
   - [ ] triedBucketsThisSession includes all attempted buckets
   - [ ] sessionBucket updated correctly

### Checklist

- [ ] All tests pass (17+ total: 5 classification, 5 Pass 2, 7 Pass 3)
- [ ] Three-pass algorithm complete
- [ ] TypeScript compiles
- [ ] Project builds
- [ ] Ready for Phase 12

## Phase Completion Marker

Create: `project-plans/issue1598/.completed/P11a.md`
