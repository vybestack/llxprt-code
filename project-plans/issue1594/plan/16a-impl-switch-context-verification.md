# Phase 16a: Switch + Context Preservation Verification

## Phase ID

`PLAN-20260617-COREAPI.P16a`

## LLxprt Code Subagent: deepthinker

## Prerequisites

- Required: Phase 16 completed
- Verification: `grep -c "@pseudocode" packages/agents/src/api/agent.ts`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P16"
npm test -- --testNamePattern "T4\b\|T4b\|T4c\|T4d\|T4e\|T4f\|T5\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/*.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Pseudocode Compliance Review (MANDATORY — deepthinker)

- Compare switch methods with `analysis/pseudocode/switch-rebind.md` numbered steps 10-26, 30-37, 50-58, 70-78, and 90-111.
- Confirm the REQ-005 identity assertion is in the implementation, not just the test.
- Confirm no re-implementation of history copy (delegates to Config transfer path).

## Semantic Verification Checklist (MANDATORY)

1. Is the B1 rebuild hook correctly pinned and used (trace the call)?
2. Is `existingHistoryService === newHistoryService` genuinely preserved after switch?
3. Is manual switch identical to LB failover (same path)?
4. Is stripThoughts normalization applied switching into an incompatible provider?
5. Is chat NOT reset (follow-up sees prior context)?

### Holistic Functionality Assessment (completion marker)

- Trace setProvider → runtime mutator → rebuild → history transfer → rebind.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if context preserved by identity, pseudocode followed, T4*/T5 green.

## Failure Recovery

- Return to Phase 16.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P16a.md`
