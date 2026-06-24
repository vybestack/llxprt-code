# Phase 07: Export Strategy — Non-breaking Root + Power-user Subpath

## Phase ID

`PLAN-20260617-COREAPI.P07`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 06a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P06a.md`
**Non-breaking export warning:** Do not remove any existing top-level exports in #1594. This phase adds the public Agent API and `./internals.js` additively; the final top-level trim waits for #1595 after CLI/a2a migration.


## Requirements Implemented (Expanded)

### REQ-018: Export strategy + non-breaking root + power-user subpath

**Full Text**: The public API (`createAgent`, `Agent`, `AgentConfig`, `AgentEvent`,
`ApprovalMode`, `listProviders/Tools`, handler types) is exported from
`@vybestack/llxprt-code-agents`. A documented `./internals.js` power-user subpath is
added for low-level symbols, but #1594 is **non-breaking**: existing top-level
low-level exports remain until #1595 migrates current CLI/a2a consumers and performs
the final curated-entry trim. `core/index.ts` trim + CLI migration are sequenced into
**#1595** (NOT this issue).
**Behavior**:
- GIVEN: current CLI/a2a code still imports low-level symbols from the agents top-level
- WHEN: this phase runs
- THEN: the new public Agent API and `./internals.js` subpath are added without removing
  existing top-level low-level exports; #1595 owns the later removal.
**Why This Matters**: creates the future curated API without breaking current monorepo
consumers before the planned #1595 migration.

## Implementation Tasks

### Files to Modify

- `packages/agents/package.json` — keep `"."` pointing at the existing root (`dist/index.js` / `dist/index.d.ts`) and add `"./internals.js"` (and matching types) pointing at the new low-level subpath.
  - ADD comment is N/A (JSON); record in completion marker.
  - Verification must prove both old top-level low-level imports and new `./internals.js` imports compile.
- `packages/agents/src/index.ts` — additive, non-breaking top-level: re-export the new
  `./api/index.js` public Agent API while KEEPING existing low-level exports for
  current CLI/a2a compatibility. Do not perform the final curated-entry trim here.
- `packages/agents/src/internals.ts` (CREATE) — re-export the same low-level symbols
  (AgentClient, ChatSession, CoreToolScheduler, executeToolCall, SubagentOrchestrator,
  TaskTool, AgenticLoop, AgentDefinition/AgentExecutor, etc.) as the documented
  power-user path that #1595/current consumers can migrate to later.
  - MUST include `@plan:PLAN-20260617-COREAPI.P07` + `@requirement:REQ-018`.

### Constraints

- Do NOT break existing consumers that import low-level symbols from the top-level.
  This phase is additive. #1595 migrates CLI/a2a imports to `./internals.js` and then
  removes top-level low-level exports.
- No `core/index.ts` change here (that is #1595).

## Verification Commands

```bash
node -e "const p=require('./packages/agents/package.json'); if(!p.exports['./internals.js']) {console.error('FAIL no internals subpath'); process.exit(1)} console.log('OK subpath')"
grep -c "@plan:PLAN-20260617-COREAPI.P07" packages/agents/src/internals.ts
# Non-breaking strategy: top-level AgentClient may still exist until #1595; internals subpath must also expose it.
grep -n "AgentClient" packages/agents/src/internals.ts || { echo "FAIL internals missing AgentClient"; exit 1; }
npm run typecheck
npm run build
```

### Deferred Implementation Detection

```bash
grep -rnE "(TODO|FIXME|HACK)" packages/agents/src/internals.ts packages/agents/src/index.ts | grep -v ".spec.ts"
```

### Semantic Verification Checklist

- [ ] `./internals.js` subpath resolves (build output present)
- [ ] Top-level `.` entry exposes the new public Agent surface additively without breaking existing low-level imports
- [ ] Low-level symbols are also reachable via `./internals.js`; final removal from the top-level is deferred to #1595
- [ ] a2a-server + cli still typecheck without mandatory import migration in this phase
- [ ] No core/index.ts modification

## Success Criteria

- Build passes; curated + subpath exports established and documented.

## Failure Recovery

- `git checkout -- packages/agents/package.json packages/agents/src/index.ts`; remove
  `internals.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P07.md`
