# Phase 10a: Event Characterization Harness Verification

## Phase ID

`PLAN-20260617-COREAPI.P10a`

## LLxprt Code Subagent: typescriptreviewer

## Prerequisites

- Required: Phase 10 completed
- Verification: `grep -rc "@plan:PLAN-20260617-COREAPI.P10" packages/agents/src/api/__tests__/`

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P10"
for v in Content Thought ToolCallRequest ToolCallResponse ToolCallConfirmation UserCancelled StreamIdleTimeout Error ChatCompressed UsageMetadata MaxSessionTurns Finished LoopDetected Citation Retry SystemNotice InvalidStream ContextWindowWillOverflow ModelInfo AgentExecutionStopped AgentExecutionBlocked; do
for c in fake-provider scheduler abort config/orchestrator hook adapter-characterization; do
  grep -q "$c" packages/agents/src/api/__tests__/event-characterization.spec.ts || { echo "MISSING event source category $c"; missing=1; }
done
for v in Retry InvalidStream StreamIdleTimeout Error ContextWindowWillOverflow ToolCallResponse ToolCallConfirmation MaxSessionTurns UserCancelled LoopDetected ChatCompressed AgentExecutionStopped AgentExecutionBlocked; do
  grep -n "fake-provider.*$v\|$v.*fake-provider" packages/agents/src/api/__tests__/event-characterization.spec.ts && { echo "FAIL impossible FakeProvider source for $v"; missing=1; } || true
done

  grep -q "$v" packages/agents/src/api/__tests__/event-characterization.spec.ts || { echo "MISSING $v"; missing=1; }
done
# mock-theater / reverse-test guard (must NOT match)
grep -rn "toHaveBeenCalled\|not\.toThrow\|toThrow('NotYetImplemented')" packages/agents/src/api/__tests__/event-characterization.spec.ts && { echo "FAIL mock/reverse"; missing=1; }
exit $missing
```

## Semantic Verification Checklist (MANDATORY)

1. Are ALL 21 variants asserted at a real source category, with FakeProvider JSONL used only for variants the real FakeProvider/IContent path can produce?
2. Is the exactly-one-`done` invariant genuinely tested (would catch a double `done`)?
3. Are synthesized-`done` terminal paths (no Finished) tested with correct DoneReason?
4. Is AgentExecutionBlocked asserted non-terminal and Stopped terminal?
5. Are assertions on VALUES (payload fields), not "emitted"?
6. Do tests fail for the right reason (event-adapter absent), not reverse-test?

### Holistic Functionality Assessment (completion marker)

- Confirm this suite is a complete characterization of the event contract.
- Identify any unreachable variant + how it is injected.
- Verdict PASS/FAIL.

## Success Criteria

- PASS only if all 21 variants + invariants covered behaviorally, failing naturally.

## Failure Recovery

- Return to Phase 10 with the missing-variant list.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P10a.md`
