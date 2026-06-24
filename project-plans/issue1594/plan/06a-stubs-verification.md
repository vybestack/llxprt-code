# Phase 06a: Stubs Verification

## Phase ID

`PLAN-20260617-COREAPI.P06a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 06 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P06" packages/agents/src/api/`

## Verification Commands

```bash
npm run typecheck
# No reverse-testing patterns anywhere in tests yet (there are none) — confirm no test asserts NotYetImplemented later
grep -rn "toThrow('NotYetImplemented')\|expect.*not\.toThrow" packages/agents/src/api/ && echo "FAIL reverse test" || echo "OK"
find packages/agents/src/api -name "*V2*" -o -name "*New*" && echo "FAIL duplicate" || echo "OK"
```

## Semantic Verification Checklist (MANDATORY)

1. Does the stub surface match the interface in `types.ts` exactly (every method present)?
2. Do stubs compile and NOT contain real logic?
3. Are there NO reverse-test hooks (stubs may throw NotYetImplemented, but nothing
   asserts it)?
4. Is `packages/agents/src/api/index.ts` limited to the new public API sub-barrel?
5. Does `packages/agents/src/index.ts` remain non-breaking for current low-level consumers until P07/#1595 (no required removal of AgentClient/CoreToolScheduler yet)?

### Holistic Functionality Assessment (completion marker)

- Confirm the stub is a faithful, compileable skeleton of the full control plane.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if full surface stubbed, compiles, no reverse-test hooks, no duplicates.

## Failure Recovery

- Return to Phase 06.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P06a.md`
