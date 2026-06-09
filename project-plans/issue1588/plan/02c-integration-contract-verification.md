# Phase 02c: Integration Contract Verification

## Phase ID

`PLAN-20260608-ISSUE1588.P02c`

## Prerequisites

- Required: Phase 02b completed.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Cycle-Free Dependency Direction

**Full Text**: Settings must not depend on core/providers/tools/CLI, and no production cycle may exist.

**Behavior**:

- GIVEN integration contracts
- WHEN reviewer verifies package directions
- THEN no contract permits forbidden dependencies or untested compatibility paths

**Why This Matters**: The contract is the enforcement source for later phases.

## Implementation Tasks

No production files. Verify contracts against `analysis/final-architecture.md` and `analysis/package-metadata-constraints.md`.

## Verification Commands

```bash
rg -n "settings -> core|settings -> providers|settings -> cli|compatibility shim|backward compatibility" project-plans/issue1588/analysis/integration-contract.md project-plans/issue1588/analysis/final-architecture.md
```

Expected: forbidden directions appear only as forbidden statements; no final compatibility shim plan.

## Semantic Verification Checklist

- [ ] Every multi-package boundary has tests or scans.
- [ ] Settings singleton ownership is implementable without `settings -> core`.
- [ ] Profile types ownership prevents cycles.

## Success Criteria

Contracts can be used as acceptance gates in implementation.

## Failure Recovery

Return to P02b.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P02c.md`.
