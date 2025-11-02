# Phase 06: CLI Command & UI Migration

## Phase ID

`PLAN-20250218-STATELESSPROVIDER.P06`

## Prerequisites

- Required: Phase 05a completed.
- Verification: `grep -r "PLAN-20250218-STATELESSPROVIDER.P05a" project-plans/statelessprovider/analysis/verification/P05-core-report.md`
- Expected files from previous phase: Updated core runtime wiring and context helpers.

## Implementation Tasks

### Files to Create

- `packages/cli/src/runtime/runtimeSettings.ts`
  - Implement helper functions for provider/model/profile operations backed by the injected `SettingsService` and `Config`.
  - Provide typings for runtime context consumption on the CLI side.
  - Include instrumentation (debug logging hooks) consistent with existing CLI conventions.
- `packages/cli/src/runtime/runtimeSettings.test.ts`
  - Cover provider switch, model change, profile load/save, key/base-url updates.

### Files to Modify

- `packages/cli/src/gemini.tsx`
  - Instantiate the session `SettingsService`, register it with `setActiveProviderRuntimeContext`, and construct `Config` with the same instance (preserving singleton semantics for the main CLI runtime).
  - Export the runtime helper bundle for commands/hooks while keeping backwards-compatible defaults.
- `packages/cli/src/config/config.ts`
  - Surface the runtime helpers to downstream commands and UI code.
- `packages/cli/src/ui/commands/{modelCommand,providerCommand,profileCommand,setCommand,toolformatCommand,diagnosticsCommand,keyCommand,baseurlCommand}.ts`
  - Replace direct provider mutators and singleton calls with the new runtime helpers.
  - Maintain user-facing behaviour/messages.
- `packages/cli/src/providers/providerManagerInstance.ts`
  - Update to consume runtime helpers when wiring CLI-specific behaviour (e.g., OAuth updates).
- `packages/cli/src/ui/hooks/{useGeminiStream,useProviderDialog,useLoadProfileDialog,useProviderModelDialog,useOpenAIProviderInfo}.ts`
  - Swap direct provider access with helper usage so provider/model state flows through the active runtime context.
- `packages/cli/src/ui/containers/SessionController.tsx`
  - Derive current provider/model/paid-mode information from the runtime helpers instead of the provider manager singleton.
- `packages/cli/src/ui/App.tsx`
  - Inject the runtime helper context and remove fallback calls to `getSettingsService()`.
- `packages/cli/src/ui/components/{StatsDisplay.tsx,Footer.tsx}`
  - Read token metrics, model labels, and paid/free mode through the helper layer.
- `packages/cli/src/ui/commands/aboutCommand.ts`
  - Resolve the active provider/model via runtime helpers rather than direct provider manager imports.
- `packages/cli/src/ui/containers/SessionController.test.tsx` and related UI/component tests
  - Update mocks to use the runtime helper API instead of direct provider manager spies.
- `packages/cli/src/ui/{App.test.tsx,App.e2e.test.tsx}`
  - Align test harnesses with the new runtime helper/context wiring.
- `packages/core/src/integration-tests/profile-integration.test.ts`
  - Adjust tests to assert helper-driven state changes rather than provider setters.
- `packages/cli/src/integration-tests/{cli-args.integration.test.ts,model-params-isolation.integration.test.ts,base-url-behavior.integration.test.ts}`
  - Update expectations to reflect helper pathways and ensure parity with prior behaviour.

### Constraints

- CLI must remain fully functional after this phase.
- No command should directly call provider mutators (`setModel`, `setBaseUrl`, etc.) once migration completes.
- Provide clear deprecation warnings (console or code comments) for any compatibility shims left in place.

### Required Markers

Tag updated sections with plan/requirement/pseudocode annotations referencing `cli-runtime.md`.

## Verification Commands

```bash
npm run typecheck
npx vitest run packages/cli/src/runtime/runtimeSettings.test.ts packages/cli/src/integration-tests/cli-args.integration.test.ts packages/cli/src/integration-tests/model-params-isolation.integration.test.ts packages/cli/src/integration-tests/base-url-behavior.integration.test.ts
```

## Manual Verification Checklist

- [ ] Commands `/provider`, `/model`, `/profile`, `/set`, `/toolformat`, `/key`, `/baseurl` work end-to-end using runtime helpers.
- [ ] Profile load/save reflects changes in `SettingsService` without touching providers.
- [ ] UI hooks and components operate without reading the singleton or provider manager directly.
- [ ] Runtime helpers documented and linked to pseudocode lines.

## Success Criteria

- CLI surfaces (commands, hooks, UI) rely exclusively on the injected settings/config context.
- Automated integration tests updated in this phase pass.

## Failure Recovery

1. Revert affected CLI files if regressions occur.
2. Address helper logic issues, rerun verification commands, recreate report.

## Phase Completion Marker

Create: `project-plans/statelessprovider/.completed/P06.md`

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/cli/src/runtime/runtimeSettings.ts
- packages/cli/src/runtime/runtimeSettings.test.ts
- packages/cli/src/gemini.tsx
- packages/cli/src/config/config.ts
- packages/cli/src/ui/commands/{modelCommand,providerCommand,profileCommand,setCommand,toolformatCommand,diagnosticsCommand,keyCommand,baseurlCommand}.ts
- packages/cli/src/providers/providerManagerInstance.ts
- packages/cli/src/ui/hooks/{useGeminiStream,useProviderDialog,useLoadProfileDialog,useProviderModelDialog,useOpenAIProviderInfo}.ts
- packages/cli/src/ui/containers/SessionController.tsx
- packages/cli/src/ui/containers/SessionController.test.tsx
- packages/cli/src/ui/{App.test.tsx,App.e2e.test.tsx}
- packages/cli/src/ui/App.tsx
- packages/cli/src/ui/components/{StatsDisplay.tsx,Footer.tsx}
- packages/cli/src/ui/commands/aboutCommand.ts
- packages/core/src/integration-tests/profile-integration.test.ts
- packages/cli/src/integration-tests/{cli-args.integration.test.ts,model-params-isolation.integration.test.ts,base-url-behavior.integration.test.ts}
Verification:
- <paste outputs>
```
