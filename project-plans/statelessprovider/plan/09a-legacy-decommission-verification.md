# Phase 09a: Legacy Decommission Verification

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P09a`

## Prerequisites

- Required: Phase 09 completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P09" packages`
- Expected files: Legacy APIs removed/gated, docs updated.

## Implementation Tasks

### Files to Create

- `project-plans/statelessprovider/analysis/verification/P09-decommission-report.md`
  - Record lint/typecheck/test outputs and enumerate remaining deprecation warnings (should be none).
  - MUST include: `@plan:PLAN-20250218-STATELESSPROVIDER.P09a`
  - MUST include: `@requirement:REQ-SP-001`

### Required Markers

Insert plan/requirement annotations within the report.

## Verification Commands

```bash
npm run typecheck
npm run test
rg "setModel" packages -g"*.ts"
rg "getSettingsService" packages -g"*.ts"
```

## Manual Verification Checklist

- [ ] Confirm only sanctioned helpers remain; no production code references deprecated APIs.
- [ ] Ensure documentation/changelog entries accurately describe changes.
- [ ] Validate release packaging (if applicable) includes migration notes.

## Success Criteria

- Verification report certifies architecture transition is complete and backward-compat layers removed.

## Failure Recovery

1. Delete report if any command fails.
2. Resolve remaining references, rerun commands, recreate report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P09a.md`

```markdown
Phase: P09a
Completed: YYYY-MM-DD HH:MM
Files Created:
- analysis/verification/P09-decommission-report.md
Verification:
- <paste outputs>
```
