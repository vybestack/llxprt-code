# Phase 20a: History / Session / Compression / Stats Verification

## Phase ID

`PLAN-20260617-COREAPI.P20a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 20 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P20" packages/agents/src/api/`

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P20"
npm test -- --testNamePattern "T6\b\|T6b\|T7\b\|T8\b\|T8b\|T14b"
npm run typecheck
! grep -rn "@vybestack/llxprt-code-telemetry" packages/agents/src/api packages/agents/src/api/control
grep -rnE "(TODO|FIXME|HACK|STUB)" packages/agents/src/api/control/session.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

## Semantic Verification Checklist (MANDATORY)

1. Is getHistory async and does it round-trip (T6)?
2. Does resetChat clear context for the next turn (T7)?
3. Do explicit and automatic compression remain distinct (T8)?
4. Are stats normalized from `uiTelemetryService` via `@vybestack/llxprt-code-core/telemetry/uiTelemetry.js` + HistoryService, with no direct `@vybestack/llxprt-code-telemetry` import?
5. Do session resume/checkpoint restore state (T6b)?

### Holistic Functionality Assessment (completion marker)

- Trace setHistory → getHistory round-trip and a compression event.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if history/session/compression/stats behaviorally correct, T-rows green.

## Failure Recovery

- Return to Phase 20.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P20a.md`
