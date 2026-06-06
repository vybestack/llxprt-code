# Phase 03: Core-owned contract stubs

## Phase ID

PLAN-20260603-ISSUE1584.P03

## Prerequisites

- Required: previous numbered phase completed unless this is P01.
- Verification: check project-plans/issue1584/execution-tracker.md and .completed marker for previous phase.
- Preflight verification: Phase 0.5 MUST be completed before implementation phases P03 and later.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Core-owned contract stubs

**Full Text**: packages/core production code MUST NOT import from providers package after this issue unless the plan is explicitly updated with a cycle-free shared package design.
**Behavior**:
- GIVEN: preflight and integration contract are complete
- WHEN: core-owned contract files are introduced or existing files are minimally adjusted to compile
- THEN: future phases can remove core-to-provider imports without behavior change
**Why This Matters**: This keeps the refactor tied to observable behavior and package-boundary safety rather than a folder shuffle.

## Implementation Tasks

### Files to Create
- Core-owned contract files only if P01 proves existing provider contract files cannot remain in place.

### Files to Modify
- Existing core files identified by P01, with minimal stubs only.
- Do not create V2/New/compatibility wrapper files.

## Required Code Markers

Every function/class/test created or materially changed in this phase MUST include:

```typescript
/**
 * @plan:PLAN-20260603-ISSUE1584.P03
 * @requirement:REQ-DEP-001
 * @pseudocode lines 10-13
 */
```

## Verification Commands

```bash
rg -n "@plan:PLAN-20260603-ISSUE1584.P03" packages
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

Create project-plans/issue1584/.completed/P03.md with files changed, tests added, verification outputs, and holistic functionality assessment.



## Phase-Specific Verification Matrix

Run the commands for this phase range from `project-plans/issue1584/analysis/phase-verification-matrix.md`. For phases that touch providers, CLI, or package metadata, core typecheck alone is insufficient. Always include forbidden import scans from `analysis/anti-shim-policy.md` once consumer migration begins.

## Architecture-Specific Guidance

Create only true core runtime contracts as defined in `analysis/anti-shim-policy.md`. Do not create provider compatibility wrappers. Tokenizer and content generator contracts must support injection from CLI/providers.
