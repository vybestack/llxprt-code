# Phase 14: Consumer migration implementation

## Phase ID

PLAN-20260603-ISSUE1584.P14

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-API-001: Consumer migration implementation

**Full Text**: CLI and other consumers MUST import provider APIs directly from @vybestack/llxprt-code-providers.
**Behavior**:
- GIVEN: P13 tests fail for expected reasons
- WHEN: update CLI and core consumers, remove core production dependency on provider package, and pass integration tests
- THEN: existing provider flows work through new package
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Modify
- CLI provider import sites.
- Core import sites from P01 remediation list.
- Package metadata and tsconfig references.

### Verification
- Run P13 tests.
- Scan for forbidden core production imports from providers.
- Run CLI targeted tests.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P14
 * @requirement:REQ-API-001
 * @pseudocode lines 10-18
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P14" packages
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

Create project-plans/issue1584/.completed/P14.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## ProviderManager Construction Rule

CLI/provider wiring constructs concrete `ProviderManager` from `@vybestack/llxprt-code-providers`; core receives only structurally compatible runtime manager values.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.
