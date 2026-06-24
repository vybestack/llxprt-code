# Phase 24a: Full Dispose / Teardown Verification (incl. pseudocode compliance)

## Phase ID

`PLAN-20260617-COREAPI.P24a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 24 completed
- Verification: `grep -c "@pseudocode" packages/agents/src/api/agent.ts`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P24"
npm test -- --testNamePattern "T13\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Pseudocode Compliance Review (MANDATORY — deepthinker)

- Compare dispose() with `analysis/pseudocode/dispose.md` numbered steps 10-14, 20, 30, 40-45, 50-52, 60, 70-82, 90, and 100-113: order exact, every row present, idempotency + AggregateDisposeError implemented.

## Semantic Verification Checklist (MANDATORY)

1. Is EVERY ownership-table row actually torn down (trace each)?
2. Are the net-new cleanups (bus/LSP/extensions/session-locks) wired and effective?
3. Is dispose idempotent (second call no-op, no throw)?
4. Does partial failure produce AggregateDisposeError with all errors?
5. Does T13 assert per-row disposed flags (not a generic no-handle check) and pass?

### Holistic Functionality Assessment (completion marker)

- Trace dispose order; identify any resource that could leak.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if all rows torn down, pseudocode followed, T13 green.

## Failure Recovery

- Return to Phase 24.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P24a.md`
