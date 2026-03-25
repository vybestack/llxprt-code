# Phase 3: Extract Top-Layer Modules

Extract `providerSwitch.ts`, `providerMutations.ts`, `settingsResolver.ts`, and `profileSnapshot.ts`. These depend on Phase 1–2 modules and contain the largest, most complex functions.

## Step 3.1: Extract `providerMutations.ts`

Model, API key, base URL, and tool format mutations. Extracted before `providerSwitch.ts` because provider switching calls `computeModelDefaults` from here.

### Symbols to move:

**Private (become module-public):**
- `computeModelDefaults` (function, line 114) — pure function, used by both `switchActiveProvider` and `setActiveModel`
- `normalizeProviderBaseUrl` (function, line 1537) — NOTE: also used by `switchActiveProvider`, so must be exported from this module for `providerSwitch.ts` to import
- `extractProviderBaseUrl` (function, line 1548) — same as above

**Exported:**
- `ModelChangeResult` (interface, line 2136)
- `ApiKeyUpdateResult` (interface, line 1488)
- `BaseUrlUpdateResult` (interface, line 1495)
- `ToolFormatState` (interface, line 1502)
- `ToolFormatOverrideLiteral` (type, line 1509)
- `updateActiveProviderApiKey` (function, line 2143)
- `updateActiveProviderBaseUrl` (function, line 2206)
- `getActiveToolFormatState` (function, line 2241)
- `setActiveToolFormatOverride` (function, line 2268)
- `setActiveModel` (function, line 2293) — **85 lines, MUST be decomposed**

### Dependencies:
- `runtimeAccessors.ts` — `getCliRuntimeServices`, `getActiveModelName`, `getActiveProviderName`, `getEphemeralSettings`, `setEphemeralSetting`
- `@vybestack/llxprt-code-core` — `Config`, `SettingsService`, etc.
- `../providers/providerAliases.js` — `loadProviderAliasEntries`, `ModelDefaultRule`

### Test-first approach:

**Scope Addition #2: Unit tests for pure functions**

Add real behavioral tests for these currently untested pure functions:

