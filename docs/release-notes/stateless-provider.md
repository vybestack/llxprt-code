# Release Notes: Stateless Provider Runtime

**Phase:** PLAN-20250218-STATELESSPROVIDER.P10  
**Version target:** v0.5.0 (core, cli, vscode companion)

## Highlights

- Stateless provider runtime with per-context `SettingsService` instances.
- New CLI runtime helper APIs for provider switching, profiles, and diagnostics.
- Enhanced documentation and migration guidance for teams embedding LLxprt Code.
- Release validation suite refreshed for the new architecture.

## Breaking changes

- `SettingsService` is no longer a singleton. Consumers must operate through the active `ProviderRuntimeContext`.
- `GenerateChatOptions` now delivers `settings`, `config`, and `runtime`. Provider implementations are expected to use these instead of global imports.
- Deprecated provider hooks (`setConfig`, `clearState`, `clearAuth`, `clearAuthCache`) will be removed in the next minor cycle.
- CLI command handlers rely on `runtimeSettings` helpers; any out-of-tree extensions should do the same.

## Migration summary

- Follow the [Stateless Provider migration guide](../migration/stateless-provider.md) to update integrations.
- Adopt the new API references for [`ProviderRuntimeContext`](../core/provider-runtime-context.md), [`runtimeSettings` helpers](../cli/runtime-helpers.md), and the updated [provider interface](../core/provider-interface.md).
- Refresh subagent workflows to call `createProviderRuntimeContext()` before mutating provider state.

## Testing guidance

Run the full verification suite before publishing artifacts:

```bash
npm run lint -- --cache
npm run typecheck
npm run test
```

For downstream consumers, add integration coverage that spins up multiple runtime contexts (CLI + at least one subagent) to confirm settings isolation.

## Deprecations

- Provider methods `setConfig`, `clearState`, `clearAuth`, and `clearAuthCache` are flagged for removal in the next release.
- Legacy helpers that assumed a global `SettingsService` will throw if no active runtime is registered.

## Known issues

- Providers that bypass the runtime helpers may still share credentials inadvertently. Ensure all command handlers and automation flows go through the helper surface.
- Legacy scripts that rely on implicit contexts should call `createProviderRuntimeContext()` during bootstrap.
