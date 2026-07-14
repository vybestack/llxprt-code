# Phase 22: Subagent slice — characterization TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P22`

## Prerequisites
- Required: Phase 21 completed (cross-package contract flip green).
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P21" packages/agents/src packages/cli/src packages/core/src`
- Expected files from previous phase: `packages/core/src/core/clientContract.ts` (payload types deleted, surface neutral), `packages/agents/src/core/client.ts` + 23 CLI + 5 core consumers migrated (monorepo build green).
- Preflight verification: Phase 0.5 completed.

## Purpose
First vertical slice of the former monolithic "remaining retypes" sweep (C5/M1 split). Pin OBSERVABLE subagent behavior BEFORE retyping the subagent group off `@google/genai`, so the retype (P23) cannot silently change behavior or hide a structural bypass. Covers: `subagent.ts`, `subagentExecution.ts`, `subagentNonInteractive.ts`, `subagentToolProcessing.ts`.

## Requirements Implemented (Expanded)

### REQ-005.5a: Subagent group behavior characterized (pre-retype)
**Full Text**: The subagent production files (`subagent.ts:17` `Content`/`Part`; `subagentExecution.ts:24` `Content`/`FunctionCall`; `subagentNonInteractive.ts:26` `FunctionCall`/`FunctionDeclaration`/`Content`; `subagentToolProcessing.ts:23` `Part`/`FunctionCall`/`Content`) are migrated to neutral types with subagent run behavior unchanged, and the §2A.4-I(e) subagent `{role:'user',parts}` constructions (`subagent.ts:378-379,:686`; `subagentExecution.ts:165,:195`; `subagentToolProcessing.ts:484,:514`) become `IContent{speaker:'human'/'tool'}`/`ToolResponseBlock[]`.
**Behavior**:
- GIVEN: a subagent run (initial instruction, tool-response feed, output nudge)
- WHEN: executed
- THEN: the emitted events / recorded history / tool invocations are identical whether the internal currency is Gemini `{role,parts}` or neutral `IContent`.
**Why This Matters**: subagent construction sites are structural `{role,parts}` builders (some raw-import-bearing); characterizing them first prevents a source-swap that changes run semantics.

## Implementation Tasks (test-writing; behavioral; safety net for P23)

### Files to Create/Confirm
- `packages/agents/src/core/__tests__/subagentRun.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P22`, `@requirement:REQ-005.5a`

### Assertions (observable)
- Subagent initial instruction → the model receives the instruction text; the run produces the same terminal outcome for a scripted provider stream.
- Tool-response feed (`subagentToolProcessing`) → a tool result is fed back and the subagent continues; the recorded history contains the tool response as observable content (assert via the neutral history projection / emitted events, NOT `{role,parts}`).
- Todo-reminder / output-nudge (`subagentExecution:165,:195`) → nudge text reaches the model on the expected turn.
- Non-interactive run (`subagentNonInteractive`) → completes with the same result set; top-level tool calls detected (`getFunctionCallsFromParts` → block-based equivalent) yield the same calls.
- PROPERTY: for ANY scripted tool-response set, the subagent feeds back exactly those responses in order.

## Forbidden
- NO assertions on `{role,parts}`/`.parts`/`Content` internals; assert emitted events / neutral history / tool invocations only.
- NO mock theater / reverse testing; mock ONLY the provider `AsyncIterable<IContent>`.

## Verification Commands
```bash
npm test -- packages/agents/src/core/__tests__/subagentRun.characterization.test.ts   # PASS against current code (safety net)
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/core/__tests__/subagentRun.characterization.test.ts   # aggregate >=30%
```

## Success Criteria
- Observable subagent behavior pinned (run, tool-response feed, nudges, non-interactive); PASS against current code; ≥30% property-based.

## Failure Recovery
If this phase fails (tests do not pass against current code, or assert internals):
1. `git checkout -- packages/agents/src/core/__tests__/subagentRun.characterization.test.ts`
2. Re-author behaviorally (emitted events / neutral history only).
3. Cannot proceed to Phase 23 until the safety net is green and behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P22.md`.
