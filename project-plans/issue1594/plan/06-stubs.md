# Phase 06: createAgent / Agent + Sub-surface Stubs

## Phase ID

`PLAN-20260617-COREAPI.P06`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 05a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P05a.md`
- Expected files from P03-P05: `packages/agents/src/api/config-types.ts`,
  `config-schema.ts`, `event-types.ts`, `event-schema.ts`, `agent.ts`

## Requirements Implemented (Expanded)

### REQ-001 (stub): createAgent factory + Agent facade skeleton

**Full Text**: `createAgent(config): Promise<Agent>` composes provider manager +
Config + AgentClient + AgenticLoop and returns an Agent control plane.
**Behavior** (stub phase):
- GIVEN: an AgentConfig
- WHEN: createAgent is called against the stub
- THEN: it compiles and returns an object shaped like Agent whose methods exist but
  are NOT yet implemented (throw `new Error('NotYetImplemented')` OR return empty
  typed values) — **NO reverse-test hooks**.
**Why This Matters**: stubs let the harness (P09–P13) compile + fail naturally.

(Stubs cover ALL Agent methods + sub-surfaces: profiles/tools/mcp/auth/ide/session/
hooks, generate*, listProviders/listTools, dispose, and module-level
`listProviders`/`listTools`.)

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/createAgent.ts` — `export async function createAgent(...)`
  returning an `Agent` stub instance.
- `packages/agents/src/api/agent.ts` — `Agent` class implementing the interface; all
  methods throw `new Error('NotYetImplemented')` or return empty typed values.
- `packages/agents/src/api/control/` — sub-surface stub classes (profilesControl,
  toolControl, mcpControl, authControl, ideControl, sessionControl, hookControl).
- `packages/agents/src/api/discovery.ts` — module-level `listProviders`/`listTools`
  stubs.
- `packages/agents/src/api/index.ts` — curated **new API sub-barrel** for
  createAgent, Agent type, AgentConfig, AgentEvent, handlers, and discovery helpers.
  This phase does NOT trim `packages/agents/src/index.ts` and does NOT remove
  existing low-level top-level exports; P07 wires exports additively.
  - All files MUST include `@plan:PLAN-20260617-COREAPI.P06` + relevant `@requirement`.

### Constraints

- UPDATE/extend existing files; do NOT create `*V2`.
- Stubs ≤ minimal; compile under strict TS.
- **NO reverse testing artifacts** — stubs must not reference NotYetImplemented in a
  way tests would assert against. Tests (later) check real behavior.
- Max stub body trivial; no business logic.

## Verification Commands

```bash
npm run typecheck
grep -rc "@plan:PLAN-20260617-COREAPI.P06" packages/agents/src/api/
# Stub returns/throws OK in stub phase (NotYetImplemented allowed here only)
grep -rn "NotYetImplemented" packages/agents/src/api/ | wc -l
# No V2/duplicate
find packages/agents/src/api -name "*V2*" -o -name "*New*" -o -name "*Copy*" && echo "FAIL duplicate" || echo "OK"
# No TODO
grep -rnE "(TODO|FIXME)" packages/agents/src/api/ | grep -v ".spec.ts" && echo "FAIL TODO" || echo "OK"
```

### Structural Verification Checklist

- [ ] All Agent methods + sub-surfaces stubbed
- [ ] Compiles (`npm run typecheck`)
- [ ] No reverse-test hooks; no parallel versions
- [ ] `packages/agents/src/api/index.ts` exports only the new public API sub-barrel
- [ ] Existing `packages/agents/src/index.ts` low-level exports remain untouched until P07/#1595

## Success Criteria

- Everything compiles; the full public surface exists as stubs.

## Failure Recovery

- `git checkout -- packages/agents/src/api/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P06.md`
