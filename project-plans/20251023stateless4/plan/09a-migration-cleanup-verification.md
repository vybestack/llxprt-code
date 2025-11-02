# Phase 09a: Migration & Cleanup Verification

## Phase ID
`PLAN-20251023-STATELESS-HARDENING.P09a`

## Prerequisites
- Required: `.completed/P09.md` summarised.
- Verification: `test -f project-plans/20251023stateless4/.completed/P09.md`
- Expected files from previous phase: Cleanup changes and documentation updates.

## Implementation Tasks

### Files to Modify
- `project-plans/20251023stateless4/analysis/verification/base-provider-fallback-removal.md`
  - Confirm cleanup removed fallback references.
- `project-plans/20251023stateless4/analysis/verification/provider-cache-elimination.md`
  - Check final state for lingering cache markers.

### Activities
- Execute repository-wide search commands to validate cleanup.
- Ensure documentation updates include `@plan:PLAN-20251023-STATELESS-HARDENING.P09` markers.

### Required Code Markers
- Verification notes reference impacted requirements using `@requirement:REQ-SP4-00X` annotations.

## Verification Commands

### Automated Checks
```bash
rg "getSettingsService" packages/core/src/providers && exit 1
rg "modelParams" packages/core/src/providers && exit 1
```

### Manual Verification Checklist
- [ ] No banned patterns remain.
- [ ] Docs accurately describe runtime guard and stateless behaviour.
- [ ] Export surface matches new error/guard constructs.

## Success Criteria
- Cleanup validated; repository prepared for deprecation messaging.

## Failure Recovery
1. Remove remaining references and rerun commands.
2. Update docs with correct instructions.

## Phase Completion Marker
- Create `.completed/P09a.md` capturing timestamp, search outputs, and reviewer notes per PLAN-TEMPLATE guidelines.
