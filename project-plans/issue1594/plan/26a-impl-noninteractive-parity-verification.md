# Phase 26a: Non-interactive Mode Parity Verification

## Phase ID

`PLAN-20260617-COREAPI.P26a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 26 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P26" packages/agents/src/api/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P26"
npm test -- --testNamePattern "T22\b"
npm run typecheck
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Does AgentResult carry everything runNonInteractive needs (text/toolCalls/finishReason/error/usage)?
2. Is finishReason correctly derived from DoneReason?
3. Does the yolo/onApproval path auto-answer tools headlessly?
4. Is there no CLI/internal deep import?

### Holistic Functionality Assessment (completion marker)

- Trace a headless single-prompt run → AgentResult → output-format mapping feasibility.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if AgentResult complete and T22 green.

## Failure Recovery

- Return to Phase 26.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P26a.md`
