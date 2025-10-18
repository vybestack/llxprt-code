# Phase 06a: CLI Migration Verification

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P06a`

## Prerequisites

- Required: Phase 06 completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P06" packages/cli/src`
- Expected files from previous phase: Updated CLI helpers, commands, hooks, tests.

## Implementation Tasks

### Files to Create

- `project-plans/statelessprovider/analysis/verification/P06-cli-report.md`
  - Document command coverage, integration test status, and any manual verification results.
  - MUST include: `@plan:PLAN-20250218-STATELESSPROVIDER.P06a`
  - MUST include: `@requirement:REQ-SP-003`

### Required Markers

Include plan/requirement annotations inside the report.

## Verification Commands

```bash
npm run typecheck
npx vitest run packages/cli/src/runtime/runtimeSettings.test.ts packages/cli/src/integration-tests/cli-args.integration.test.ts packages/cli/src/integration-tests/model-params-isolation.integration.test.ts packages/cli/src/integration-tests/base-url-behavior.integration.test.ts
```

## Manual Verification Checklist

- [ ] CLI commands execute successfully using runtime helpers (smoke test).
- [ ] Report lists remaining legacy access (if any) and assigns follow-up actions.
- [ ] Ensure UI hooks and dialogs operate without direct provider mutations.
- [ ] Confirm pseudocode traceability references are accurate.

## Success Criteria

- Verification certifies CLI migration is stable and ready for extended integrations (P07).

## Failure Recovery

1. Delete the report if inconsistencies are discovered.
2. Resolve CLI helper issues, rerun verification commands, recreate report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P06a.md`

```markdown
Phase: P06a
Completed: YYYY-MM-DD HH:MM
Files Created:
- analysis/verification/P06-cli-report.md
Verification:
- <paste outputs>
```
