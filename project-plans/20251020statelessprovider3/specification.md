# Feature Specification: Stateless Provider Bootstrap Repairs

## Purpose

Restore profile loading and provider selection in the stateless provider build by fixing the existing bootstrap sequence rather than layering new orchestration abstractions. The current CLI path calls `loadCliConfig()` before the provider manager is fully linked, so `--profile-load` loses its base URL and key, and `/profile load` can trigger `Cannot set properties of undefined (setting 'authMode')`.

## Architectural Decisions

- **Pattern**: Incremental refactor of existing modules (no new orchestrators)
- **Technology Stack**: TypeScript strict mode, Vitest, existing CLI/core packages
- **Data Flow**: `scripts/start.js` → `loadCliConfig()` → `runtimeSettings` helpers → `OAuthManager`
- **Integration Points**: Reuse current bootstrap helpers, runtime helpers, and OAuth manager

## Project Structure
```
project-plans/20251020statelessprovider3/
  specification.md
  analysis/
    domain-model.md
    pseudocode/
      bootstrap-order.md
      profile-application.md
      oauth-safety.md
  plan/
    00-overview.md
    01-*.md … 12-*.md
```

## Technical Environment
- **Type**: Node.js CLI bootstrap
- **Runtime**: Node.js 20.x
- **Dependencies**: Existing `@vybestack/llxprt-code` workspace packages

## Integration Points (MANDATORY SECTION)

### Existing Code That Will Use This Feature
- `scripts/start.js` – CLI entry, must call the corrected bootstrap sequence
- `packages/cli/src/config/config.ts::loadCliConfig` – profile argument handling
- `packages/cli/src/runtime/runtimeSettings.ts` – applies profiles and updates provider settings
- `packages/cli/src/ui/commands/profileCommand.ts` – `/profile load` uses runtime helpers
- `packages/cli/src/auth/oauth-manager.ts` – clears provider state on logout/profile change

### Existing Code To Be Replaced / Adjusted
- Inline profile application block inside `loadCliConfig` that runs before provider manager is ready
- Direct provider lookups inside `runtimeSettings.applyProfileSnapshot` that assume the provider exists
- `OAuthManager.clearProviderAuthCaches` direct property writes without wrapper awareness
- Bootstrap argument flow in `scripts/start.js` that bypasses runtime helpers

### User Access Points
- `llxprt --profile-load <name> --prompt "..."` during startup
- `/profile load <name>` inside the interactive CLI session

### Migration Requirements
- Existing profiles in `~/.llxprt/profiles/*.json` must stay compatible
- No changes to CLI arguments, environment variables, or settings schema
- All existing tests in `packages/cli/src/integration-tests` must continue to run

## Formal Requirements
[REQ-SP3-001] Correct CLI bootstrap ordering
  [REQ-SP3-001.1] Runtime context must exist before profile loading
  [REQ-SP3-001.2] Provider manager must be linked before profile application
  [REQ-SP3-001.3] `scripts/start.js` must use the corrected bootstrap helper

[REQ-SP3-002] Robust profile application
  [REQ-SP3-002.1] `applyProfileSnapshot` must guard provider lookups
  [REQ-SP3-002.2] Profile loading must preserve base URL and key overrides
  [REQ-SP3-002.3] Slash command profile loads share the same path as startup

[REQ-SP3-003] Safe OAuth cache clearing
  [REQ-SP3-003.1] `OAuthManager` must unwrap logging wrappers before clearing state
  [REQ-SP3-003.2] Cache clearing must skip when provider is unavailable

[REQ-SP3-004] Regression coverage
  [REQ-SP3-004.1] Integration tests cover `--profile-load` bootstrap
  [REQ-SP3-004.2] Integration tests cover `/profile load` during a session

## Data Schemas
```ts
export interface BootstrapProfileArgs {
  profileName: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
}

export interface ProfileApplicationResult {
  providerName: string;
  modelName: string;
  baseUrl?: string;
  warnings: string[];
}
```

## Example Data
```json
{
  "startupArgs": {
    "profileName": "synthetic",
    "providerOverride": null,
    "modelOverride": null
  },
  "applicationResult": {
    "providerName": "openai",
    "modelName": "hf:zai-org/GLM-4.6",
    "baseUrl": "https://api.synthetic.new/openai/v1",
    "warnings": []
  }
}
```

## Constraints
- No new global singletons or orchestrator classes
- No breaking changes to configuration or command syntax
- Keep new helper functions under existing module namespaces
- Maintain current lint/typecheck/format baselines

## Success Criteria
1. `llxprt --profile-load synthetic --prompt "hello"` runs without missing API key/base URL.
2. `/profile load synthetic` in an interactive session loads the profile and retains overrides.
3. No `Cannot set properties of undefined` errors produced by `OAuthManager`.
4. Added integration tests fail without the fixes and pass afterward.
