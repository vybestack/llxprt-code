# Phase 08: Test Suite Consolidation

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P08`

## Prerequisites

- Required: Phase 07a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P07a" project-plans/statelessprovider/analysis/verification/P07-extended-report.md`
- Expected files: Core/CLI runtime migration complete, helpers in place.

## Implementation Tasks

### Files to Modify

- `packages/core/src/providers/BaseProvider.test.ts`
  - Remove/replace legacy setter expectations; add coverage for stateless invocation paths.
- `packages/core/src/providers/integration/multi-provider.integration.test.ts`
  - Ensure tests exercise multiple contexts simultaneously.
- `packages/cli/src/integration-tests/*.ts`
  - Consolidate overlapping scenarios (provider/model/profile/base-url) into table-driven suites.
- `packages/cli/src/ui/commands/*.test.ts`
  - Update mocks to leverage runtime helpers instead of provider setters.
- `packages/core/test/settings/SettingsService.spec.ts`
  - Add cases for multiple instances and profile import/export with new adapters.
- `packages/core/src/core/geminiChat.runtime.test.ts`
  - Expand coverage for streaming, retries, and tool invocations under multiple contexts.
- `packages/core/src/auth/precedence.test.ts`
  - Validate precedence under scenarios with explicit context injection.
- `packages/cli/src/runtime/runtimeSettings.test.ts`
  - Add regression coverage reflecting CLI behaviours updated in P07.

### Files to Create

- `packages/core/test/providerRuntime.e2e.spec.ts`
  - End-to-end style test constructing two contexts (main agent + simulated subagent) to confirm isolation.
- `packages/cli/src/integration-tests/subagent-simulation.integration.test.ts`
  - Exercise CLI runtime helpers invoked with cloned settings (prepping for future subagent feature).

### Cleanup Tasks

- Remove obsolete tests referencing provider setters (e.g., `OpenAIProvider.setModel.test.ts`).
- Update Vitest configuration if additional suites are added.
- Ensure all new tests include plan/requirement/pseudocode markers.

## Verification Commands

```bash
npm run lint -- --cache
npm run test
npm run typecheck
```

## Manual Verification Checklist

- [ ] No tests rely on deprecated provider APIs.
- [ ] New multi-context tests confirm isolation.
- [ ] Test runtime duration reviewed; mark long-running suites for possible parallelisation.
- [ ] Coverage updated for PR gating (if applicable).

## Success Criteria

- Entire test suite passes without relying on legacy APIs.
- Additional coverage demonstrates readiness for stateless providers + subagents.

## Failure Recovery

1. Revert problematic test changes.
2. Reconcile coverage gaps with pseudocode and re-run the full suite.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P08.md`

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Modified/Created:
- <list>
Verification:
- <paste outputs>
```
