# Phase 01: Domain Analysis

## Phase ID

`PLAN-20260617-COREAPI.P01`

## LLxprt Code Subagent: typescriptexpert

## Prerequisites

- Required: Phase 00a (preflight) completed
- Verification: `test -f project-plans/issue1594/.completed/P00a.md`
- Expected files from previous phase: `project-plans/issue1594/.completed/P00a.md`
- Preflight verification: Phase 0.5 (P00a) MUST be executed and complete; honor its CRITICAL
  CORRECTIONS (file-based FakeProvider; telemetry stats source; subpath must be
  created; runtime-context switch wiring; rebuild-hook name to pin).

## Requirements Implemented (Expanded)

### REQ-ALL: Domain model covers REQ-001 through REQ-021

**Full Text**: The domain analysis MUST validate and finalize the entities, state
transitions, business rules, edge cases, and named invariants that underpin every
formal requirement REQ-001 through REQ-021 and every harness row T1 through T25.
It produces no production code.

**Behavior**:
- GIVEN: `specification.md` defines REQ-001..REQ-021 and harness rows T1..T25
- WHEN: the analyst updates `analysis/domain-model.md`
- THEN: every REQ maps to at least one entity/transition/invariant, and every
  harness row T1..T25 maps to a documented behavior.

**Why This Matters**: A missing entity or transition here becomes an integration gap
later and violates PLAN.md's no-isolated-feature rule.

## Implementation Tasks

### Files to Modify

- `project-plans/issue1594/analysis/domain-model.md`
  - Confirm/extend: entities (Agent aggregate-root facade; sub-surfaces
    profiles/tools/mcp/auth/ide/session/hooks; AgentConfig; AgentEvent union;
    ProviderManager/Config/AgenticLoop relationships).
  - Confirm/extend: 6 state transitions (bootstrap ordering; client rebinding on
    switch/auth; stream lifecycle → exactly-one-`done`; tool-loop sequencing;
    compression; dispose teardown).
  - Confirm/extend: named invariants R-CTX, R-CLIENT, R-DONE, R-TERMINAL, R-CORR,
    R-PROJECT, R-NOHANDLER, R-AUTHPREC, R-OWN, R-BOUNDARY, R-NODEEP, R-SIDE.
  - Confirm/extend: edge cases + error scenarios.
  - ADD comment block at top: `@plan:PLAN-20260617-COREAPI.P01`

### Required Code Markers

The analysis doc header MUST include:

```
<!-- @plan:PLAN-20260617-COREAPI.P01 @requirement:REQ-001..REQ-021 -->
```

## Verification Commands

```bash
missing=0
# Marker present
grep -q "@plan:PLAN-20260617-COREAPI.P01" project-plans/issue1594/analysis/domain-model.md || { echo "MISSING plan marker"; missing=1; }
# Every REQ referenced
for n in $(seq -w 1 21); do grep -q "REQ-0$n" project-plans/issue1594/analysis/domain-model.md || { echo "MISSING REQ-0$n"; missing=1; }; done
# Every harness row referenced
for t in T1 T2 T2b T3 T3b T3c T4 T4b T4c T4d T4e T4f T5 T6 T6b T7 T8 T8b T9 T10 T11 T12 T12b T13 T14 T14b T15 T15b T15c T16 T17 T18 T18b T18c T18d T18e T19 T20 T21 T22 T23 T24 T25; do grep -q "$t\b" project-plans/issue1594/analysis/domain-model.md || { echo "MISSING $t"; missing=1; }; done
exit $missing
```

### Structural Verification Checklist

- [ ] P00a corrections incorporated (no contradicting facts)
- [ ] No implementation code in domain model
- [ ] All REQs + T-rows referenced

### Semantic Verification Checklist

- [ ] Every entity has clear responsibility + relationships
- [ ] Every state transition lists pre/post conditions
- [ ] Invariants are testable (map to a harness row)
- [ ] Edge/error cases enumerated for each sub-surface

## Success Criteria

- domain-model.md covers all 21 REQs + all T-rows with no implementation code.

## Failure Recovery

- `git checkout -- project-plans/issue1594/analysis/domain-model.md`; redo with full
  REQ/T coverage.

## Phase Completion Marker

Create: `project-plans/issue1594/.completed/P01.md`
