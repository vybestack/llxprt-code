# Phase 23a: RemoteAgentInvocation Implementation - Verification

## Phase ID

`PLAN-20260302-A2A.P23a`

## Prerequisites

- Required: Phase 23 completed
- Verification: remote-invocation.ts modified

## Verification Tasks

```bash
# Run ALL tests (MUST PASS)
npm test -- packages/core/src/agents/__tests__/remote-invocation.test.ts

# Type check
npm run typecheck

# Check implementation
grep "A2AClientManager" packages/core/src/agents/remote-invocation.ts
grep "extractIdsFromResponse" packages/core/src/agents/remote-invocation.ts
grep "input-required" packages/core/src/agents/remote-invocation.ts
```

### Verification Checklist

- [ ] All 15+ tests PASS
- [ ] A2AClientManager created in execute()
- [ ] Session state retrieved and persisted
- [ ] IDs extracted via extractIdsFromResponse
- [ ] input-required state returns error
- [ ] Abort handling cancels task
- [ ] Text extraction uses a2a-utils
- [ ] Query validation throws on empty
- [ ] Config parameter added to constructor
- [ ] @plan markers updated to P23
- [ ] TypeScript compiles
- [ ] No TODO comments

## Success Criteria

All checkboxes checked, all tests pass.

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P23a-report.md`

Contents:
```markdown
Phase: P23a
Verified: [timestamp]
Status: PASS

Test Results: All 15+ tests PASS

Next Phase: Batch 5 complete - proceed to dispatch factory (P24-26) or report completion
```
