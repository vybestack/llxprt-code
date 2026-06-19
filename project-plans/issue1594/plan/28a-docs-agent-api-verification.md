# Phase 28a: Docs Verification

## Phase ID

`PLAN-20260617-COREAPI.P28a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 28 completed
- Verification: `test -f project-plans/issue1594/.completed/P28.md`

## Verification Commands

```bash
missing=0
test -f docs/agent-api.md || { echo "MISSING: docs/agent-api.md"; missing=1; }
grep -q "@vybestack/llxprt-code-agents" docs/agent-api.md || { echo "MISSING: entry pkg statement"; missing=1; }
grep -q "createAgent" docs/agent-api.md || { echo "MISSING: createAgent"; missing=1; }
grep -q "AgentEvent" docs/agent-api.md || { echo "MISSING: AgentEvent"; missing=1; }
grep -q "DoneReason" docs/agent-api.md || { echo "MISSING: DoneReason"; missing=1; }
grep -q "internals.js" docs/agent-api.md || { echo "MISSING: internals subpath"; missing=1; }
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Does the FIRST section state the entry is `@vybestack/llxprt-code-agents` (B11)?
2. Does the quick-start example match the actual shipped API signatures?
3. Are the AgentEvent union, DoneReason, and exactly-one-done invariant documented?
4. Is no-handler confirmation documented as **safe denial** (B7), not throw, on the
   public path?
5. Are auth precedence and context-preservation documented correctly?
6. Are the subpath strategy and runtime-vs-app boundary documented?
7. Are the open-question decisions recorded with rationale?

### Holistic Functionality Assessment (completion marker)

- Confirm a reader could build + stream an agent from the doc alone.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if docs are accurate and complete for REQ-020.

## Failure Recovery

- Return to Phase 28.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P28a.md`
