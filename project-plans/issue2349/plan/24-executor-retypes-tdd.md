# Phase 24: Executor slice — characterization TDD

## Phase ID
`PLAN-20260707-AGENTNEUTRAL.P24`

## Prerequisites
- Required: Phase 23 completed.
- Verification: `grep -r "@plan:PLAN-20260707-AGENTNEUTRAL.P23" packages/agents/src`
- Expected files from previous phase: `subagent*.ts` retyped neutral; AST `--count` strictly decreased vs P21.
- Preflight verification: Phase 0.5 completed.

## Purpose
Second vertical slice. Pin OBSERVABLE executor behavior BEFORE retyping the executor group, including the raw-import-free structural `.parts` mutator `executor-prompt-builder.ts:47-58` (the pure #2424 structural case, OQ-12). Covers: `executor.ts`, `executor-stream-processor.ts`, `recovery.ts`, `types.ts`, `executor-prompt-builder.ts`, `executor-tool-dispatch.ts` (residual after P17 Type-swap).

## Requirements Implemented (Expanded)

### REQ-005.5b: Executor group behavior characterized (pre-retype)
**Full Text**: The executor production files are migrated to neutral types with executor run behavior unchanged; the §2A.4-I(e) executor `{role:'user',parts}` constructions (`executor.ts:224-225` initial message; `recovery.ts:117-120` recovery nudge; `executor-tool-dispatch.ts:513` tool-response feed) become neutral `IContent`/`ToolResponseBlock[]`; and the raw-import-free generic `.parts` mutator `executor-prompt-builder.ts:47-58` (`applyTemplateToInitialMessages<T extends {parts?}>`) is retyped onto `IContent`/`ContentBlock[]` with `PromptConfig.initialMessages` migrated to neutral `IContent[]` (OQ-12).
**Behavior**:
- GIVEN: an executor run (initial query, template application to initial messages, tool-response feed, recovery nudge)
- WHEN: executed
- THEN: observable results (emitted events, tool invocations, templated message content) are identical whether internal currency is Gemini `{parts}` or neutral blocks.
**Why This Matters**: `executor-prompt-builder.ts` is the raw-import-free structural bypass the gate must catch (§8 check (f)); characterizing template application first proves the neutral retype preserves templating.

## Implementation Tasks (test-writing; behavioral; safety net for P25)

### Files to Create/Confirm
- `packages/agents/src/agents/__tests__/executorRun.characterization.test.ts` — `@plan:PLAN-20260707-AGENTNEUTRAL.P24`, `@requirement:REQ-005.5b`

### Assertions (observable)
- Executor initial message (`executor.ts:224-225`) → the model receives the query text; scripted run reaches the same terminal state.
- Template application (`executor-prompt-builder.applyTemplateToInitialMessages`) → given `PromptConfig.initialMessages` with template placeholders + `AgentInputs`, the templated message content (text after substitution) is identical before/after the neutral retype. Assert on the resulting message content/history, NOT `.parts`.
- Tool-response feed (`executor-tool-dispatch.ts:513`) → tool responses fed back in order; the executor continues.
- Recovery nudge (`recovery.ts:117-120`) → recovery message reaches the model with the same prefix+suffix text.
- PROPERTY: for ANY `{ placeholder → value }` inputs, template application yields the same substituted text on every initial message.

## Forbidden
- NO assertions on `.parts`/`{role,parts}`; assert templated content / emitted events / tool invocations.
- Mock ONLY the provider stream.

## Verification Commands
```bash
npm test -- packages/agents/src/agents/__tests__/executorRun.characterization.test.ts   # PASS against current code
# Property ratio via prop_ratio (verification-template §7) over ALL test files this phase creates:
prop_ratio packages/agents/src/agents/__tests__/executorRun.characterization.test.ts   # aggregate >=30%
```

## Success Criteria
- Executor behavior pinned (initial message, template application, tool-response feed, recovery); PASS against current code; ≥30% property-based.

## Failure Recovery
1. `git checkout -- packages/agents/src/agents/__tests__/executorRun.characterization.test.ts`
2. Re-author behaviorally (templated content / events only).
3. Cannot proceed to Phase 25 until the safety net is green and behavioral.

## Phase Completion Marker
`project-plans/issue2349/.completed/P24.md`.
