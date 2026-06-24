<!-- @plan:PLAN-20260621-COREAPIREMED.P01 @requirement:REQ-001..REQ-007,REQ-INT-001..004 -->
# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260621-COREAPIREMED.P01`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 00a completed (PASS)
- Verification: `test -f project-plans/issue1594remediate/.completed/P00a.md`

## Requirements Implemented (Expanded)

This phase produces/confirms `analysis/domain-model.md` covering ALL requirements (REQ-001..007,
REQ-INT-001..004). No production code.

## Implementation Tasks

### Files to Create / Confirm

- `project-plans/issue1594remediate/analysis/domain-model.md` (already drafted) — confirm it
  contains:
  - Entities: Agent (extended), Config (adopted), FromConfigOptions, AgentClientContract
    (promoted), IsolatedRuntimeContext handle/options, engine collaborators.
  - State transitions §3.1–§3.5 (fromConfig bootstrap; settings r/w; getCurrentSequenceModel;
    contract promotion; provider-runtime reachability).
  - Named invariants R-ADOPT, R-SHAREDFINALIZE, R-CONFIGOWNER, R-DELEGATE, R-IDENTITY,
    R-SEQMODEL, R-CONTRACT, R-NONBREAK, R-PARITY, R-NODEEP — each with a testable harness row.
  - Edge cases and error scenarios per requirement.
  - Requirement coverage map (REQ → entities/transition/invariant/harness/phase).
  - Harness row cross-reference T1–T11.

### Required Markers

The domain-model.md top comment MUST include `@plan:PLAN-20260621-COREAPIREMED.P01`.

## Verification Commands

```bash
test -f project-plans/issue1594remediate/analysis/domain-model.md || { echo FAIL; exit 1; }
for r in REQ-001 REQ-002 REQ-003 REQ-004 REQ-005 REQ-006 REQ-007 REQ-INT-001 REQ-INT-002 REQ-INT-003 REQ-INT-004; do
  grep -q "$r" project-plans/issue1594remediate/analysis/domain-model.md || { echo "MISSING $r"; exit 1; }
done
for t in T1 T2 T3 T4 T5 T6 T7 T8 T9 T10 T11; do
  grep -q "| $t " project-plans/issue1594remediate/analysis/domain-model.md || { echo "MISSING harness $t"; exit 1; }
done
grep -q "@plan:PLAN-20260621-COREAPIREMED.P01" project-plans/issue1594remediate/analysis/domain-model.md || { echo "MISSING plan marker"; exit 1; }
echo "OK"
```

### Semantic Verification Checklist

- [ ] Every REQ has a coverage-map row with entity, transition, invariant, harness row, phases.
- [ ] No implementation code (analysis only).
- [ ] Ownership distinction for adopted vs constructed Config is explicit (REQ-001.3).
- [ ] Non-breaking invariant (R-NONBREAK) is present and testable.

## Success Criteria

- domain-model.md present, all REQ + T-rows covered, plan marker present.

## Failure Recovery

- Revise `analysis/domain-model.md`; re-run verification.

## Phase Completion Marker

Create: `project-plans/issue1594remediate/.completed/P01.md`

Contents (REQUIRED — per `dev-docs/PLAN-TEMPLATE.md` lines 199-211; the executor fills in
every field with REAL values, not placeholders):

```markdown
Phase: P01
Completed: YYYY-MM-DD HH:MM
Files Created: [list each new file with its line count]
Files Modified: [list each changed file with diff stats, e.g. +12/-3]
Tests Added: [count]
Verification: [paste the actual output of THIS phase's verification commands]
Semantic Assessment: [one-line holistic assessment of what was implemented and whether it satisfies the cited requirements]
```
