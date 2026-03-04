# Phase 22a: RemoteAgentInvocation TDD - Verification

## Phase ID

`PLAN-20260302-A2A.P22a`

## Prerequisites

- Required: Phase 22 completed
- Verification: remote-invocation.test.ts created

## Verification Tasks

```bash
# Tests exist and run (expect failures against stub)
npm test -- packages/core/src/agents/__tests__/remote-invocation.test.ts
```

### Verification Checklist

- [ ] Test file exists
- [ ] 15+ tests present
- [ ] Tests FAIL against P21 stub (expected)
- [ ] Tests cover: query validation, delegation, session state, terminal states, input-required, abort, text extraction
- [ ] @plan markers present
- [ ] @requirement markers present (5+)
- [ ] No TODO comments

## Success Criteria

All checkboxes checked, tests fail naturally.

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P22a-report.md`

Contents:
```markdown
Phase: P22a
Verified: [YYYY-MM-DD HH:MM timestamp]
Status: PASS

Test Results: [paste showing failures - expected]

Next Phase: P23 (RemoteAgentInvocation Implementation)
```
