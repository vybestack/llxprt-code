<!-- @plan:PLAN-20260622-COREAPIGAP.P01 @requirement:REQ-001..REQ-010,REQ-INT-001..005 -->
# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260622-COREAPIGAP.P01`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 00a completed (PASS)
- Verification: `test -f project-plans/issue2143/.completed/P00a.md`

## Requirements Implemented (Expanded)

This phase produces/confirms `analysis/domain-model.md` covering ALL requirements (REQ-001..010,
REQ-INT-001..005). No production code.

## Implementation Tasks

### Files to Create / Confirm

- `project-plans/issue2143/analysis/domain-model.md` (already drafted) — confirm it contains:
  - Entities: `Agent` (extended), the three NEW sub-controllers (`AgentPolicyControl`,
    `AgentTasksControl`, `AgentToolKeyControl`), the three EXTENDED controllers
    (`AgentHookControl`, `AgentAuthControl`, `AgentMcpControl`), the projected public view types
    (`PolicyRuleView`, `AgentTaskInfo`, `HookInfo`, `AuthProviderDetail`, `AuthBucketStatus`,
    `McpDetailStatus`/`McpServerDetail`, `ToolKeyInfo`/`ToolKeyStatus`), and the backing engine
    collaborators (`Config`, `PolicyEngine`, `AsyncTaskManager`, `HookSystem`/`HookRegistry`,
    `OAuthManager`, `MCPOAuthProvider`, `McpClientManager`, `ToolKeyStorage`).
  - State transitions §3.1–§3.7 (approval read/write+throw; policy snapshot; task list/cancel;
    hooks disabled-set round-trip; auth detail projection; MCP authenticate→restart→setTools;
    tool-key save/keyfile round-trip).
  - Named invariants R-DELEGATE, R-APPROVAL-THROW, R-POLICY-SNAPSHOT, R-ARGSPATTERN-STRING,
    R-NO-ABORTCONTROLLER, R-CANCEL-COUNT, R-UNDEFINED-SAFE, R-HOOKS-ROUNDTRIP, R-NO-RAW-SECRETS,
    R-NO-LEAK, R-REFRESH-PARITY, R-MCP-OAUTH-FLOW, R-KEYS-DISTINCT, R-NONBREAK, R-MAP-VALID,
    R-NO-DEEP-IMPORT, R-BARREL-TYPEONLY — each with ≥1 testable harness row.
  - Edge cases (§5) and error scenarios (§6) per requirement.
  - Requirement coverage map §7 (REQ → entities/transition/invariant/harness/phases).
  - Harness row cross-reference §8 (T1–T24, layers L1–L5).

### Required Markers

The `domain-model.md` top comment MUST include `@plan:PLAN-20260622-COREAPIGAP.P01`.

## Verification Commands

```bash
set -o pipefail
test -f project-plans/issue2143/analysis/domain-model.md || { echo FAIL; exit 1; }
for r in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-006 REQ-007 REQ-008 REQ-009 REQ-010 \
         REQ-INT-001 REQ-INT-002 REQ-INT-003 REQ-INT-004 REQ-INT-005; do
  grep -q "$r" project-plans/issue2143/analysis/domain-model.md || { echo "MISSING $r"; exit 1; }
done
for t in T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11 T12 T13 T14 T15 T16 T17 T18 T19 T20 T21 T22 T23 T24; do
  grep -q "| $t " project-plans/issue2143/analysis/domain-model.md || { echo "MISSING harness $t"; exit 1; }
done
for inv in R-DELEGATE R-APPROVAL-THROW R-POLICY-SNAPSHOT R-ARGSPATTERN-STRING R-NO-ABORTCONTROLLER \
           R-CANCEL-COUNT R-UNDEFINED-SAFE R-HOOKS-ROUNDTRIP R-NO-RAW-SECRETS R-NO-LEAK \
           R-REFRESH-PARITY R-MCP-OAUTH-FLOW R-KEYS-DISTINCT R-NONBREAK R-MAP-VALID \
           R-NO-DEEP-IMPORT R-BARREL-TYPEONLY; do
  grep -q "$inv" project-plans/issue2143/analysis/domain-model.md || { echo "MISSING invariant $inv"; exit 1; }
done
grep -q "@plan:PLAN-20260622-COREAPIGAP.P01" project-plans/issue2143/analysis/domain-model.md || { echo "MISSING plan marker"; exit 1; }
echo "OK"
```

### Semantic Verification Checklist

- [ ] Every REQ has a coverage-map row with entity, transition, invariant, harness row, phases.
- [ ] No implementation code (analysis only).
- [ ] The NEW-vs-EXTEND distinction is explicit for every controller (additive, REQ-009).
- [ ] Projected-type invariants (R-NO-ABORTCONTROLLER, R-ARGSPATTERN-STRING, R-NO-RAW-SECRETS,
      R-NO-LEAK) are present and testable.
- [ ] Non-breaking invariant (R-NONBREAK) and no-deep-import invariant (R-NO-DEEP-IMPORT) present.

## Success Criteria

- `domain-model.md` present; all REQ + T-rows + invariants covered; plan marker present.

## Failure Recovery

- Revise `analysis/domain-model.md`; re-run verification.

## Phase Completion Marker

Create: `project-plans/issue2143/.completed/P01.md`

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
