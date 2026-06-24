# Phase 04a: AgentEvent Union + Schema Verification

## Phase ID

`PLAN-20260617-COREAPI.P04a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 04 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P04" packages/agents/src/api/`

## Verification Commands

```bash
set -e
missing=0
npm run typecheck
for v in text thinking tool-call tool-result tool-confirmation tool-status usage model-info notice compression context-warning retry citation loop-detected idle-timeout invalid-stream hook-blocked error done; do
  grep -q "'$v'" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts || { echo "MISSING $v"; missing=1; }
done
for d in stop aborted max-turns context-overflow loop-detected error hook-stopped; do
  grep -q "'$d'" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts || { echo "MISSING DoneReason $d"; missing=1; }
done
grep -rnE ": any\b|as [A-Z][A-Za-z]+" packages/agents/src/api/event-types.ts && { echo "FAIL any/assertion"; missing=1; } || true
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Are all 19 AgentEvent variants present and discriminated on `type`?
2. Are DoneReason's 7 values present?
3. Do event payload field names match `specification.md` §4.4 mapping table exactly
   (e.g. `thinking.thought: ThoughtSummary`, `citation.citation: string`,
   `context-warning` carries `estimatedRequestTokenCount`/`remainingTokenCount`)?
4. Do projection types intentionally drop internal fields (cite which)?
5. No `any`, no assertions, explicit return types, readonly where appropriate?

### Holistic Functionality Assessment (completion marker)

- Describe the public event surface.
- Confirm it can express every harness event-row's outputs.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if event surface complete, typecheck clean, no `any`/assertions.

## Failure Recovery

- Return to Phase 04 with specific missing-variant list.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P04a.md`
