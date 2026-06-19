# Phase 21a: Side-channel Generate Verification

## Phase ID

`PLAN-20260617-COREAPI.P21a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 21 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P21" packages/agents/src/api/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P21"
npm test -- --testNamePattern "T10\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Does generate() return a string with NO tool-loop events?
2. Is chat history genuinely unchanged after generate() (detached)?
3. Does generateJson return a schema-shaped object?
4. Does generateEmbedding return number[][]?

### Holistic Functionality Assessment (completion marker)

- Trace generate() → detached client → string; confirm no history side-effect.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if detached-by-default proven and T10 green.

## Failure Recovery

- Return to Phase 21.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P21a.md`
