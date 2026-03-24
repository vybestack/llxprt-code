# Phase 1: Extract Leaf Modules

Extract `statelessHardening.ts` and `runtimeRegistry.ts` — these have no internal dependencies on other new modules, making them safe starting points.

## Step 1.1: Extract `statelessHardening.ts`

### Symbols to move (verbatim from `runtimeSettings.ts`):

**Private (non-exported):**
- `STATELESS_METADATA_KEYS` (const, line 130)
- `statelessHardeningPreferenceOverride` (let, line 139)
- `normalizeStatelessPreference` (function, line 142)
- `readStatelessPreferenceFromMetadata` (function, line 170)
- `resolveStatelessHardeningPreference` (function, line 192)
- `isStatelessProviderIntegrationEnabled` (function, line 242)

**Exported:**
- `StatelessHardeningPreference` (type, line 137)
- `configureCliStatelessHardening` (function, line 219)
- `getCliStatelessHardeningOverride` (function, line 229)
- `getCliStatelessHardeningPreference` (function, line 238)
- `isCliStatelessProviderModeEnabled` (function, line 246)

### Dependencies this module needs:
- `runtimeRegistry.ts` — for `resolveActiveRuntimeIdentity`, `runtimeRegistry` (used by `resolveStatelessHardeningPreference`)
- `runtimeContextFactory.ts` — for `getCurrentRuntimeScope` (already a separate module)

### Test-first approach:

1. **RED**: Create `statelessHardening.spec.ts` that imports from `./statelessHardening.js`. Write characterization tests for behavioral contracts:
   - **Preference normalization**: Test `normalizeStatelessPreference` behavior (boolean/string/invalid inputs)
     - `true`, `'strict'`, `'enabled'`, `'true'`, `'on'` all normalize to `'strict'`
     - `false`, `'legacy'`, `'disabled'`, `'false'`, `'off'` all normalize to `'legacy'`
     - Invalid inputs (numbers, null, undefined, unknown strings) return `null`
   - **Override behavior**: 
     - `configureCliStatelessHardening('strict')` then `getCliStatelessHardeningPreference()` returns `'strict'`
     - `configureCliStatelessHardening('legacy')` then `isCliStatelessProviderModeEnabled()` returns `false`
     - `configureCliStatelessHardening('strict')` then `isCliStatelessProviderModeEnabled()` returns `true`
     - `configureCliStatelessHardening(null)` then `getCliStatelessHardeningOverride()` returns `null`
   - **Default behavior**: 
     - Default preference (no override, no metadata, no scope, no runtime entry) resolves to `'strict'`
   - **Metadata precedence**: Test that metadata keys (`statelessHardening`, `statelessProviderMode`, `statelessGuards`, `statelessMode`) are checked in order
   - Use `afterEach` to reset state: `configureCliStatelessHardening(null)` and `resetCliRuntimeRegistryForTesting()`
   - Run tests -> they fail because `./statelessHardening.js` doesn't exist.

2. **GREEN**: Create `statelessHardening.ts` with the moved code. Run tests -> they pass.

3. **Update coordinator**: In `runtimeSettings.ts`, replace the moved code with import + re-export statements. The coordinator must re-export exactly these public symbols: `StatelessHardeningPreference` (type), `configureCliStatelessHardening`, `getCliStatelessHardeningOverride`, `getCliStatelessHardeningPreference`, `isCliStatelessProviderModeEnabled`.

4. **Export parity check**: Run the export diff check per plan.md cross-cutting rules.

5. **Verify**: Run full test suite -- all 20 importers still work through re-exports.

### Note on the stateless hardening cluster (lines 130-246):
This cluster spans ~117 lines total and includes multiple private helpers (`normalizeStatelessPreference`, `readStatelessPreferenceFromMetadata`, `resolveStatelessHardeningPreference`, `isStatelessProviderIntegrationEnabled`) plus exports (`configureCliStatelessHardening`, `getCliStatelessHardeningOverride`, `getCliStatelessHardeningPreference`, `isCliStatelessProviderModeEnabled`). Each individual function is well under 80 lines. No function decomposition is needed — the extraction itself satisfies both file-size and function-size constraints.

---

## Step 1.2: Extract `runtimeRegistry.ts`

### Symbols to move (verbatim from `runtimeSettings.ts`):

