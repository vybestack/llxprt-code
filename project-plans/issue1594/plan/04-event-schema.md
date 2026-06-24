# Phase 04: AgentEvent Union + Zod Schema (event-schema)

## Phase ID

`PLAN-20260617-COREAPI.P04`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 03a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P03a.md`

## Requirements Implemented (Expanded)

### REQ-003: Typed AgentEvent union (types + schema only here)

**Full Text**: `agent.stream()` yields a stable public `AgentEvent` discriminated
union (19 variants) decoupled from internal `ServerGeminiStreamEvent`, with a
`DoneReason` enum; exactly one `done` terminates a stream.
**Behavior**:
- GIVEN: the 21 internal `GeminiEventType` variants
- WHEN: the public union is defined
- THEN: all 19 public variants + the 7 `DoneReason` values exist as Zod-validated
  types, discriminated on `type`
**Why This Matters**: stable public events let internals change without breaking #1595.

### REQ-003: Event projection payload types

**Full Text**: The public event stream MUST expose stable public payload types —
`AgentToolCall`, `AgentToolResult`, `ToolConfirmation`, `ToolUpdate`,
`AgentStopInfo`, `ThoughtSummary`, `UsageMetadataValue`, `ModelInfo`,
`ChatCompressionInfo`, and `StructuredError` — instead of leaking raw internal
fields such as `prompt_id`, `responseParts`, or `errorType`.

**Behavior**:
- GIVEN: internal stream/tool/scheduler payloads contain implementation-specific fields
- WHEN: the public event payload types are defined
- THEN: consumers receive only stable, documented fields while lossy omissions are
  intentional and documented.

**Why This Matters**: Public clients need stable event payloads even when internal
turn, scheduler, or provider payload structures change.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/event-types.ts` — the `AgentEvent` discriminated union
  (19 variants), `DoneReason` (7 values), and event-payload projection types.
  - MUST include: `@plan:PLAN-20260617-COREAPI.P04`, `@requirement:REQ-003`
- `packages/agents/src/api/event-schema.ts` — Zod `AgentEventSchema`
  (discriminated on `type`), `DoneReasonSchema`, projection schemas.
  - MUST include plan/requirement markers.

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260617-COREAPI.P04
 * @requirement REQ-003
 */
```

### Constraints (RULES.md)

- Strict TypeScript: NO `any`, NO type assertions, explicit return types.
- Zod schema-first; discriminated union on `type` for AgentEvent.
- Immutable: prefer `readonly` arrays/fields.
- NO production logic — type/schema definitions only.
- Keep `@plan`/`@requirement` markers minimal (one marker block per file).

## Verification Commands

```bash
set -e
missing=0
grep -rqc "@plan:PLAN-20260617-COREAPI.P04" packages/agents/src/api/ || { echo "MISSING plan marker"; missing=1; }
# All 19 AgentEvent variants present
for v in text thinking tool-call tool-result tool-confirmation tool-status usage model-info notice compression context-warning retry citation loop-detected idle-timeout invalid-stream hook-blocked error done; do
  grep -q "'$v'" packages/agents/src/api/event-types.ts || grep -q "'$v'" packages/agents/src/api/event-schema.ts || { echo "MISSING variant $v"; missing=1; }
done
# DoneReason values
for d in stop aborted max-turns context-overflow loop-detected error hook-stopped; do
  grep -q "'$d'" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts || { echo "MISSING DoneReason $d"; missing=1; }
done
npm run typecheck
grep -rnE ": any\b|as [A-Z]" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts && { echo "FAIL: any/assertion"; missing=1; } || true
exit $missing
```

### Deferred Implementation Detection

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX)" packages/agents/src/api/event-types.ts packages/agents/src/api/event-schema.ts | grep -v ".spec.ts"
# Expected: none
```

### Semantic Verification Checklist

- [ ] All 19 AgentEvent variants + 7 DoneReason values present
- [ ] Discriminated on `type`
- [ ] Projection types drop internal fields (no prompt_id/responseParts/errorType)
- [ ] Payload field names match `specification.md` §4.4 mapping table exactly
- [ ] `npm run typecheck` clean

## Success Criteria

- event-types.ts + event-schema.ts compile; complete event surface.

## Failure Recovery

- `git checkout -- packages/agents/src/api/`; redo with full variant coverage.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P04.md`
