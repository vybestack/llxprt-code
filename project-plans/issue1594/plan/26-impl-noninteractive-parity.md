# Phase 26: Impl — Non-interactive Mode Parity (AgentResult / output-format) [GREEN: T22]

## Phase ID

`PLAN-20260617-COREAPI.P26`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 25a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P25a.md`

## Requirements Implemented (Expanded)

### REQ-021 (non-interactive portion): runNonInteractive parity via AgentResult

**Full Text**: `chat()` returns AgentResult `{ text, toolCalls, finishReason, error?,
usage? }` — sufficient for #1595 to drive runNonInteractive: map `--output-format`
(text|json), stdout/stderr separation, no-confirm/yolo auto-answers, and exit/error
mapping — all without deep imports.

**Behavior**:
- GIVEN a headless non-interactive prompt, output-format choice, and approval mode
- WHEN `agent.chat()` drains the public stream
- THEN it returns a complete `AgentResult` that a CLI wrapper can render to text/json,
  split stdout/stderr, auto-answer tools where configured, and choose exit status

**Why This Matters**: Non-interactive CLI must be rewritten as a thin wrapper over
the public API instead of reconstructing stream/result/error handling from internals.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/agent.ts` — ensure `chat()` produces a complete AgentResult
  (drain stream → text + toolCalls + finishReason from `done` + usage from stats +
  error from `error`/`done`); ensure yolo/onApproval auto-answer path is reachable headlessly.
  - `@plan:PLAN-20260617-COREAPI.P26` + `@requirement:REQ-021`.

### Implementation Rules

- finishReason maps from DoneReason; error populated on error/aborted terminal paths.
- No CLI import; AgentResult must carry everything runNonInteractive needs.

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P26"
npm test -- --testNamePattern "T22\b"
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] AgentResult carries text/toolCalls/finishReason/error/usage (T22)
- [ ] finishReason derived from DoneReason
- [ ] yolo/onApproval auto-answers tools headlessly
- [ ] No CLI/internal deep import

## Success Criteria

- Non-interactive parity working; T22 green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P26.md`
