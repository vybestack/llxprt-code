# Phase 07a: Extended Integration Verification

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P07a`

## Prerequisites

- Required: Phase 07 completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P07" packages/cli/src providers packages/core/src/auth`
- Expected files: Updated integration utilities, adapters, and tests.

## Implementation Tasks

### Files to Create

- `project-plans/statelessprovider/analysis/verification/P07-extended-report.md`
  - Summarize regression results and note any remaining singleton access points scheduled for later phases.
  - MUST include: `@plan:PLAN-20250218-STATELESSPROVIDER.P07a`
  - MUST include: `@requirement:REQ-SP-003`

### Required Markers

Include plan/requirement annotations inside the report.

## Verification Commands

```bash
npm run typecheck
npm test -- --runTestsByPath \
  packages/cli/src/runtime/__tests__/providerConfigUtils.test.ts \
  packages/cli/src/integration-tests/base-url-behavior.integration.test.ts \
  packages/cli/src/integration-tests/provider-switching.integration.test.ts \
  packages/core/src/auth/precedence.test.ts \
  packages/core/src/auth/__tests__/precedence.adapter.test.ts
```

## Manual Verification Checklist

- [ ] Report confirms provider utilities, zed integration, and dialogs operate through runtime helpers.
- [ ] Auth precedence adapter verified with injected settings instance.
- [ ] Identify any remaining legacy APIs targeted for P08/P09.
- [ ] Pseudocode references aligned with updated implementations.

## Success Criteria

- Verification certifies extended integration cleanup is complete and ready for focused test consolidation.

## Failure Recovery

1. Delete report if inconsistencies appear.
2. Fix integration issues, rerun commands, recreate report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P07a.md`

```markdown
Phase: P07a
Completed: YYYY-MM-DD HH:MM
Files Created:
- analysis/verification/P07-extended-report.md
Verification:
- <paste outputs>
```
