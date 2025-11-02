# Stateless Provider Migration Guide

The `PLAN-20250218-STATELESSPROVIDER` programme converts LLxprt Code's provider stack into a stateless, runtime-scoped architecture. This guide summarises the behavioural changes, highlights breaking API updates, and walks through the steps external integrators should follow to adopt the new model.

## Audience

- CLI plugin and extension authors embedding LLxprt Code.
- Automation harnesses that call into `@vybestack/llxprt-code` or `@vybestack/llxprt-code-core`.
- Provider maintainers targeting the core provider interface.

## What changed

- **`SettingsService` is no longer a singleton.** Each `ProviderRuntimeContext` owns a dedicated instance plus scoped metadata, telemetry emitters, and logging channels.
- **Provider entry points receive explicit runtime context.** `GenerateChatOptions` now surfaces `settings`, `config`, and `runtime` so providers no longer need to import static modules.
- **CLI helpers drive settings mutations.** Commands such as `/provider`, `/key`, `/model`, and `/subagent` rely on the helper bundle in `packages/cli/src/runtime/runtimeSettings.ts`.
- **Nested contexts are supported.** Subagents, automation flows, and IDE hosts can create short-lived contexts without affecting the primary CLI runtime.

## Upgrade checklist

1. **Capture the active runtime instead of global imports**

   ```ts
   // Before
   import { getSettingsService } from '@vybestack/llxprt-code-core';
   const settings = getSettingsService();

   // After
   import { getCliRuntimeServices } from '@vybestack/llxprt-code/src/runtime/runtimeSettings';
   const { settingsService: settings } = getCliRuntimeServices();
   ```

   For non-CLI consumers use `createProviderRuntimeContext()` followed by `setActiveProviderRuntimeContext()` to install the context that should serve downstream calls.

2. **Stop calling deprecated provider hooks**
   - Remove `provider.setConfig(...)` and instead pass the `Config` instance via `GenerateChatOptions`.
   - Replace `provider.clearState()` with scoped runtime disposal logic (for example, reset caches when a runtime is torn down).
   - Avoid `provider.clearAuth()` and `provider.clearAuthCache()`; runtime-local authentication handlers own that lifecycle.

3. **Update provider implementations**

   ```ts
   export class ExampleProvider extends BaseProvider {
     async *generateChatCompletion(options: GenerateChatOptions) {
       const runtime = options.runtime ?? getActiveProviderRuntimeContext();
       const settings = runtime.settingsService;
       const apiKey = settings.getProviderSetting(this.name, 'apiKey');
       // ...
     }
   }
   ```

   Always honour the `options.runtime` passed by callers. Fallback to `getActiveProviderRuntimeContext()` only if absolutely necessary (for example in legacy tests).

4. **Wrap nested work with runtime helpers**

   When launching subagents or background jobs, create a new runtime and restore the parent afterwards:

   ```ts
   import {
     createProviderRuntimeContext,
     setActiveProviderRuntimeContext,
     clearActiveProviderRuntimeContext,
     peekActiveProviderRuntimeContext,
   } from '@vybestack/llxprt-code-core';

   export async function runWithIsolatedRuntime(
     metadata: Record<string, unknown>,
     job: () => Promise<void>,
   ) {
     const previous = peekActiveProviderRuntimeContext();
     const runtime = createProviderRuntimeContext({ metadata });
     setActiveProviderRuntimeContext(runtime);
     try {
       await job();
     } finally {
       clearActiveProviderRuntimeContext();
       if (previous) {
         setActiveProviderRuntimeContext(previous);
       }
     }
   }
   ```

5. **Adopt CLI helper workflows**

   The CLI exposes `switchActiveProvider()`, `updateActiveProviderApiKey()`, `setActiveModel()`, and other helpers. Call these helpers instead of mutating the `SettingsService` directly so that the runtime stays consistent with persisted profiles and diagnostics telemetry.

## Testing and verification

Run the verification suite to confirm that linting, typing, and unit tests still succeed with the new runtime model:

```bash
npm run lint -- --cache
npm run typecheck
npm run test
```

## Frequently asked questions

- **Do I need to rewrite my settings UI?** Generally no. Redirect all read/write calls through the runtime helpers and the same UI will operate on the scoped `SettingsService`.
- **How do I share credentials between contexts?** Use profiles or explicitly copy the values you need. Contexts are intentionally isolated to avoid accidental leakage.
- **Can I still access the old singleton?** No. `getSettingsService()` now resolves through the active runtime and throws if no runtime is registered. Ensure you set up a context during bootstrap.
