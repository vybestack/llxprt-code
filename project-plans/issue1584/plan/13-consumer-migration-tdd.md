# Phase 13: Consumer migration integration tests

## Phase ID

PLAN-20260603-ISSUE1584.P13

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-API-001: Consumer migration integration tests

**Full Text**: Existing provider runtime behavior MUST remain reachable through current CLI commands and startup flows.
**Behavior**:
- GIVEN: P12 stubs exist
- WHEN: write integration tests for CLI provider wiring, provider switching, and no core provider exports
- THEN: tests fail naturally until imports and cleanup are complete
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create or Modify
- CLI integration tests around provider manager creation and provider command behavior.
- Boundary tests scanning core index and production imports.
- Smoke-test documentation in completion marker.

### Requirements
- Tests must verify actual provider manager/provider behavior, not only import shape.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P13
 * @requirement:REQ-API-001
 * @pseudocode lines 10-18
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P13" packages
rg -n "@requirement:REQ-API-001" packages
# Then run phase-specific commands from project-plans/issue1584/analysis/phase-verification-matrix.md
```

## Semantic Verification Checklist

- [ ] Read the full requirement text in this phase.
- [ ] Read the modified implementation and tests.
- [ ] Confirm the behavior is reachable through existing CLI/core paths where applicable.
- [ ] Confirm tests would fail if the implementation was removed.
- [ ] Confirm no mock theater, reverse testing, or structure-only testing was introduced.

## Failure Recovery

Do not proceed to the next phase. Revert only this phase's changes with targeted git checkout of phase files after confirming no unrelated user changes are present.

## Phase Completion Marker

Create project-plans/issue1584/.completed/P13.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Required Behavioral Matrix Coverage

Tests in this phase must cover CLI provider manager creation, provider switching, provider-backed generation through existing startup/runtime path, and no core provider re-exports.
