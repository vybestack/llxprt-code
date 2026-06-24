# Phase 20: Impl — History / Session / Recording / Checkpoint + Compression + Stats [GREEN: T6, T6b, T7, T8, T8b, T14b]

## Phase ID

`PLAN-20260617-COREAPI.P20`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 19a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P19a.md`

## Requirements Implemented (Expanded)

### REQ-010: history/session/recording/checkpointing

**Full Text**: getHistory(async)/setHistory({stripThoughts})/addHistory/restoreHistory/
resetChat/updateSystemInstruction/addDirectoryContext map onto `AgentClientContract`;
`agent.session` provides resume(latest|id|prefix), checkpoint create/restore, recording
swap. Stats: `getStats()` snapshot + `onStats()` live, normalized from the canonical
sources (`uiTelemetryService` via the legal core re-export
`@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` for tokens/usage;
HistoryService for turns) — consumers MUST NOT deep-import either and `agents` MUST
NOT import `@vybestack/llxprt-code-telemetry` directly.

**Behavior**:
- GIVEN an Agent with existing history, checkpoints, and token accounting
- WHEN clients call history/session/stats methods through the public Agent surface
- THEN the methods delegate to the current AgentClient/HistoryService/telemetry
  sources and return normalized public shapes without exposing internals

**Why This Matters**: CLI and non-CLI clients need history/session/stats without
copying Config/HistoryService internals or adding illegal package dependencies.

### REQ-011: compression (explicit + automatic)

**Full Text**: `compress()` returns CompressionResult (reduced token count);
automatic threshold compression mid-turn surfaces a `compression` stream event. The
two paths are kept distinct.

**Behavior**:
- GIVEN a conversation near or beyond compression thresholds
- WHEN explicit `compress()` runs or automatic compression triggers during a turn
- THEN explicit compression returns a `CompressionResult`, while automatic
  compression emits a public `compression` event during streaming

**Why This Matters**: Consumers must be able to control manual compression and render
automatic compression notices without conflating the two flows.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts` — history methods delegating to
  `config.getAgentClient()` contract methods (getHistory async, etc.); `getStats`/
  `onStats` reading `uiTelemetryService` via `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js`
  for tokens + HistoryService for turns, normalized to SessionStats; `compress()` explicit path.
- `packages/agents/src/api/control/session.ts` — resume/checkpoint/recording.
  - `@plan:PLAN-20260617-COREAPI.P20` + `@requirement:REQ-010`/`REQ-011`.

### Implementation Rules

- getHistory is ASYNC (contract). Do not synchronously snapshot.
- Stats normalized from the core telemetry re-export + HistoryService — no deep import leaked to consumer.
- Keep explicit vs automatic compression distinct (T8).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P20"
npm test -- --testNamePattern "T6\b\|T6b\|T7\b\|T8\b\|T8b\|T14b"
! grep -rn "@vybestack/llxprt-code-telemetry" packages/agents/src/api packages/agents/src/api/control
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/session.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/session.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] getHistory async round-trips (T6); resetChat clears (T7)
- [ ] session resume/checkpoint restores state (T6b)
- [ ] explicit compress() returns reduced-count result; auto → compression event (T8)
- [ ] onStats updates from the core telemetry re-export + HistoryService (T8b)
- [ ] addHistory/updateSystemInstruction/addDirectoryContext take effect next turn (T14b)

## Success Criteria

- History/session/compression/stats working; named T-rows green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/session.ts packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P20.md`
