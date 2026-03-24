# Phase 2: Extract Middle-Layer Modules

Extract `runtimeAccessors.ts` and `runtimeLifecycle.ts`. These depend on the Phase 1 modules (`runtimeRegistry`, `statelessHardening`) and provide the foundation that Phase 3 modules build on.

## Step 2.1: Extract `runtimeAccessors.ts`

This is the largest extraction — it contains the read-side of runtime state (queries, ephemeral access, provider status) that many other modules need.

### Symbols to move:

**Private (non-exported, become module-public for internal use):**
- `RESERVED_PROVIDER_SETTING_KEYS` (const, line 735) — Set of provider config keys from core
- `resolveActiveProviderName` (function, lines 737-752, 16 lines) — resolves active provider from config or settings
- `getProviderSettingsSnapshot` (function, lines 754-759, 6 lines) — wrapper for settingsService.getProviderSettings
- `extractModelParams` (function, lines 761-776, 16 lines) — extracts model params excluding reserved keys
- `getProviderManagerOrThrow` (function, lines 787-791, 5 lines) — gets provider manager with stateless checks
- `getActiveProviderOrThrow` (function, lines 793-803, ~11 lines) — gets active provider or throws descriptive error

**Exported:**
- `CliRuntimeServices` (interface, line 403)
- `getCliRuntimeContext` (function, line 428)
- `getCliRuntimeServices` (function, line 492)
- `getCliProviderManager` (function, line 530)
- `isCliRuntimeStatelessReady` (function, line 571)
- `ensureStatelessProviderReady` (function, line 600)
- `getCliOAuthManager` (function, line 730)
- `getCliRuntimeConfig` (function, line 782)
- `getActiveModelName` (function, line 804)
- `getActiveProviderStatus` (function, line 831)
- `listAvailableModels` (function, line 882)
- `getActiveProviderMetrics` (function, line 889)
- `getSessionTokenUsage` (function, line 896)
- `getEphemeralSettings` (function, line 908)
- `getEphemeralSetting` (function, line 913)
- `setEphemeralSetting` (function, line 918)
- `clearEphemeralSetting` (function, line 923)
- `getActiveModelParams` (function, line 928)
- `setActiveModelParam` (function, line 941)
- `clearActiveModelParam` (function, line 950)
- `listProviders` (function, line 1423)
- `getActiveProviderName` (function, line 1427)
- `ProviderRuntimeStatus` (interface, line 1521)

### Dependencies:
- `runtimeRegistry.ts` — `resolveActiveRuntimeIdentity`, `requireRuntimeEntry`, `runtimeRegistry`
- `statelessHardening.ts` — `isCliStatelessProviderModeEnabled`
- `runtimeContextFactory.ts` — `getCurrentRuntimeScope`
- `@vybestack/llxprt-code-core` — `Config`, `ProviderRuntimeContext`, `SettingsService`, etc.
- `../auth/oauth-manager.js` — `OAuthManager`
- `./messages.js` — formatting helpers

### Test-first approach:

1. **RED**: Create `runtimeAccessors.spec.ts`. Test behavioral contracts:
   - `getCliRuntimeServices` throws descriptive error when no runtime is registered
   - `getActiveProviderName` returns the name from the active provider
   - `getEphemeralSetting`/`setEphemeralSetting` round-trips a value
   - `getActiveModelParams`/`setActiveModelParam`/`clearActiveModelParam` round-trip
   - All imports come from `./runtimeAccessors.js` → tests fail.

2. **GREEN**: Create `runtimeAccessors.ts` with moved code. Run tests → pass.

3. **Update coordinator**: Replace moved code in `runtimeSettings.ts` with imports from `./runtimeAccessors.js` and re-export all public symbols.

4. **Verify**: All existing tests pass — `profileApplication.ts` and other consumers still import from `runtimeSettings.js` which re-exports these symbols.

### Function size check:
All functions in this module are already under 80 lines:
- `getCliRuntimeContext`: ~64 lines [OK]
- `getCliRuntimeServices`: ~38 lines [OK]
- `getCliProviderManager`: ~41 lines [OK]
- `ensureStatelessProviderReady`: ~48 lines [OK]
- `getCliOAuthManager`: ~52 lines [OK]
- `getActiveProviderStatus`: ~51 lines [OK]
- All others: <30 lines [OK]

