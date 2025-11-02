<!-- @plan:PLAN-20250218-STATELESSPROVIDER.P02 @requirement:REQ-SP-005 -->

1: On CLI bootstrap start, read persisted configuration paths and parse command line flags.
2: Instantiate settingsService = new SettingsService(); avoid touching legacy singleton getters.
3: Populate settingsService defaults from config files, env vars, and flag overrides (provider, model, params, auth keys).
4: Create config = new Config({ settingsService, filesystem, telemetry, memoryStore });
5: Register runtime context via setActiveProviderRuntimeContext({ settingsService, config, runtimeId });
6: Build providerManagerFactory that returns new ProviderManager(settingsService, config, providerRegistry) per runtime.
7: When --profile-load flag present, read profile file, validate schema, and apply values through settingsService.importProfile(profileData).
8: After profile import, notify config of updated provider/model selections so chat loop uses refreshed settings.
9: For `/provider` command, update settingsService.setActiveProvider(providerName) and emit confirmation to user.
10: For `/model` command, update settingsService.setModel(providerName, modelId, modelParams) and refresh config caches.
11: For `/profile save`, gather snapshot = settingsService.exportProfile(); write snapshot to requested path via profileManager.
12: Ensure profile save also persists runtime metadata (timestamp, provider, model) for user visibility without mutating provider instances.
13: For `/profile load`, reuse step 7 logic and broadcast change events so UI refreshes current provider/model displays.
14: When creating Gemini chat loop, pass settingsService and config to geminiChat invocation helper instead of global lookups.
15: Supply providerManagerFactory to chat loop so each new conversation obtains a fresh ProviderManager bound to runtime context.
16: Register teardown handler on process exit to clear runtime context via clearActiveProviderRuntimeContext() and flush telemetry.
17: During CLI tests, expose bootstrap helper that constructs isolated settingsService/config pairs without touching shared state.
18: Guard command handlers against execution before runtime context is registered; surface actionable error if bootstrap fails.
19: When subagent sessions spawn, allow them to call createProviderRuntimeContext(settingsService, config) without replacing CLI context.
20: Document migration path for legacy helpers so future phases can drop providerManagerInstance singleton once adoption complete.
