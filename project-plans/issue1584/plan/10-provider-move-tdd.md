# Phase 10: Provider package behavioral tests

## Phase ID

PLAN-20260603-ISSUE1584.P10

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-TEST-001: Provider package behavioral tests

**Full Text**: Tests MUST prove provider selection, provider switching, and representative provider generation behavior still work through existing paths.
**Behavior**:
- GIVEN: P09 migration map exists
- WHEN: write tests that import real providers package APIs and exercise representative provider behavior
- THEN: tests fail naturally until providers are moved and wired
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create or Modify
- Provider package tests migrated or added under packages/providers/src.
- Integration tests proving package import and representative Fake/OpenAI-compatible behavior.
- Boundary tests proving providers package can import required core deep modules.

### Test Requirements
- Use real provider classes where possible.
- Infrastructure mocking is allowed only at HTTP/filesystem boundary.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P10
 * @requirement:REQ-TEST-001
 * @pseudocode lines 15-22
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P10" packages
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

Create project-plans/issue1584/.completed/P10.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Required Behavioral Matrix Coverage

Tests in this phase must cover real FakeProvider generation through `ProviderContentGenerator`, concrete tokenizer behavior in providers, and provider package public API imports.