---

## Step 2.2: Extract `runtimeLifecycle.ts`

This module handles setting up and tearing down runtime contexts — the write-side of context management.

### Symbols to move:

**Exported:**
- `setCliRuntimeContext` (function, lines 1435-1468, 34 lines) — **NO DECOMPOSITION NEEDED**
- `registerCliProviderInfrastructure` (function, line 675)
- `resetCliProviderInfrastructure` (function, line 703)
- `activateIsolatedRuntimeContext` (function, line 648)

### Dependencies:
- `runtimeRegistry.ts` — `upsertRuntimeEntry`, `requireRuntimeEntry`, `resolveActiveRuntimeIdentity`, `disposeCliRuntime`, `LEGACY_RUNTIME_ID`
- `runtimeAccessors.ts` — `getCliRuntimeServices`, `getCliOAuthManager`
- `runtimeContextFactory.ts` — `registerIsolatedRuntimeBindings`
- `@vybestack/llxprt-code-core` — `Config`, `ProviderManager`, `SettingsService`, `MessageBus`, etc.
- `../auth/oauth-manager.js` — `OAuthManager`
- `../providers/providerManagerInstance.js` — `registerProviderManagerSingleton`, `resetProviderManager`
- `../providers/oauth-provider-registration.js` — `ensureOAuthProviderRegistered`

### Test-first approach:

1. **RED**: Create `runtimeLifecycle.spec.ts`. Test behavioral contracts:
   - **Runtime context registration**:
     - `setCliRuntimeContext(mockSettingsService, mockConfig)` creates a runtime entry that `getCliRuntimeServices()` can retrieve
     - Runtime entry includes settingsService, config, and generated runtimeId (format: `cli-runtime-{pid_hex}`)
     - Calling `setCliRuntimeContext` twice with different runtimeId creates separate entries (no overwrites unless same ID)
   - **Provider infrastructure lifecycle**:
     - `registerCliProviderInfrastructure(mockProviderManager, runtimeId)` updates the runtime entry with providerManager
     - After registration, `getCliProviderManager()` returns the registered provider manager
     - `resetCliProviderInfrastructure(runtimeId)` calls `resetProviderManager()` and clears the runtime entry's providerManager
   - **Isolated runtime activation**:
     - `activateIsolatedRuntimeContext({ ... })` creates a scoped runtime with automatic cleanup
     - Verify runtime context is set during activation and cleared on disposal
   - All imports from `./runtimeLifecycle.js` → tests fail.

2. **GREEN**: Create `runtimeLifecycle.ts` with moved code. Run tests → pass.

3. **Update coordinator**: Replace moved code in `runtimeSettings.ts` with imports and re-exports. Note: `setCliRuntimeContext` is only 34 lines and does NOT need decomposition.

4. **Critical: Top-level `registerIsolatedRuntimeBindings` call**: Lines 1470-1478 in `runtimeSettings.ts` contain a top-level call to `registerIsolatedRuntimeBindings(...)` that wires runtime lifecycle callbacks:
   ```typescript
   registerIsolatedRuntimeBindings({
     resetInfrastructure: resetCliProviderInfrastructure,
     setRuntimeContext: setCliRuntimeContext,
     registerInfrastructure: registerCliProviderInfrastructure,
     linkProviderManager: (config, manager) => {
       config.setProviderManager(manager);
     },
     disposeRuntime: disposeCliRuntime,
   });
   ```
   This call MUST remain in the coordinator (`runtimeSettings.ts`) after Phase 3 is complete. It cannot move to `runtimeLifecycle.ts` because it references functions that will be distributed across multiple modules (and creating a circular import). The coordinator is the correct place for this module-load-time initialization since it imports from all lifecycle modules.

5. **Verify**: Run full test suite.

---

## Phase 2 Completion Checklist

- [ ] `runtimeAccessors.ts` created with all state-query symbols
- [ ] `runtimeAccessors.spec.ts` tests pass
- [ ] `runtimeLifecycle.ts` created with context setup/teardown symbols
- [ ] `runtimeLifecycle.spec.ts` tests pass
- [ ] `runtimeSettings.ts` imports and re-exports from both new modules
- [ ] Top-level `registerIsolatedRuntimeBindings` call preserved and functional
- [ ] All existing importers still work
- [ ] Full verification: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
- [ ] Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
