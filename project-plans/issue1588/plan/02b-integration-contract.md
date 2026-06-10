# Phase 02b: Integration Contract Definition

## Phase ID

`PLAN-20260608-ISSUE1588.P02b`

## Prerequisites

- Required: Phase 02a verified.

## Requirements Implemented (Expanded)

### REQ-CONS-001: Consumer Migration

**Full Text**: Core, providers, CLI, a2a-server, and tests must import moved settings/profile/storage APIs from the settings package after migration.

**Behavior**:

- GIVEN the dependency graph and consumers
- WHEN integration contracts are defined
- THEN every consumer boundary has an owner, direction, behavior, and verification command

**Why This Matters**: Multi-package refactors fail at boundaries, not at isolated classes.

## Implementation Tasks

### Files to Modify

- `analysis/integration-contract.md` - ensure contracts include public API, core runtime, core config, providers, profile/storage, CLI partial migration, and no-shim cleanup.

## Verification Commands

```bash
rg -n "IC-0[1-7]|Direction|Verification|Behavior" project-plans/issue1588/analysis/integration-contract.md
```

Expected: all integration contracts present.

## Semantic Verification Checklist

- [ ] Contract diagram matches final dependency graph.
- [ ] Runtime settings instance lifecycle is explicit.
- [ ] Provider and CLI consumer boundaries are explicit.
- [ ] No-shim contract is explicit.

## Success Criteria

Implementation phases have concrete integration boundaries.

## Failure Recovery

Update `analysis/integration-contract.md` before P02c.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P02b.md`.
