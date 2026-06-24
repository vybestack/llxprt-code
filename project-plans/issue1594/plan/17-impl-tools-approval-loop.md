# Phase 17: Impl — Tools / Approval / Confirmation Merge / Loop [GREEN: T2, T2b, T3, T3b, T3c, T11, T21]

## Phase ID

`PLAN-20260617-COREAPI.P17`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 16a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P16a.md`

## Requirements Implemented (Expanded)

### REQ-006: tools/scheduler/confirmation (correlationId + dual consumer paths)

**Full Text**: `agent.tools` exposes list/setEnabled/onConfirmationRequest/
respondToConfirmation/onToolUpdate/setEditorCallbacks. Confirmation projects BOTH
`confirmationId`(=correlationId) and `toolCallId`; respondToConfirmation keys on
correlationId, publishes TOOL_CONFIRMATION_RESPONSE, dedups one logical confirmation,
and re-keys on ModifyWithEditor. **No-handler / handler-rejection behavior is OWNED BY
`AgenticLoop` (B7), NOT this surface**: the public path delegates to the loop, whose
verified behavior is — no `approvalHandler` + ASK_USER non-interactive → SAFE TOOL
DENIAL (denied `tool-result`, NOT a throw; `AgenticLoop.ts:29-32`); handler rejection →
`ToolConfirmationOutcome.Cancel` (`AgenticLoop.ts:237-247`). This control surface does
NOT throw on the high-level path. The `confirmation-coordinator` throw
(`confirmation-coordinator.ts:320-325`, `!isInteractive()`) is exposed ONLY on the raw
`./internals.js` power-user path. The merged stream surfaces tool-status; a raw
unmerged stream option serves the a2a path.

**Behavior**:
- GIVEN a tool call that requires confirmation
- WHEN the public Agent stream is consumed and the caller responds by confirmationId
- THEN the response is routed by correlationId, tool status/results are emitted once,
  and denial/safe-no-handler behavior follows AgenticLoop rather than throwing

**Why This Matters**: Tool approval is a core CLI/GUI integration point; conflating
correlationId/toolCallId or raw/high-level behavior breaks multi-tool turns.

### REQ-007: high-level tool-loop via AgenticLoop wrapping

**Full Text**: chat()/stream() delegate to AgenticLoop.run; onApproval wires to the
loop's approvalHandler; editor/display callbacks via the loop; one active run per
agent; multi-tool sequencing (deferred completion, single continuation, no overlap).

**Behavior**:
- GIVEN a multi-tool model turn
- WHEN `agent.stream()` runs through the high-level loop
- THEN AgenticLoop schedules tools, records results, submits exactly one continuation,
  and the public stream exposes the normalized sequence without reimplementing the loop

**Why This Matters**: The public Agent must wrap the shipped loop so all consumers get
one consistent scheduling/continuation implementation.

## Implementation Tasks

### Files to Modify

- `packages/agents/src/api/control/tools.ts` — implement the tools sub-surface +
  confirmation merge EXACTLY per `analysis/pseudocode/tool-confirmation-merge.md`:
  - `@pseudocode tool-confirmation-merge.md steps 10-31` (seen-Set dedup by confirmationId; subscribe TOOL_CONFIRMATION_REQUEST; project {confirmationId: msg.correlationId, toolCallId: msg.callId, ...}; emit tool-confirmation + callback)
  - `@pseudocode tool-confirmation-merge.md steps 40-45` (scheduler.onStatusUpdate → public tool-status)
  - `@pseudocode tool-confirmation-merge.md steps 60-71` (respondToConfirmation: throw on UNKNOWN id only; publish RESPONSE keyed by correlationId; on 'modify' delete id for re-key)
  - `@pseudocode tool-confirmation-merge.md steps 80-89` (B7: no-handler/handler-rejection delegated to AgenticLoop safe denial; this surface does NOT throw on the public path)
- `packages/agents/src/api/agent.ts` — wire onApproval → AgenticLoop approvalHandler;
  editor/display callbacks; raw-unmerged-stream option for a2a (T2b).
  - `@plan:PLAN-20260617-COREAPI.P17` + `@requirement:REQ-006`/`REQ-007` + `@pseudocode` refs.

### Implementation Rules

- Use real CoreToolScheduler/MessageBus/ConfirmationCoordinator from agents.
- Do NOT re-implement the tool loop — delegate to AgenticLoop.
- respondToConfirmation keys on correlationId, NOT tool name (R-CORR).

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P17"
npm test -- --testNamePattern "T2\b\|T2b\|T3\b\|T3b\|T3c\|T11\b\|T21\b"
grep -c "@pseudocode" packages/agents/src/api/control/tools.ts
```

### Deferred Implementation Detection (MANDATORY)

```bash
grep -rnE "(TODO|FIXME|HACK|STUB|XXX|WIP)" packages/agents/src/api/control/tools.ts packages/agents/src/api/agent.ts | grep -v ".spec.ts" && echo FAIL || echo OK
grep -rnE "(in a real|for now|placeholder|not yet|will be)" packages/agents/src/api/control/tools.ts | grep -v ".spec.ts" && echo FAIL || echo OK
```

### Semantic Verification Checklist

- [ ] Confirmation carries both confirmationId(correlationId) + toolCallId
- [ ] respondToConfirmation keys on correlationId; dedups; re-keys on modify
- [ ] No-handler/handler-rejection → AgenticLoop safe denial (B7); public path does NOT throw
- [ ] Coordinator throw exposed only on raw ./internals.js path
- [ ] tool-status merged; raw unmerged stream serves a2a (T2b)
- [ ] Multi-tool sequencing via real loop (T21)
- [ ] Pseudocode numbered-step refs present

## Success Criteria

- Tools/approval/loop working; named T-rows green; no deferred-impl.

## Failure Recovery

- `git checkout -- packages/agents/src/api/control/tools.ts packages/agents/src/api/agent.ts`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P17.md`
