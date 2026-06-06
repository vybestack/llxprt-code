# Phase 12: Consumer migration stubs

## Phase ID

PLAN-20260603-ISSUE1584.P12

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-API-001: Consumer migration stubs

**Full Text**: CLI and other consumers MUST import provider APIs directly from @vybestack/llxprt-code-providers.
**Behavior**:
- GIVEN: P11a passes
- WHEN: prepare import updates and package dependencies with minimal compile-safe edits
- THEN: P13 can test actual consumer behavior
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Modify
- packages/cli/package.json
- packages/cli/tsconfig.json
- selected CLI/core import sites identified by P01.

### Forbidden
- Do not add core provider re-export shims.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P12
 * @requirement:REQ-API-001
 * @pseudocode lines 10-15
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P12" packages
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

Create project-plans/issue1584/.completed/P12.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.


## Review-03 Precision Addendum

Before executing this phase, read and apply:

- `analysis/provider-external-dependencies.md`
- `analysis/core-deep-import-policy.md`
- `analysis/package-metadata-constraints.md`
- `analysis/core-structural-contracts.md`
- `analysis/pseudocode/component-boundaries.md`
- `analysis/provider-file-classification-complete.md`

These artifacts define direct dependency declarations, allowed core deep imports, package dependency direction, core contract names/locations, component-specific pseudocode, and complete provider file inventory/classification baseline.


## TypeScript Resolution Strategy

The plan uses normal npm workspace package resolution after npm install, not root tsconfig path aliases, for @vybestack/llxprt-code-providers. Do not add providers to packages/core/tsconfig.json references because core must not depend on providers. Add packages/providers to root workspace/build references as needed, add ../providers reference/dependency only from packages that consume providers (for example CLI), and verify built runtime imports after npm run build.

Subpath imports from providers should be minimized. Prefer the providers package public index for external consumers. If package subpaths are required for migration, document each subpath in analysis/provider-move-map.md and verify both TypeScript and built runtime resolution.
