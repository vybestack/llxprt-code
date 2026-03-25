# Phase 11: useMcpStatus Implementation Verification + Cleanup

## Phase ID

`PLAN-20260325-MCPSTATUS.P11`

## Prerequisites

- Required: Phase 10a (useMcpStatus TDD Verification) completed
- Verification: `test -f project-plans/gmerge-0.26.0/cebe386-plan/.completed/P10a.md`
- Expected files from previous phase: Tests in useMcpStatus.test.tsx all passing

## Requirements Implemented (Expanded)

### REQ-HOOK-001 through REQ-HOOK-005 (All Hook Requirements)

This phase verifies and fixes any issues found during TDD. Since the hook was fully implemented in P09 (declarative hooks don't have a meaningful stub/impl split), this phase is primarily verification and cleanup.

## Implementation Tasks

### Note: Main Work Was Done in P09

The `useMcpStatus` hook was fully implemented in P09 because React hooks are declarative compositions — there's no meaningful "stub" separate from the implementation. This phase confirms all P10 tests pass and cleans up any issues.

### Files to Verify/Fix

- `packages/cli/src/ui/hooks/useMcpStatus.ts`
  - Verify all P10 tests pass
  - Fix any issues discovered during TDD
  - Verify pseudocode compliance (use-mcp-status.md lines 01-50)
  - ADD `@plan:PLAN-20260325-MCPSTATUS.P11` marker if fixes were needed

### Pseudocode Compliance Check

From `analysis/pseudocode/use-mcp-status.md`:
- Lines 01-08: Import statements — verify correct imports from core
- Lines 10-16: useState initializers — verify reads from manager
- Lines 18-32: useEffect subscription — verify coreEvents.on/off pattern
- Lines 34-40: isMcpReady derivation — verify all 4 truth table entries
- Lines 42-48: Return shape — verify { discoveryState, mcpServerCount, isMcpReady }

### Required Code Markers

```typescript
/**
 * @plan:PLAN-20260325-MCPSTATUS.P11
 * @requirement:REQ-HOOK-001, REQ-HOOK-002, REQ-HOOK-003, REQ-HOOK-004, REQ-HOOK-005
 * @pseudocode use-mcp-status.md lines 01-50
 */
```

## Verification Commands

### Automated Checks

```bash
# All hook tests pass
npm test -- packages/cli/src/ui/hooks/useMcpStatus.test.tsx
# Expected: All pass

# TypeScript compiles
npm run typecheck

# No deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 0

# Full test suite
npm run test
```


### Structural Verification Checklist

- [ ] Previous phase markers present
- [ ] No skipped phases
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] useState initializes from manager state
   - [ ] useEffect subscribes with cleanup
   - [ ] isMcpReady derivation follows truth table
   - [ ] Return shape includes all 3 properties

2. **Is this REAL implementation, not placeholder?**
   - [ ] All tests pass with real behavior

3. **Would the test FAIL if implementation was removed?**
   - [ ] Returning hardcoded values → multiple tests fail

4. **Is the feature REACHABLE?**
   - [ ] Will be imported by AppContainer in P15

### Deferred Implementation Detection

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 0

grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/cli/src/ui/hooks/useMcpStatus.ts
# Expected: 0
```

## Success Criteria

- All P10 tests pass
- TypeScript compiles
- Pseudocode compliance verified
- No deferred implementation
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/cli/src/ui/hooks/useMcpStatus.ts`
2. Re-read pseudocode and fix the specific failing test
3. Re-run verification

## Phase Completion Marker

Create: `project-plans/gmerge-0.26.0/cebe386-plan/.completed/P11.md`