**Private (non-exported):**
- `RuntimeRegistryEntry` (interface, line 256)
- `runtimeRegistry` (const Map, line 266)
- `LEGACY_RUNTIME_ID` (const, line 267)
- `resolveActiveRuntimeIdentity` (function, line 269)
- `upsertRuntimeEntry` (function, line 305)
- `requireRuntimeEntry` (function, line 349)
- `disposeCliRuntime` (function, line 376)

**Exported:**
- `resetCliRuntimeRegistryForTesting` (function, line 397)

### Dependencies this module needs:
- `@vybestack/llxprt-code-core` — for `Config`, `SettingsService`, `ProviderManager`, `DebugLogger`, `MessageBus`, `clearActiveProviderRuntimeContext`
- `runtimeContextFactory.ts` — for `getCurrentRuntimeScope`, `enterRuntimeScope`

### Symbols that become module-public (not file-private):
`RuntimeRegistryEntry`, `runtimeRegistry`, `resolveActiveRuntimeIdentity`, `upsertRuntimeEntry`, `requireRuntimeEntry`, `disposeCliRuntime`, and `LEGACY_RUNTIME_ID` are currently file-private in `runtimeSettings.ts` but are called by other code within that file. After extraction, they must be **exported from `runtimeRegistry.ts`** so other new modules (`runtimeAccessors.ts`, `runtimeLifecycle.ts`, `statelessHardening.ts`) can import them. They remain NOT re-exported from the coordinator since they were never part of the public API.

### Test-first approach:

1. **RED**: Create `runtimeRegistry.spec.ts` importing from `./runtimeRegistry.js`. Write characterization tests for the entry lifecycle:
   - **Baseline state**: After `resetCliRuntimeRegistryForTesting()`, `resolveActiveRuntimeIdentity` returns `{ runtimeId: 'legacy-singleton', metadata: {} }`
   - **Entry creation**: `upsertRuntimeEntry('test-1', { config: mockConfig })` creates an entry; `requireRuntimeEntry('test-1')` returns it with matching runtimeId and config
   - **Entry update**: `upsertRuntimeEntry` with same runtimeId updates (not duplicates) the entry. Verify second upsert merges metadata: `{ a: 1 }` + `{ b: 2 }` = `{ a: 1, b: 2 }`
   - **Entry update partial fields**: `upsertRuntimeEntry('test-1', { settingsService })` preserves existing config/providerManager from previous upsert
   - **Missing entry error**: `requireRuntimeEntry('nonexistent')` throws error with message containing "runtime registration" and "Ensure setCliRuntimeContext() was called"
   - **Disposal**: `disposeCliRuntime('test-1')` removes the entry; subsequent `requireRuntimeEntry('test-1')` throws
   - **Disposal clears active context**: If active context runtimeId matches disposed runtimeId, verify active context is cleared via `peekActiveProviderRuntimeContext()` returning null
   - Use `afterEach` to call `resetCliRuntimeRegistryForTesting()` for test isolation
   - Run tests -> fail because module doesn't exist.

2. **GREEN**: Create `runtimeRegistry.ts` with moved code. Exports: all previously-private symbols that other modules need, plus `resetCliRuntimeRegistryForTesting`. Run tests -> pass.

3. **Update coordinator**: Replace moved code in `runtimeSettings.ts` with imports from `./runtimeRegistry.js`. Re-export only `resetCliRuntimeRegistryForTesting` (the only symbol that was publicly exported). Internal symbols (`RuntimeRegistryEntry`, `runtimeRegistry`, `resolveActiveRuntimeIdentity`, etc.) are NOT re-exported -- they were never part of the public API.

4. **Update `statelessHardening.ts`**: Change its internal references to import `resolveActiveRuntimeIdentity` and `runtimeRegistry` from `./runtimeRegistry.js` instead of relying on file-local access.

5. **Export parity check**: Run the export diff check per plan.md cross-cutting rules.

6. **Verify**: Run full test suite.

---

## Phase 1 Completion Checklist

- [ ] `statelessHardening.ts` created with all stateless hardening symbols
- [ ] `statelessHardening.spec.ts` tests pass
- [ ] `runtimeRegistry.ts` created with all registry symbols
- [ ] `runtimeRegistry.spec.ts` tests pass
- [ ] `runtimeSettings.ts` imports and re-exports from both new modules
- [ ] All 20 existing importers still work (no import path changes)
- [ ] Full verification: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
- [ ] Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`
