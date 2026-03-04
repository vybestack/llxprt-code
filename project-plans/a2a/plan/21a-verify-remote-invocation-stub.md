# Phase 21a: RemoteAgentInvocation Stub - Verification

## Phase ID

`PLAN-20260302-A2A.P21a`

## Prerequisites

- Required: Phase 21 completed
- Verification: remote-invocation.ts created

## Verification Tasks

### Structural Checks

```bash
# File exists
ls -la packages/core/src/agents/remote-invocation.ts

# Class extends BaseToolInvocation
grep "extends BaseToolInvocation" packages/core/src/agents/remote-invocation.ts

# Constructor accepts required parameters
grep -A 10 "constructor" packages/core/src/agents/remote-invocation.ts

# execute method returns ToolResult
grep "async execute" packages/core/src/agents/remote-invocation.ts

# getConfirmationDetails exists
grep "getConfirmationDetails" packages/core/src/agents/remote-invocation.ts

# Type check
npm run typecheck
```

### Verification Checklist

- [ ] remote-invocation.ts exists
- [ ] RemoteAgentInvocation extends BaseToolInvocation<AgentInputs, ToolResult>
- [ ] Constructor: params, definition, sessionState, messageBus, displayName
- [ ] Private fields: definition, sessionState
- [ ] execute() returns empty ToolResult (stub)
- [ ] getConfirmationDetails() returns info-type confirmation
- [ ] getDescription() returns string
- [ ] @plan markers present
- [ ] @requirement markers present
- [ ] TypeScript compiles
- [ ] No TODO comments

## Success Criteria

All checkboxes checked, TypeScript compiles.

## Phase Completion Marker

Create: `project-plans/gmerge-0.24.5/a2a/plan/.verified/P21a-report.md`

Contents:
```markdown
Phase: P21a
Verified: [YYYY-MM-DD HH:MM timestamp]
Status: PASS

TypeCheck: PASS

Next Phase: P22 (RemoteAgentInvocation TDD)
```
