# Phase 10: Harness Layer 2 — Event Characterization (T16, 21 variants) [RED]

## Phase ID

`PLAN-20260617-COREAPI.P10`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 09a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P09a.md`

## Requirements Implemented (Expanded)

### REQ-003: Typed AgentEvent + complete 21-variant mapping + exactly-one-`done`

**Full Text**: Every internal `GeminiEventType` variant maps to a documented public
projection (or explicit collapse), asserted at its REAL emission site; the stream
ends with exactly one synthesized `done` for terminal paths without a `Finished`.
**Behavior**:
- GIVEN: each of the 21 variants
- WHEN: driven at its emission site (FakeProvider JSONL scripting where it originates
  in the model stream; scheduler/loop-detector/runtime injection for the rest)
- THEN: the public projection from §4.4 is produced; terminal variants yield exactly
  one `done` with the correct `DoneReason`.
**Why This Matters**: this is the top correctness risk; a single missed/mis-mapped
variant breaks consumers.

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/fixtures/` — JSONL fixtures ONLY for cases
  actually derivable from FakeProvider `FakeResponseTurn` / `IContent` chunks.
  **Do not pretend FakeProvider can emit raw `GeminiEventType` values.**
- `packages/agents/src/api/__tests__/helpers/eventHarness.ts` — helper to build a
  real Agent with a real FakeProvider over a fixture file, plus explicit real-site
  drivers for scheduler/confirmation, abort, config/orchestrator terminal paths,
  hooks, and a narrow adapter-characterization iterable for variants with no higher
  executable emission seam.
- `packages/agents/src/api/__tests__/event-characterization.spec.ts` — one row per
  variant with a behavioral assertion of the public projection + terminal mapping
  table (see overview §4.4). Includes the exactly-one-`done` invariant tests and the
  terminal-vs-intermediate decision-table assertions.
  - `@plan:PLAN-20260617-COREAPI.P10` `@requirement:REQ-003`

### Mapping rows the spec MUST assert (21 variants)

Content→text; Thought→thinking(ThoughtSummary); ToolCallRequest→tool-call(projection);
ToolCallResponse→tool-result(projection); ToolCallConfirmation→tool-confirmation;
### Event Source Matrix (REAL emission sites; do not overuse FakeProvider)

| Internal variant / loop event | Required source in test |
|---|---|
| `Content`, `Thought`, `Citation`, `UsageMetadata`, `ModelInfo`, `SystemNotice`, `Finished`, `ToolCallRequest` | FakeProvider JSONL only if the real FakeProvider/IContent conversion path can produce the corresponding `ServerGeminiStreamEvent`; otherwise use the adapter-characterization iterable and mark the row as adapter-only. |
| `ToolCallResponse` | Real AgenticLoop/tool-scheduler continuation path after an executed tool, not FakeProvider JSONL. |
| `ToolCallConfirmation` | Raw/unmerged stream adapter seam for the a2a path OR scheduler awaiting-approval path for public `tool-confirmation`; do not fake as provider JSONL. |
| `Retry`, `InvalidStream`, `StreamIdleTimeout`, `Error` | MessageStreamOrchestrator/terminal-handler path if inducible; otherwise adapter-characterization iterable with explicit label. |
| `ContextWindowWillOverflow`, `MaxSessionTurns` | Real Config/session-token setup that triggers the orchestrator guard, not provider fixture data. |
| `UserCancelled` | Actual `AbortSignal` cancellation path. |
| `LoopDetected` | Real loop-detector/runtime injection at the loop detector seam. |
| `ChatCompressed` | Real compression path (automatic or explicit compression emission), not provider fixture data. |
| `AgentExecutionStopped`, `AgentExecutionBlocked` | Real hook stop/block behavior. |

Every row in `event-characterization.spec.ts` MUST name its source category (`fake-provider`, `scheduler`, `abort`, `config/orchestrator`, `hook`, or `adapter-characterization`) so reviewers can detect impossible fixtures.


UserCancelled→done{aborted}; StreamIdleTimeout→idle-timeout THEN done (terminal);
Error→error THEN done{error} (terminal); ChatCompressed→compression;
UsageMetadata→usage; MaxSessionTurns→done{max-turns} (synthesized, no Finished);
Finished→done{stop}; LoopDetected→loop-detected THEN done{loop-detected};
Citation→citation; Retry→retry (intermediate); SystemNotice→notice;
InvalidStream→invalid-stream (intermediate-or-terminal per runtime);
ContextWindowWillOverflow→context-warning THEN done{context-overflow} (synthesized);
ModelInfo→model-info; AgentExecutionStopped→done{hook-stopped} (terminal);
AgentExecutionBlocked→hook-blocked (NON-terminal, turn continues).

### Test Rules

- Real Agent + real FakeProvider; mock only infra if unavoidable.
- Assert event sequences + payload VALUES (not "emitted").
- Fail naturally (event-adapter not implemented until P15). NO reverse tests.

## Verification Commands

```bash
missing=0
npm test -- --testNamePattern "@plan:.*P10"
# 21 variants referenced
# Source-category labels prove impossible variants are not forced through FakeProvider
for c in fake-provider scheduler abort config/orchestrator hook adapter-characterization; do
  grep -q "$c" packages/agents/src/api/__tests__/event-characterization.spec.ts || { echo "MISSING event source category $c"; missing=1; }
done
# Impossible raw variants must not be documented as FakeProvider fixtures
for v in Retry InvalidStream StreamIdleTimeout Error ContextWindowWillOverflow ToolCallResponse ToolCallConfirmation MaxSessionTurns UserCancelled LoopDetected ChatCompressed AgentExecutionStopped AgentExecutionBlocked; do
  grep -n "fake-provider.*$v\|$v.*fake-provider" packages/agents/src/api/__tests__/event-characterization.spec.ts && { echo "FAIL impossible FakeProvider source for $v"; missing=1; } || true
done

for v in Content Thought ToolCallRequest ToolCallResponse ToolCallConfirmation UserCancelled StreamIdleTimeout Error ChatCompressed UsageMetadata MaxSessionTurns Finished LoopDetected Citation Retry SystemNotice InvalidStream ContextWindowWillOverflow ModelInfo AgentExecutionStopped AgentExecutionBlocked; do
  grep -q "$v" packages/agents/src/api/__tests__/event-characterization.spec.ts || { echo "MISSING $v"; missing=1; }
done
[ "$(ls packages/agents/src/api/__tests__/fixtures/*.jsonl 2>/dev/null | wc -l)" -gt 0 ] || { echo "MISSING jsonl fixtures"; missing=1; }
# reverse-test / mock-theater guard (must NOT match)
grep -rn "toThrow('NotYetImplemented')\|not\.toThrow" packages/agents/src/api/__tests__/event-characterization.spec.ts && { echo "FAIL reverse"; missing=1; }
exit $missing
```

### Semantic Verification Checklist

- [ ] All 21 variants have a test row asserting the documented projection
- [ ] Exactly-one-`done` invariant asserted for each terminal path
- [ ] Synthesized-`done` cases (max-turns/context-overflow/loop/error) covered
- [ ] AgentExecutionBlocked asserted NON-terminal; Stopped terminal
- [ ] FakeProvider JSONL fixtures are used only for variants the real FakeProvider/IContent path can produce
- [ ] Every variant row names its real source category and impossible raw variants are not routed through FakeProvider
- [ ] Tests fail naturally pending P15

## Success Criteria

- 21-variant characterization suite exists, tagged, fails naturally.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; redo with full variant set.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P10.md`
