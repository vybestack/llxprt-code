# Phase 23a: Hooks / Scheduler Factory / Sandbox Verification

## Phase ID

`PLAN-20260617-COREAPI.P23a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 23 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P23" packages/agents/src/api/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P23"
npm test -- --testNamePattern "T15b\|T15c\|T19\b\|T18e"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/hooks.ts packages/agents/src/api/createAgent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Does hooks.onHookExecution observe a real scripted hook firing?
2. Do SessionStart (create) and SessionEnd (dispose) fire?
3. Does save_memory refresh the system instruction for the next turn?
4. Is the injected scheduler factory genuinely used and torn down on dispose?
5. Does sandbox route tool execution from the first turn with status reported?

### Holistic Functionality Assessment (completion marker)

- Trace hook firing observation + scheduler-factory teardown.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if hooks/scheduler/sandbox behaviorally correct, T-rows green.

## Failure Recovery

- Return to Phase 23.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P23a.md`
