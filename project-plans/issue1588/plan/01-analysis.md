# Phase 01: Analysis And Move Classification

## Phase ID

`PLAN-20260608-ISSUE1588.P01`

## Prerequisites

- Required: Phase 0.5 completed and verified.
- Expected files: `analysis/preflight-results.md` populated.

## Requirements Implemented (Expanded)

### REQ-SET-001: Settings Package Boundary

**Full Text**: Settings service, settings types, settings registry, settings service instance management, profile management, and current config storage helpers must live in `packages/settings` with a clean public API.

**Behavior**:

- GIVEN current settings/config/profile/storage source files
- WHEN the implementation agent classifies ownership
- THEN every moved, retained, or deferred file has a documented dependency-safe destination

**Why This Matters**: Moving files blindly can create cycles or strand behavior in core.

### REQ-DEP-001: Cycle-Free Dependency Direction

**Full Text**: `packages/settings` must not depend on providers, tools, CLI, or core, and production dependencies must not form a cycle.

**Behavior**:

- GIVEN current dependency blockers
- WHEN analysis completes
- THEN every blocker has a concrete resolution before coding

**Why This Matters**: The package boundary is the central acceptance criterion.

## Implementation Tasks

### Files to Modify

- `analysis/dependency-audit.md` - update with current preflight findings.
- `analysis/settings-move-map.md` - finalize moved/retained/deferred classification.
- `analysis/consumer-import-matrix.md` - paste current consumer import inventory summary.
- `analysis/final-architecture.md` - update if preflight disproves assumptions.

## Verification Commands

```bash
rg -n "TBD|TODO|unknown" project-plans/issue1588/analysis/dependency-audit.md project-plans/issue1588/analysis/settings-move-map.md project-plans/issue1588/analysis/consumer-import-matrix.md
rg -n "packages/storage" project-plans/issue1588/analysis/*.md
```

Expected: no unresolved placeholders; any storage mention documents the missing package and internal storage decision.

## Semantic Verification Checklist

- [ ] Every issue #1588 requested move is classified.
- [ ] Every cycle blocker has a planned resolution.
- [ ] CLI god-object-deferred scope is explicit.
- [ ] Existing `packages/providers` work and issue1584 boundary rules are considered.

## Success Criteria

Analysis artifacts are current and implementation phases can proceed without guessing ownership.

## Failure Recovery

If a file cannot be classified, stop and update architecture before P02.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P01.md`.
