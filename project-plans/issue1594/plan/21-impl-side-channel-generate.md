# Phase 21: Impl — Side-channel generate / generateJson / generateEmbedding [GREEN: T10]

## Phase ID

`PLAN-20260617-COREAPI.P21`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 20a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P20a.md`

## Requirements Implemented (Expanded)

### REQ-012: side-channel generate/generateJson/generateEmbedding

**Full Text**: `generate(input)`, `generateJson(contents, schema)`,
`generateEmbedding(texts)` expose the detached side-channel paths (mapping onto
`generateDirectMessage`/`generateContent`/`generateJson`/`generateEmbedding`). By
default DETACHED: no tool loop, no chat-history mutation; GenerateOptions allow
explicit model/config/signal overrides and opt-in history read/write.

**Behavior**:
- GIVEN an Agent with existing chat history
- WHEN `generate`, `generateJson`, or `generateEmbedding` is called with default options
- THEN the call uses the current client side-channel contract, returns the requested
  value shape, emits no tool-loop events, and does not mutate chat history

**Why This Matters**: Auto-prompt, summaries, structured generation, and embeddings
must be available to clients without starting a conversation turn or duplicating
AgentClient internals.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts` — implement generate/generateJson/
  generateEmbedding delegating to the current client's contract methods; default
  detached (no history mutation, no tool events).
  - `@plan:PLAN-20260617-COREAPI.P21` + `@requirement:REQ-012`.

### Implementation Rules

- Default detached: assert no `tool-call`/`tool-result` events and history unchanged.
- generateEmbedding(texts: string[]) → Promise<number[][]> (contract signature).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P21"
npm test -- --testNamePattern "T10\b"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] generate() returns string without tool-loop events or history mutation (T10)
- [ ] generateJson returns schema-shaped object
- [ ] generateEmbedding returns number[][]
- [ ] Detached-by-default verified

## Success Criteria

- Side-channel generation working; T10 green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P21.md`