1. **RED**: Create `providerMutations.spec.ts`. Write tests importing from `./providerMutations.js`:

   **For `computeModelDefaults` (lines 114-128):**
   - Returns empty object when no rules match model name
   - Case-insensitive regex matching: model "gpt-4o" matches rule pattern `/gpt-4/i`
   - Later rules override earlier for same key: rules `[{pattern:/gpt/i, defaults:{temp:0.5}}, {pattern:/gpt-4/i, defaults:{temp:0.7}}]` applied to "gpt-4o" returns `{temp:0.7}`
   - Multiple rules can contribute different keys: rule1 `{pattern:/gpt/i, defaults:{temp:0.5}}`, rule2 `{pattern:/4o/i, defaults:{top_p:0.9}}` applied to "gpt-4o" returns `{temp:0.5, top_p:0.9}`
   
   **For `normalizeProviderBaseUrl` (lines 1537-1546):**
   - Strips trailing slash: `https://api.openai.com/` -> `https://api.openai.com`
   - Passes through already-normalized URLs unchanged
   - Handles URLs with paths: `https://api.example.com/v1/` -> `https://api.example.com/v1`
   
   **For `extractProviderBaseUrl` (lines 1548-1639):**
   - Returns URL from alias config when present
   - Returns URL from settings service when no alias
   - Falls back to undefined when neither has URL
   
   **For `setActiveModel` behavioral contract:**
   - Updates config model to new name
   - Computes and applies model defaults difference when alias config has modelDefaults
   - Preserves user-set values that differ from old defaults
   - Clears ephemeral settings that were defaulted by old model but not applicable to new
   - Returns correct `ModelChangeResult` with provider name, previous/next model

   Run tests -> fail (module doesn't exist).

2. **GREEN**: Create `providerMutations.ts` with moved code. Run tests -> pass.

3. **Decompose `setActiveModel`** (85 lines -> helpers <80 lines):
   Extract private helper:
   - `recomputeAndApplyModelDefaultsDiff(config, previousModel, newModel, aliasEntries)` -- handles the model-defaults diff logic (compute old defaults, compute new defaults, clear stale, apply new)
   Keep `setActiveModel` as a short coordinator.

4. **Update coordinator**: Replace moved code, add re-exports.

5. **Verify**: Run full test suite.

---

## Step 3.2: Extract `providerSwitch.ts`

The single largest function in the file at ~490 lines. This is the most complex extraction.

### Symbols to move:

**Private:**
- `DEFAULT_PRESERVE_EPHEMERALS` (const, line 1647)

**Exported:**
- `ProviderSwitchResult` (interface, line 1480)
- `switchActiveProvider` (function, line 1653) -- **482 lines, MUST be decomposed**

### Dependencies:
- `runtimeAccessors.ts` -- `getCliRuntimeServices`, `getActiveProviderName`, `getEphemeralSettings`, `setEphemeralSetting`, `clearEphemeralSetting`, `setActiveModelParam`, `clearActiveModelParam`
- `providerMutations.ts` -- `computeModelDefaults`, `normalizeProviderBaseUrl`, `extractProviderBaseUrl`, `updateActiveProviderApiKey`
- `@vybestack/llxprt-code-core` -- `resolveAlias`, `getProviderConfigKeys`, `Config`, etc.
- `../providers/providerAliases.js` -- `loadProviderAliasEntries`, `ProviderAliasConfig`
- `../providers/oauth-provider-registration.js` -- `ensureOAuthProviderRegistered`
- `../auth/oauth-manager.js` -- `OAuthManager`

### Test-first approach:

1. **RED**: Create `providerSwitch.spec.ts`. Test behavioral contracts:
   - `switchActiveProvider` to the same provider returns `{ changed: false }`
   - `switchActiveProvider` with empty string throws
   - `DEFAULT_PRESERVE_EPHEMERALS` includes expected keys (`context-limit`, `max_tokens`, `streaming`)
   - Imports from `./providerSwitch.js` -> tests fail.

2. **GREEN**: Create `providerSwitch.ts` with moved code. Run tests -> pass.

3. **Decompose `switchActiveProvider`** (482 lines -> coordinator + 7 helpers, each <80 lines):

   Extract private helpers within `providerSwitch.ts`:

   a. `clearPreviousProviderState(config, settingsService, currentProvider, preserveEphemerals)` -- snapshots previous settings, clears ephemerals except preserved ones, clears model params, clears provider runtime context

   b. `activateNewProviderInServices(providerManager, settingsService, name)` -- calls `activateProvider`, sets active provider in settings service

   c. `resolveAndApplyBaseUrl(config, settingsService, name, aliasConfig)` -- resolves base URL from alias or settings, normalizes, applies to config

   d. `resolveAndApplyModel(config, providerManager, settingsService, name, aliasConfig)` -- resolves model from alias/settings/provider default, sets on config

   e. `handleAnthropicOAuth(config, name, autoOAuth, oauthManager)` -- Anthropic-specific OAuth auto-auth and OAuth defaults logic (Issue #181)

   f. `applyAliasEphemerals(config, name, aliasConfig, protectedKeys, addItem)` -- iterates alias ephemeral settings, skips protected/non-scalar keys, applies to config, emits history items

   g. `applyModelDefaultsForProvider(config, modelName, aliasEntries, skipModelDefaults)` -- calls `computeModelDefaults`, applies results as ephemeral settings

   The coordinator `switchActiveProvider` becomes a ~50-line function calling these in sequence, handling early returns and building the result.

4. **Update coordinator**: Replace moved code, add re-exports.

5. **Verify**: Run full test suite.

---

## Step 3.3: Extract `settingsResolver.ts`

CLI argument resolution into runtime overrides.

### Symbols to move:

**Private:**
- `resolveNamedKey` (async function, line 2515)

**Exported:**
- `applyCliArgumentOverrides` (function, line 2399) -- **105 lines, MUST be decomposed**

### Dependencies:
- `runtimeAccessors.ts` -- `getCliRuntimeServices`
- `providerMutations.ts` -- `updateActiveProviderApiKey`, `updateActiveProviderBaseUrl`
- `../auth/proxy/credential-store-factory.js` -- `createProviderKeyStorage`

### Test-first approach:

1. **RED**: Create `settingsResolver.spec.ts`. Test behavioral contracts:
   - `resolveNamedKey` throws descriptive error when key not found
   - `resolveNamedKey` throws descriptive error on keyring access failure
   - Imports from `./settingsResolver.js` -> tests fail.

2. **GREEN**: Create `settingsResolver.ts` with moved code. Run tests -> pass.

3. **Decompose `applyCliArgumentOverrides`** (105 lines, lines 2399-2503 -> coordinator + helpers <80 lines):
   The function is 105 lines. The API key resolution chain (steps 1-4, lines 2422-2490) is ~68 lines. Extract private helpers:
   - `resolveAndApplyApiKey(config, argv, bootstrapArgs, keyResolved)` -- handles the 4-step key precedence chain (--key, --key-name, profile auth-key-name, --keyfile). Returns updated `keyResolved` boolean.
   After extraction, `applyCliArgumentOverrides` becomes ~50 lines: imports, call key helper, apply --set args (inline, 3 lines), apply --baseurl (inline, 3 lines).

4. **Update coordinator**: Replace moved code, add re-exports.

5. **Verify**: Run full test suite.

---

## Step 3.4: Extract `profileSnapshot.ts`

Profile build/apply/persist/query and diagnostics.

### Symbols to move:

**Private:**
- `SENSITIVE_MODEL_PARAM_KEYS` (const, lines 963-973, Set of 9 sensitive keys including auth-key, apiKey, base-url, etc.)
- `stripSensitiveModelParams` (function, lines 975-984, 10 lines) — strips sensitive keys from model params before snapshot
- `getNestedValue` (function, lines 991-1017, ~27 lines) — dot-notation key path accessor for nested settings

**Exported:**
- `PROFILE_EPHEMERAL_KEYS` (const, line 960)
- `ProfileLoadOptions` (interface, line 1099)
- `ProfileLoadResult` (interface, line 1103)
- `RuntimeDiagnosticsSnapshot` (interface, line 1115)
- `buildRuntimeProfileSnapshot` (function, lines 1019-1097, 79 lines) -- under 80-line limit, NO decomposition needed
- `applyProfileSnapshot` (function, line 1123) -- **~194 lines, MUST be decomposed**
- `saveProfileSnapshot` (function, line 1317)
- `saveLoadBalancerProfile` (function, line 1340)
- `loadProfileByName` (function, line 1348)
- `deleteProfileByName` (function, line 1356)
- `listSavedProfiles` (function, line 1373)
- `getProfileByName` (function, line 1378)
- `getActiveProfileName` (function, line 1383)
- `setDefaultProfileName` (function, line 1391)
- `getRuntimeDiagnosticsSnapshot` (function, line 1396)

### Dependencies:
- `runtimeAccessors.ts` -- `getCliRuntimeServices`, `getCliOAuthManager`, `getActiveModelName`, `getActiveProviderName`, `getEphemeralSettings`, `getActiveModelParams`, `getActiveProviderStatus`, `isCliRuntimeStatelessReady`
- `providerMutations.ts` -- (for `applyProfileSnapshot` calling `updateActiveProviderApiKey` etc. -- but these are called via `profileApplication.ts` which already imports from `runtimeSettings.js`)
- `statelessHardening.ts` -- `isCliStatelessProviderModeEnabled`
- `./profileApplication.js` -- `applyProfileWithGuards`, `getLoadBalancerStats`
- `@vybestack/llxprt-code-core` -- `Profile`, `ProfileManager`, `isLoadBalancerProfile`, etc.

### Important: `profileApplication.ts` dependency (cycle to be broken by Scope Addition #1)

**Current state (before rewiring)**: `profileApplication.ts` imports from `runtimeSettings.js`, and `runtimeSettings.ts` imports from `profileApplication.js` — a circular dependency.

**After Phase 4 (Scope Addition #1 - Consumer Rewiring)**: `profileApplication.ts` will import directly from specific modules (`runtimeAccessors.js`, `statelessHardening.js`, `providerSwitch.js`, `providerMutations.js`, `credential-store-factory.js`). The circular dependency is **BROKEN**.

The dependency chain becomes:
- `profileSnapshot.ts` -> `profileApplication.js` (for `applyProfileWithGuards`) — this is fine, one-directional
- `profileApplication.ts` -> specific runtime modules — no cycle

During Phases 1-3, the cycle temporarily remains (tests still import from coordinator), but Phase 4 Step 4.7 explicitly breaks it by rewiring `profileApplication.ts`.

### Test-first approach:

1. **RED**: The existing `runtimeSettings.spec.ts` and `runtimeSettings.reasoningSummary.test.ts` both test `PROFILE_EPHEMERAL_KEYS`. Create `profileSnapshot.spec.ts` with equivalent tests importing from `./profileSnapshot.js`:
   - **PROFILE_EPHEMERAL_KEYS coverage**:
     - Contains timeout settings: `'task-default-timeout-seconds'`, `'task-max-timeout-seconds'`, `'shell-default-timeout-seconds'`, `'shell-max-timeout-seconds'`
     - Contains reasoning keys: `'reasoning.enabled'`, `'reasoning.budgetTokens'`, `'reasoning.stripFromContext'`, `'reasoning.includeInContext'`
     - Contains auth/provider keys: `'auth-key'`, `'auth-key-name'`, `'auth-keyfile'`, `'base-url'`, `'GOOGLE_CLOUD_PROJECT'`, `'GOOGLE_CLOUD_LOCATION'`
   - **Profile snapshot building**:
     - `buildRuntimeProfileSnapshot()` collects all keys in `PROFILE_EPHEMERAL_KEYS` from config ephemeral settings
     - Model params are collected but sensitive keys (`auth-key`, `apiKey`, `base-url`, etc.) are stripped via `stripSensitiveModelParams`
     - Result includes `{ provider, model, ephemeralSettings, modelParams }`
   - **Profile snapshot application**:
     - `applyProfileSnapshot(profile)` applies provider, model, ephemeral settings, and model params
     - Calls `applyProfileWithGuards` from `profileApplication.js` (circular dependency – OK since in function body)
     - Returns `ProfileLoadResult` with `{ providerName, modelName, infoMessages, warnings, providerChanged, didFallback, requestedProvider, baseUrl? }`
   - **Diagnostics snapshot**:
     - `getRuntimeDiagnosticsSnapshot()` returns current runtime state: `{ providerName, modelName, profileName, modelParams, ephemeralSettings }`
   - Tests fail because module doesn't exist.

2. **GREEN**: Create `profileSnapshot.ts` with moved code. Run tests -> pass.

3. **NO DECOMPOSITION NEEDED for `buildRuntimeProfileSnapshot`**: This function is only 79 lines (lines 1019-1097), already under the 80-line limit. Move it as-is.

4. **Decompose `applyProfileSnapshot`** (193 lines -> helpers <80 lines):
   Extract private helpers:
   - `applyStandardProfileSettings(profile, config, services, oauthManager)` -- handles non-LB profile application
   - `wireProactiveOAuthFailover(profile, oauthManager)` -- proactive wiring logic (Issues #1151, #1250, #1467)
   - `buildProfileLoadResult(appResult, profile, profileName)` -- constructs the return value

5. **Update coordinator**: Replace moved code, add re-exports. The existing tests in `runtimeSettings.spec.ts` and `runtimeSettings.reasoningSummary.test.ts` continue to work through re-exports.

6. **Verify**: Run full test suite including proactive wiring specs.

---

## Phase 3 Completion Checklist

- [ ] `providerMutations.ts` created; `setActiveModel` decomposed; spec passes
- [ ] `providerSwitch.ts` created; `switchActiveProvider` decomposed into 6+ helpers; spec passes
- [ ] `settingsResolver.ts` created; `applyCliArgumentOverrides` decomposed; spec passes
- [ ] `profileSnapshot.ts` created; `applyProfileSnapshot` decomposed; `buildRuntimeProfileSnapshot` moved as-is (79 lines, under limit); spec passes
- [ ] `runtimeSettings.ts` imports and re-exports from all four new modules
- [ ] All existing importers still work (no import path changes)
- [ ] No function in any new module exceeds 80 lines
- [ ] No new module exceeds 800 lines
- [ ] Full verification: `npm run test && npm run lint && npm run typecheck && npm run format && npm run build`
- [ ] Smoke test: `node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"`