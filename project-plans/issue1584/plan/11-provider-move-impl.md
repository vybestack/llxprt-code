# Phase 11: Provider move implementation

## Phase ID

PLAN-20260603-ISSUE1584.P11

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-PKG-001: Provider move implementation

**Full Text**: All provider implementations currently in packages/core/src/providers MUST live under packages/providers/src after migration.
**Behavior**:
- GIVEN: P10 tests are in place
- WHEN: move provider implementation files, update imports, and populate providers public API
- THEN: provider package tests/build/typecheck pass
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Modify
- Move implementation files from packages/core/src/providers/** to packages/providers/src/** according to P09 map.
- Update internal imports following analysis/pseudocode/package-boundary.md lines 15-19.
- Populate packages/providers/src/index.ts with explicit public exports.

### Verification
- npm run test --workspace @vybestack/llxprt-code-providers.
- npm run build --workspace @vybestack/llxprt-code-providers.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P11
 * @requirement:REQ-PKG-001
 * @pseudocode lines 15-21
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P11" packages
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

Create project-plans/issue1584/.completed/P11.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Provider Public API Ownership

Move concrete `ProviderManager`, provider public interfaces/types, provider errors, concrete tokenizers, and `ProviderContentGenerator` to providers. Core structural contracts are separate and must not be exported as provider API shims.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.


## Direct Dependency Declaration Rule

`packages/providers` must declare every direct production import from moved provider production files in its own `dependencies` and every direct test-only import in its own `devDependencies`. It must not rely on transitive dependencies from `packages/core` or `packages/cli`. Re-run the import inventory after P11 and reconcile `packages/providers/package.json` before verification.
