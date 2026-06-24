# Phase 13: Harness Layer 5 — Resource Leak / Disposal (T13, T19) [RED]

## Phase ID

`PLAN-20260617-COREAPI.P13`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 12a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P12a.md`

## Requirements Implemented (Expanded)

### REQ-016: dispose ownership / teardown table (T13)

**Full Text**: `dispose()` tears down every resource `createAgent` owns; each row of
the §4.3 resource-ownership/teardown table is verified torn down via disposed flags
(AgentClient, MCP transports, extensions, LSP, scheduler, ConfirmationCoordinator,
bus subscriptions, session locks) — not a generic no-open-handles check.
**Behavior**: GIVEN a created Agent, WHEN dispose() resolves, THEN each owned
resource's disposed flag is true and re-dispose is idempotent.

**Why This Matters**: Agent consumers must be able to dispose resources deterministically
without leaking schedulers, transports, subscriptions, or locks.

### REQ-006: External/subagent scheduler factory (T19)

**Full Text**: An injected scheduler factory routes subagent/interactive tool calls
and is torn down on dispose(), preserving the public tool/scheduler control plane
without deep imports.
**Behavior**: GIVEN an injected factory, WHEN a tool runs then dispose() is called,
THEN the factory-created scheduler instance is used and disposed, while the caller-owned factory function itself is not disposed.

**Why This Matters**: Interactive/subagent tool scheduling must be pluggable without
forcing clients to import scheduler internals.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/disposal.spec.ts` — T13: one assertion per
  ownership-table row (disposed flag), idempotent re-dispose, AggregateDisposeError
  on partial failure (induced).
- `packages/agents/src/api/__tests__/scheduler-factory.spec.ts` — T19: injected
  factory used + disposed.
  - `@plan:PLAN-20260617-COREAPI.P13` `@requirement:REQ-016` and `@requirement:REQ-006` on scheduler-factory tests

### Test Rules

- Real Agent + real resources; assert disposed flags / observable teardown (e.g. bus
  has no subscriptions, scheduler.disposed === true), never "dispose was called".
- Fail naturally pending P24 (full dispose) / P23 (scheduler factory). NO reverse tests.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P13"
grep -rq "@plan:PLAN-20260617-COREAPI.P13" packages/agents/src/api/__tests__/ || { echo "MISSING plan marker"; missing=1; }
# ownership-table rows asserted
for r in agentClient scheduler confirmationCoordinator messageBus lsp extensions sessionLock; do
  grep -iq "$r" packages/agents/src/api/__tests__/disposal.spec.ts || { echo "MISSING row $r"; missing=1; }
done
# mock-theater / reverse-test guard (must NOT match)
grep -rn "toHaveBeenCalled\|not\.toThrow" packages/agents/src/api/__tests__/disposal.spec.ts && { echo "FAIL mock/reverse"; missing=1; }
exit $missing
```

### Semantic Verification Checklist

- [ ] Per-row disposed-flag assertions (not generic handle check)
- [ ] Idempotent re-dispose tested
- [ ] AggregateDisposeError path induced + asserted
- [ ] T19 injected-factory used + disposed
- [ ] Fail naturally pending P24/P23

## Success Criteria

- Layer-5 suite exists, tagged, fails naturally.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P13.md`
