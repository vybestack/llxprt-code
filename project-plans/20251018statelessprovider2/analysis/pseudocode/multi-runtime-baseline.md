<!-- @plan:PLAN-20251018-STATELESSPROVIDER2.P03 @requirement:REQ-SP2-002 -->
1: Acquire or initialise shared immutable resources such as the MultiProviderTokenStore and file discovery caches so every runtime reuses them without reconfiguration.
2: Construct a fresh SettingsService per runtime from the supplied options, then instantiate Config with that service to avoid touching process-wide singletons.
3: Merge default values for model, debugMode, and workspaceDir, capture caller metadata, and assemble a runtime context object that keeps these scoped instances together.
4: Create an OAuthManager when the caller does not supply one, using the shared token store, and instantiate ProviderManager with the scoped runtime, settings, and config.
5: Retain activation bindings from runtimeSettings (reset hooks, context setter, infrastructure registration, provider-manager linker) so the factory can invoke them deterministically.
6: Implement activate to run reset, set runtime context, register infrastructure, and link the provider manager in that order while applying runtimeId/metadata overrides and running any prepare hook.
7: Implement cleanup to reverse activation obligations by resetting infrastructure, clearing the active runtime context, awaiting onCleanup, and disposing per-runtime workspace artifacts without touching shared immutable resources.
