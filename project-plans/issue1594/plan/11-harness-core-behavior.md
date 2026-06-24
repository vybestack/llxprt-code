# Phase 11: Harness Layer 3 — Core Agent Behavior [RED]

## Phase ID

`PLAN-20260617-COREAPI.P11`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 10a completed (PASS)
- Verification: `test -f project-plans/issue1594/.completed/P10a.md`

## Requirements Implemented (Expanded)

### REQ-HARNESS-CORE: Core Agent behavior harness for REQ-001, REQ-003, REQ-006, REQ-007, REQ-010, REQ-011, REQ-012, and REQ-021

**Full Text**: Write behavioral integration tests against real Agent, real
FakeProvider, real CoreToolScheduler, and real MessageBus for core conversation,
tool, history, compression, stats, generation, todo-continuation, multi-tool, and
non-interactive AgentResult behavior. These tests are written before implementation
and must fail naturally against stubs.

**Behavior**:
- GIVEN: public Agent stubs from P06 and quality-gate infrastructure from P08
- WHEN: the core harness sends prompts, scripts tools, manipulates history, aborts
  streams, and calls side-channel generation
- THEN: tests assert concrete values/event sequences/history contents/AgentResult
  fields, not mock calls or implementation details.

**Why This Matters**: This harness is the executable contract for the API's core
runtime behavior and prevents the public facade from becoming an isolated wrapper.


Behavioral integration tests against real Agent + real FakeProvider for the core
conversation/tools/history/compression/generation touchpoints. These are written
test-first against the stubs and FAIL naturally until the matching impl phases.

| T-row | REQ | Asserts |
|---|---|---|
| T1 | REQ-001/003 | createAgent + drain stream → ordered text/thinking/done |
| T2 | REQ-006/007 | tool call + confirm + result + history + continuation via loop |
| T2b | REQ-006 | raw a2a confirmation via unmerged stream option |
| T3 | REQ-006 | deny tool → denied tool-result + history + clean continue |
| T3b | REQ-006 | live tool output via tool-status before tool-result |
| T3c | REQ-006 | editor callback invoked with correct payload |
| T6 | REQ-010 | setHistory/getHistory round-trip; follow-up sees context |
| T7 | REQ-010 | resetChat → empty history; next turn no context |
| T8 | REQ-011 | explicit compress() → CompressionResult; auto → compression event |
| T8b | REQ-010 | onStats → token/context metrics update (from core telemetry re-export + HistoryService) |
| T9 | REQ-003 | abort mid-stream → exactly one done{aborted}, no further events |
| T10 | REQ-012 | generate() returns string, no tool-loop events, no history mutation |
| T11 | REQ-006 | onApproval auto-answers; tool turn completes headlessly |
| T14 | REQ-007 | todo continuation preserved via stream/chat only |
| T14b | REQ-010 | addHistory/updateSystemInstruction/addDirectoryContext take effect next turn |
| T21 | REQ-007 | multi-tool sequencing: deferred completion, single continuation, no overlap |
| T22 | REQ-001/REQ-003/REQ-021 | AgentResult carries enough data for non-interactive output-format and exit/error mapping |

## Implementation Tasks

### Files to Create

- `packages/agents/src/api/__tests__/fixtures/` — additional JSONL fixtures for
  conversation/tool/compression scenarios (file-based FakeProvider, P00a B3).
- `packages/agents/src/api/__tests__/helpers/agentHarness.ts` — build real Agent +
  real FakeProvider + real CoreToolScheduler/MessageBus; mock only infra.
- `packages/agents/src/api/__tests__/core-conversation.spec.ts` — T1, T9, T10, T14.
- `packages/agents/src/api/__tests__/core-tools.spec.ts` — T2, T2b, T3, T3b, T3c, T11, T21.
- `packages/agents/src/api/__tests__/core-history.spec.ts` — T6, T7, T8, T8b, T14b.
  - All `@plan:PLAN-20260617-COREAPI.P11` + relevant `@requirement`.

### Test Rules (RULES.md)

- Real components; assert event sequences, history CONTENTS, scheduler state, returned
  values — never "method was called".
- Contribute property-based tests (e.g. fc-generated message sequences for history
  round-trip; fc-generated tool-arg objects for projection stability). The ≥30%
  property-based requirement is a GLOBAL gate computed across the FULL harness and
  enforced in P29 (B9) — write enough property tests here that the global ratio holds.
- Fail naturally (impl in P15/P17/P20/P21/P26). NO reverse tests.
- Tag every `it`/`test.prop` with markers.

## Verification Commands

```bash
npm test -- --testNamePattern "@plan:.*P11"
grep -rc "@plan:PLAN-20260617-COREAPI.P11" packages/agents/src/api/__tests__/
# property-based presence
grep -rc "test.prop\|fc\." packages/agents/src/api/__tests__/core-*.spec.ts
grep -rn "toHaveBeenCalled\|not\.toThrow\|toThrow('NotYetImplemented')" packages/agents/src/api/__tests__/core-*.spec.ts && echo "FAIL" || echo "OK"
```

### Semantic Verification Checklist

- [ ] Each listed T-row has a behavioral test
- [ ] Property-based tests contributed toward the GLOBAL ≥30% gate (computed in P29, B9)
- [ ] Real FakeProvider via JSONL fixtures; no mock theater
- [ ] Fail naturally pending impl phases

## Success Criteria

- Layer-3 behavioral suite exists, tagged, fails naturally.

## Failure Recovery

- `git checkout -- packages/agents/src/api/__tests__/`; redo.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P11.md`
