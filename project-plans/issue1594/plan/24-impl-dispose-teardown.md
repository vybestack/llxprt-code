# Phase 24: Impl — Full Dispose / Teardown (ownership table) [GREEN: T13]

## Phase ID

`PLAN-20260617-COREAPI.P24`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 23a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P23a.md`

## Requirements Implemented (Expanded)

### REQ-016: dispose ownership/teardown table

**Full Text**: `createAgent` owns every resource it creates; `Agent.dispose()` tears all
of them down (caller-supplied resources untouched). Idempotent; collects errors;
order per dispose.md: hooks.trigger('SessionEnd') → loop.cancelActiveRun() →
scheduler.dispose() → confirmationCoordinator.dispose() → unsubscribe busSubscriptions
→ config.dispose() → lspManager.shutdown() → extensionsManager.dispose() →
sessionLocks.release() → oauthManager.dispose?(); THROW AggregateDisposeError if errors.
Net-new cleanup: bus-subscription unsubscribe, LSP shutdown wiring, extensions dispose,
session-lock release.

**Behavior**:
- GIVEN an Agent with active loop, scheduler, bus subscriptions, MCP/LSP/extensions,
  session locks, and OAuth/runtime context resources
- WHEN `dispose()` is called once or repeatedly
- THEN every owned resource is torn down in the documented order, caller-owned
  resources are left alone, repeated dispose is a no-op, and partial failures are
  reported as an aggregate error after attempting all cleanup

**Why This Matters**: Agent clients must be able to create/dispose agents without
leaking scheduler sessions, MCP transports, LSP processes, or subscriptions.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts` — implement full `dispose()` EXACTLY per
  `analysis/pseudocode/dispose.md`:
  - `@pseudocode dispose.md steps 10-14` (idempotent disposed flag; errors[] collector)
  - `@pseudocode dispose.md steps 20,30,40-45,50-52,60,70-82,90` (ordered teardown of every ownership-table row, including scheduler instances created through injected factory)
  - `@pseudocode dispose.md steps 100-113` (THROW AggregateDisposeError after attempting all cleanup; safe helper collects errors)
  - `@plan:PLAN-20260617-COREAPI.P24` + `@requirement:REQ-016` + `@pseudocode` refs.
- Wire net-new cleanup: bus unsubscribe, `lspManager.shutdown()` (exists in
  configBase.ts but not invoked), extensions dispose, session-lock release.

### Implementation Rules

- Follow dispose.md order exactly; cite numbered pseudocode step labels.
- Idempotent (second dispose is a no-op, no throw on already-disposed).
- Reuse existing CoreToolScheduler.dispose / ConfirmationCoordinator.dispose / Config.dispose.

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P24"
npm test -- --testNamePattern "T13\b"
grep -c "@pseudocode" packages/agents/src/api/agent.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] Every ownership-table row torn down (T13 per-row disposed flags)
- [ ] Net-new cleanup (bus/LSP/extensions/session-locks) wired
- [ ] Idempotent re-dispose
- [ ] AggregateDisposeError on partial failure
- [ ] Pseudocode numbered-step refs present

## Success Criteria

- Full dispose working; T13 (all rows) green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts`; redo per dispose.md.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P24.md`
