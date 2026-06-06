# Phase 09: Provider move import-map stub

## Phase ID

PLAN-20260603-ISSUE1584.P09

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-PKG-001: Provider move import-map stub

**Full Text**: All provider implementations currently in packages/core/src/providers MUST live under packages/providers/src after migration.
**Behavior**:
- GIVEN: P08a passes
- WHEN: create migration map and, only if unavoidable, temporary provider-package-local placeholders without preserving old core provider paths or forwarding from core to providers
- THEN: P10 can write migration behavior tests
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create
- project-plans/issue1584/analysis/provider-move-map.md

### Files to Modify
- Provider package entry point may expose compile-safe stubs or selected moved contract exports only.

### Forbidden
- Do not delete core provider files in this phase.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P09
 * @requirement:REQ-PKG-001
 * @pseudocode lines 15-17
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P09" packages
rg -n "@requirement:REQ-PKG-001" packages
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

Create project-plans/issue1584/.completed/P09.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Move Map Requirement

Use `analysis/provider-move-map.md` and the P01-generated inventory. Do not proceed if any provider file lacks a move rule or explicit core-owned exception.


## Hard Gate Before P03

P03 MUST NOT begin until P01/P01a produce and verify a complete provider inventory. Completion means every file returned by `find packages/core/src/providers -type f | sort` is covered by either an explicit row or a deterministic directory rule plus explicit exception table. This baseline document alone is not sufficient for implementation.


## Temporary Placeholder Restrictions

Any temporary P09 placeholder must satisfy all of these restrictions:

- It must live only under `packages/providers/**`, never under `packages/core/src/providers/**`.
- It must not forward old core provider paths to the new provider package.
- It must not be a compatibility shim and must not be exported from core.
- It must not be sufficient for behavioral tests to pass; P10/P11 must require the real moved implementation.
- It must be removed or replaced by real moved implementation in P11.


## Complete Inventory Dependency

P09 must use `analysis/provider-file-classification-complete.md` and may not rely only on top-level move rules if any file is listed as requiring P01 confirmation.
