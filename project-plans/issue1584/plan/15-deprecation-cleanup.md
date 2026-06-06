# Phase 15: Final cleanup and no shims

## Phase ID

PLAN-20260603-ISSUE1584.P15

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-CLEAN-001: Final cleanup and no shims

**Full Text**: Old provider source files MUST be removed from packages/core/src/providers after migration, except files deliberately reclassified as core-owned contracts/utilities by the analysis phase.
**Behavior**:
- GIVEN: P14a passes
- WHEN: remove old core provider exports/files and prove no compatibility shim remains
- THEN: repository has a single provider implementation home
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Modify
- packages/core/src/index.ts remove provider export block.
- Remove migrated files from packages/core/src/providers/** except P01-classified retained files.
- Update tests/imports affected by removals.

### Verification
- Scan for old provider exports.
- Scan for duplicate provider implementation files.
- Run core/providers/cli builds.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P15
 * @requirement:REQ-CLEAN-001
 * @pseudocode lines 19-23
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P15" packages
rg -n "@requirement:REQ-CLEAN-001" packages
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

Create project-plans/issue1584/.completed/P15.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Anti-Shim Enforcement

Apply every scan in `analysis/anti-shim-policy.md`. Any core wrapper that forwards to providers package is a failure, not a cleanup strategy.


## Final Core Providers Directory Rule

The preferred and expected final state is zero production files under `packages/core/src/providers`. Any reclassified core-owned contracts/utilities must be moved to non-provider core paths such as `packages/core/src/runtime/contracts/`, `packages/core/src/runtime/errors/`, or a core utility path. Leaving files under `packages/core/src/providers` is allowed only for explicitly justified non-production artifacts during migration and must be eliminated before final cleanup unless P15a records an approved exception.
