# Phase 01: Dependency and contract classification analysis

## Phase ID

PLAN-20260603-ISSUE1584.P01

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Dependency and contract classification analysis

**Full Text**: Production package dependencies MUST NOT form a core/providers cycle.
**Behavior**:
- GIVEN: the current provider and core import graph exists
- WHEN: the phase executes dependency analysis
- THEN: every provider file is classified and cycle risks are documented
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create
- project-plans/issue1584/analysis/provider-file-classification.md - classify each provider file/directory.
- project-plans/issue1584/analysis/core-import-remediation.md - list each core production import and planned remediation.

### Files to Modify
- project-plans/issue1584/execution-tracker.md - mark P01 status.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P01
 * @requirement:REQ-DEP-001
 * @pseudocode lines 10-12
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P01" packages
rg -n "@requirement:REQ-DEP-001" packages
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

Create project-plans/issue1584/.completed/P01.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.


## Analysis-Only Marker Override

This phase does not require production code markers unless it modifies files under `packages/**`. For plan/analysis-only work, verify artifacts directly instead of using package code-marker greps:

```bash
test -f project-plans/issue1584/analysis/provider-file-classification.md
test -f project-plans/issue1584/analysis/core-import-remediation.md
test -f project-plans/issue1584/analysis/provider-move-map.md
rg -n "P01|P02|provider|contract|verification" project-plans/issue1584/analysis project-plans/issue1584/plan
```

If this phase unexpectedly changes production code, then run the marker commands from `analysis/phase-verification-matrix.md` against `packages/**`.


## Hard Gate Before P03

P03 MUST NOT begin until P01/P01a produce and verify a complete provider inventory. Completion means every file returned by `find packages/core/src/providers -type f | sort` is covered by either an explicit row or a deterministic directory rule plus explicit exception table. This baseline document alone is not sufficient for implementation.


## No-Code Phase Marker Rule

If this phase only changes `project-plans/issue1584/**` artifacts and does not modify `packages/**`, package code-marker greps are N/A. Verify the required analysis artifacts, review outputs, and `.completed/` marker instead. If this phase modifies `packages/**`, run the marker commands from `analysis/phase-verification-matrix.md` against `packages/**`.
