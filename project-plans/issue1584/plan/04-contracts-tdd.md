# Phase 04: Core contract behavioral tests

## Phase ID

PLAN-20260603-ISSUE1584.P04

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Core contract behavioral tests

**Full Text**: Tests MUST prove the package boundary by detecting forbidden core-to-provider imports and forbidden core provider re-exports.
**Behavior**:
- GIVEN: P03 stubs compile
- WHEN: behavioral tests are written for core-owned contracts and forbidden dependency direction
- THEN: tests fail naturally until P05 implementation
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create or Modify
- Boundary tests under existing package test conventions, preferably near affected core modules.
- Tests must assert concrete behavior: import scans, tokenizer behavior if moved, error behavior if moved, and no forbidden core provider exports.

### Forbidden
- Do not test NotYetImplemented.
- Do not only assert that files exist.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P04
 * @requirement:REQ-TEST-001
 * @pseudocode lines 10-22
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P04" packages
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

Create project-plans/issue1584/.completed/P04.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Required Behavioral Matrix Coverage

Tests in this phase must cover HistoryService tokenizer injection, ToolIdStrategy normalization, runtime missing-provider error behavior, and forbidden core-to-provider import scans from `analysis/behavioral-regression-matrix.md`.
