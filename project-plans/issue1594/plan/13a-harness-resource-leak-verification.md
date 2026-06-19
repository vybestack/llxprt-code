# Phase 13a: Resource-Leak Harness Verification

## Phase ID

`PLAN-20260617-COREAPI.P13a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 13 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P13" packages/agents/src/api/__tests__/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P13"
grep -rn "toHaveBeenCalled\|not\.toThrow" packages/agents/src/api/__tests__/disposal.spec.ts packages/agents/src/api/__tests__/scheduler-factory.spec.ts && echo "FAIL" || echo "OK"
```

## Semantic Verification Checklist (MANDATORY)

1. Does T13 assert EACH ownership-table row's disposed flag (cite the table)?
2. Is idempotent re-dispose tested?
3. Is the AggregateDisposeError partial-failure path induced and asserted?
4. Does T19 prove the injected scheduler factory is used and torn down?
5. Behavioral (observable teardown), not "dispose was called"?
6. Fail naturally pending P24/P23?

### Holistic Functionality Assessment (completion marker)

- Confirm leak suite is table-driven and would catch a missed teardown.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if per-row, idempotent, error-path, factory teardown all covered behaviorally.

## Failure Recovery

- Return to Phase 13.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P13a.md`
