# Phase 07: Extended Integration Cleanup

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P07`

## Prerequisites

- Required: Phase 06a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P06a" project-plans/statelessprovider/analysis/verification/P06-cli-report.md`
- Expected files from previous phases: Runtime helpers in core and CLI fully functional.

## Implementation Tasks

### Files to Modify

- `packages/cli/src/providers/providerConfigUtils.ts`
  - Replace direct provider mutations with runtime helper usage.
  - Ensure helper handles base-url/auth updates consistently.
- `packages/cli/src/zed-integration/zedIntegration.ts`
  - Inject runtime helpers for provider/model/base-url handling.
- `packages/cli/src/ui/hooks/useProviderDialog.ts`
  - Remove remaining direct setter usage, reusing helper functions.
- `packages/cli/src/ui/hooks/useLoadProfileDialog.ts`
  - Ensure profile application uses runtime helpers and settings service injection.
- `packages/cli/src/integration-tests/{base-url-behavior.integration.test.ts,provider-switching.integration.test.ts}`
  - Update tests to assert helper-driven logic.
- `packages/cli/src/providers/provider-gemini-switching.test.ts`
  - Adjust mocks to align with the new helper-based interactions.
- `packages/core/src/auth/precedence.test.ts`
  - Extend coverage to validate the injected-settings pathway introduced in P05.
- `packages/core/src/config/profileManager.ts`
  - Confirm it relies on the injected settings service (no singleton fallback).
- `packages/core/src/providers/openai/getOpenAIProviderInfo.ts`
  - Switch from provider-instance introspection to reading model/responses-mode data from the active runtime `SettingsService`/context (with safe fallbacks).
- Documentation comments or `TODO` markers referencing future subagent support should be updated for clarity.
- Audit ancillary consumers (e.g., `scripts/benchmark/*`, `test-scripts/*`, `packages/a2a-server/*`) and stage shims if they still call provider setters; capture follow-up items for P08/P09.

### Files to Create / Tests

- `packages/cli/src/runtime/providerConfigUtils.test.ts`
  - Cover runtime helper interactions within provider configuration utilities.
- `packages/core/src/auth/precedence.adapter.test.ts`
  - Verify adapter path for injected settings services.
- `packages/core/src/providers/openai/getOpenAIProviderInfo.context.test.ts`
  - Add coverage to prove the helper works with injected settings and without legacy getters.
- Update existing OpenAI provider info tests (or add the new suite above) to assert context-driven behaviour.

### Constraints

- No behavioural regression; all integration tests must pass.
- Auth precedence logic must remain unchanged aside from context injection.
- Ensure all new adapters are backward compatible with existing imports.

### Required Markers

Annotate updated sections with plan/requirement/pseudocode markers tied to `cli-runtime.md` or `base-provider.md` as appropriate.

## Verification Commands

```bash
npm run typecheck
npx vitest run \
  packages/cli/src/runtime/providerConfigUtils.test.ts \
  packages/cli/src/integration-tests/base-url-behavior.integration.test.ts \
  packages/cli/src/integration-tests/provider-switching.integration.test.ts \
  packages/core/src/auth/precedence.test.ts \
  packages/core/src/auth/precedence.adapter.test.ts \
  packages/core/src/providers/openai/getOpenAIProviderInfo.context.test.ts
```

## Manual Verification Checklist

- [ ] Provider/base-url utilities function via runtime helpers.
- [ ] Zed integration works with injected context (smoke tested if feasible).
- [ ] Auth precedence tests prove the injected settings flow.
- [ ] Profile manager uses injected service exclusively.
- [ ] OpenAI provider info surfaces (CLI hook, helper function) report current model/responses mode without provider-instance state.

## Success Criteria

- Secondary integration points are aligned with the stateless provider architecture.
- Automated tests updated in this phase pass.

## Failure Recovery

1. Revert affected files if regressions occur.
2. Resolve helper/adapter issues, rerun verification commands, recreate report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P07.md`

```markdown
Phase: P07
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/providers/providerConfigUtils.ts
- packages/cli/src/zed-integration/zedIntegration.ts
- packages/cli/src/ui/hooks/useProviderDialog.ts
- packages/cli/src/ui/hooks/useLoadProfileDialog.ts
- packages/cli/src/integration-tests/base-url-behavior.integration.test.ts
- packages/cli/src/integration-tests/provider-switching.integration.test.ts
- packages/cli/src/providers/provider-gemini-switching.test.ts
- packages/core/src/auth/precedence.test.ts
- packages/core/src/config/profileManager.ts
- packages/cli/src/runtime/providerConfigUtils.test.ts
- packages/core/src/auth/precedence.adapter.test.ts
- packages/core/src/providers/openai/getOpenAIProviderInfo.ts
- packages/core/src/providers/openai/getOpenAIProviderInfo.context.test.ts
Verification:
- <paste outputs>
```
