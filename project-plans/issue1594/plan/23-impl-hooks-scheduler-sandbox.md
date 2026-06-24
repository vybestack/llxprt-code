# Phase 23: Impl — Hooks / Lifecycle + Scheduler Factory + Sandbox [GREEN: T15b, T15c, T19, T18e]

## Phase ID

`PLAN-20260617-COREAPI.P23`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 22a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P22a.md`

## Requirements Implemented (Expanded)

### REQ-015: hooks/lifecycle

**Full Text**: `agent.hooks` observes HOOK_EXECUTION_REQUEST/RESPONSE on the
MessageBus and triggers session-lifecycle hooks (SessionStart on create, SessionEnd on
dispose, clear). save_memory tool refreshes memory/system-instruction for the next turn.

**Behavior**:
- GIVEN hooks and save_memory are configured
- WHEN an Agent is created, a hook executes, save_memory runs, and the Agent is disposed
- THEN SessionStart/SessionEnd and hook execution are observable through `agent.hooks`,
  and the next turn sees refreshed memory/system instruction

**Why This Matters**: The CLI must render hook lifecycle and memory refresh without
importing the message bus or hook internals.

### REQ-006 (scheduler factory portion) + sandbox status (REQ-002 sandbox field)

**Full Text**: The Agent owns scheduler creation by default AND allows an injected
scheduler factory for interactive/subagent cases; scheduler instances created through that factory are torn down on dispose while the caller-owned factory function is not disposed. Sandbox is
agent-instance config (chosen at createAgent), routing tool execution from the first
turn; the Agent exposes sandbox STATUS (active/command/image); changing sandbox is
recreate/app-service, not live mutation.

**Behavior**:
- GIVEN a caller supplies a scheduler factory and sandbox config at createAgent
- WHEN tools/subagents execute and Agent status is queried
- THEN the factory-created scheduler instance is used and disposed, the caller-owned factory function is left alone, and sandbox settings affect execution
  from the first turn, and only sandbox status (not live mutation) is public

**Why This Matters**: Interactive/subagent tool execution and sandbox reporting must
be public without making sandbox mode unsafe to mutate mid-turn.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/control/hooks.ts` — hooks sub-surface (observe + trigger).
- `packages/agents/src/api/createAgent.ts` — accept injected scheduler factory; wire
  SessionStart trigger (already added P15 — verify ordering); sandbox config routing +
  status accessor.
- `packages/agents/src/api/agent.ts` — sandbox status accessor; scheduler factory teardown registration.
  - `@plan:PLAN-20260617-COREAPI.P23` + `@requirement:REQ-015`/`REQ-006`/`REQ-002`.

### Implementation Rules

- SessionStart fires on create; SessionEnd on dispose (wired in P24 dispose order).
- Injected scheduler factory used for subagent/interactive calls; created scheduler instances are registered for dispose, factory function itself is not disposed.
- Sandbox is instance config; expose status only (no live mutation).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P23"
npm test -- --testNamePattern "T15b\|T15c\|T19\b\|T18e"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/hooks.ts packages/agents/src/api/createAgent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/hooks.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] hooks.onHookExecution observes a scripted hook (T15b)
- [ ] SessionStart on create, SessionEnd on dispose (T15b)
- [ ] save_memory refreshes system-instruction for next turn (T15c)
- [ ] injected scheduler factory used; created scheduler instances torn down, factory function not disposed (T19)
- [ ] sandbox routes from first turn + status reported (T18e)

## Success Criteria

- Hooks/scheduler-factory/sandbox working; named T-rows green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/hooks.ts packages/agents/src/api/createAgent.ts packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P23.md`
