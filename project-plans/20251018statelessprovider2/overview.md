# Stateless Provider Completion – Discovery Overview

## Context
- The original stateless provider initiative (PLAN-20250218-STATELESSPROVIDER) introduced `GenerateChatOptions`, runtime helpers, and partial CLI integration.
- Providers still retain constructor-injected `Config`/`SettingsService`, cache authentication tokens, and rely on `providerRuntimeContext`’s module-level `activeContext`.
- CLI runtime helpers (`runtimeSettings.ts`) and `ProviderManager` continue to mutate shared singletons, so subagents (or concurrent clients) would trample each other’s model/base URL/auth settings.
- Integration tests and mocks still fabricate providers via legacy mutators (`setApiKey`, `setBaseUrl`, `setModel`), masking leakage in the current suite.

## Objective
Deliver a focused refactor that makes providers *truly stateless* with respect to model/base URL/API key/model params and other per-runtime settings. Success requires that two simultaneous runtimes (e.g., two CLIs using different profiles) remain isolated without any provider state leaking between them. Global configuration that is not provider-specific may remain on `Config` for now; OAuth caching can remain mutable, but must not block per-runtime isolation.

## Structural Findings
- **CLI entrypoint (`packages/cli/src/ui/App.tsx`)** obtains a single `Config` at startup which flows into runtime helpers that manipulate process-level state via `setCliRuntimeContext`.
- **Core client (`packages/core/src/core/client.ts`)** continues to own history, compression, tool orchestration, and delegates to `GeminiChat`. It expects `Config` to be globally mutable.
- **Gemini chat (`packages/core/src/core/geminiChat.ts`)** creates provider runtime contexts under the hood but ultimately fetches providers from `ProviderManager`, which has process-wide state.
- **Base provider layer (`packages/core/src/providers/BaseProvider.ts`/`IProvider.ts`)**:
  - Stores `globalConfig`, `baseSettingsService`, `cachedAuthToken`, `authCacheTimestamp`, etc. on the instance.
  - Uses `this.activeSettingsOverride` to swap in per-call settings, but falls back to shared singletons when none are provided.
  - Auth resolver (`AuthPrecedenceResolver`) consults `getActiveProviderRuntimeContext()` when no settings service is supplied.
- **Concrete providers** (OpenAI, OpenAIResponses, Anthropic, Gemini):
  - Cache SDK clients (`_cachedClient`, `client`, etc.) keyed only on API key/base URL and stored on `this`.
  - Continue to read defaults and parameters from constructor-provided config/SettingsService.
- **Provider manager (`packages/core/src/providers/ProviderManager.ts`)**:
  - Maintains the active provider, wraps providers for logging, and keeps runtime usage statistics.
  - Calls `provider.setConfig(config)` and relies on the same `SettingsService` for all registered providers.
  - Assumes a single active provider per process.
- **Settings services**:
  - `SettingsService` is in-memory, but `settingsServiceInstance.ts` preserves a singleton and registers it with the runtime context fallback.
  - `getSettingsService()` still returns the singleton when no active context is set.
- **CLI runtime helpers/tests**:
  - `runtimeSettings.ts`, integration tests, and command tests still create providers with `setBaseUrl`, `setApiKey`, etc.
  - Module-level `registerCliProviderInfrastructure` stores a single OAuth manager/provider manager instance.

## Gaps to Address
1. **Introduce a regression test up-front**  
   - Add a failing CLI test that spins up two runtimes (e.g., load profile “zai” then “cerebrasqwen”) and asserts their settings remain isolated. This test defines the minimum acceptable behavior.

2. **Provider instance detox**  
   - Remove constructor-time dependencies on `Config`/`SettingsService`; migrate to per-call options.  
   - Move caches (SDK clients, auth tokens) to runtime-keyed registries or inject them via helpers supplied in `GenerateChatOptions`.  
   - Ensure `BaseProvider` no longer uses `this.activeSettingsOverride` or any `this.*` state to satisfy a call.

3. **Runtime context redesign**  
   - Replace global `activeContext` with explicit context parameters (passed through all provider manager/gemini chat entry points).  
   - Ensure `SettingsService` access is always explicit: if no context is supplied, operations should fail fast rather than fallback to the shared singleton.

4. **Provider manager simplification**  
   - Convert `ProviderManager` to a per-runtime registry that holds no mutable state beyond provider map and metadata.  
   - Expose factory helpers that return manager + OAuth manager for each runtime without touching shared singletons.

5. **CLI runtime helpers**  
   - Refactor `/provider`, `/model`, `/profile`, `/set`, `/baseurl`, `/key`, `/keyfile` flows to operate against the runtime passed in, not module-level state.  
   - Update hooks/components (e.g., `useProviderDialog`, `useProviderModelDialog`, `useAuthCommand`) to consume runtime context from props/React context rather than calling global helpers.

6. **Authentication refactor (scoped to providers)**  
   - Move `cachedAuthToken`/`authCacheTimestamp` out of provider instances. Provide a runtime-aware cache service keyed by runtime ID + provider name.  
   - Allow OAuth managers to be per-runtime; optionally keep the existing manager but key token storage by runtime when available.

7. **Testing cleanup & new coverage**  
   - Update CLI/core integration tests to use runtime helpers instead of legacy mutators.  
   - Add concurrency/multi-runtime tests (e.g., two simultaneous provider calls with different model/base URL).  
   - Re-enable or create new tests proving providers do not reference `this.globalConfig` or shared settings.

8. **Documentation & plan**  
   - Once analysis is approved, create `dev-docs/PLAN.md` (using PLAN-TEMPLATE) describing execution phases, guarding success criteria, and defining the new “quality gate” test.  
   - Update existing docs to reflect true stateless behavior after the implementation is complete.

## Success Criteria
- Providers must obtain all per-call state (model, base URL, auth, tool format, model params) through arguments or runtime helper objects, not from instance fields or singletons.
- Running two runtime contexts simultaneously (parent session + simulated subagent) must not cause settings/auth leakage. The initial regression test must pass.
- CLI commands `/provider`, `/model`, `/set`, `/profile`, `/baseurl`, `/key`, `/keyfile` must continue to operate on the foreground runtime, using the new plumbing.
- No code path may rely on module-level `activeContext` or `getSettingsService()` fallbacks to process-wide singletons.
- OAuth caching can remain stateful but must be scoped such that it doesn’t leak tokens between runtimes; tying it to the runtime’s settings service is acceptable at this stage.

The project is not considered successful until these criteria are met and the new regression test confirms independent runtime isolation. Additional follow-up plans (subagent orchestration, broader Config refactors) can build on this foundation but are out of scope here.
