# Phase 10a: Provider package behavioral test verification

## Phase ID

PLAN-20260603-ISSUE1584.P10a

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Provider package behavioral test verification

**Full Text**: Tests MUST avoid reverse testing, mock theater, and tests that only validate structure.
**Behavior**:
- GIVEN: P10 tests exist
- WHEN: reviewer checks tests are behavioral and fail for meaningful missing implementation
- THEN: provider move implementation may proceed
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create
- project-plans/issue1584/.completed/P10a.md

### Files to Modify
- project-plans/issue1584/execution-tracker.md

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P10a
 * @requirement:REQ-TEST-001
 * @pseudocode lines 15-22
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P10a" packages
rg -n "@requirement:REQ-TEST-001" packages
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

Create project-plans/issue1584/.completed/P10a.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.


## No-Code Phase Marker Rule

If this phase only changes `project-plans/issue1584/**` artifacts and does not modify `packages/**`, package code-marker greps are N/A. Verify the required analysis artifacts, review outputs, and `.completed/` marker instead. If this phase modifies `packages/**`, run the marker commands from `analysis/phase-verification-matrix.md` against `packages/**`.
