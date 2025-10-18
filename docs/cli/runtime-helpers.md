# CLI Runtime Helper APIs

LLxprt Code exposes a runtime helper bundle in `packages/cli/src/runtime/runtimeSettings.ts`. The helpers give commands, React hooks, tests, and automation a stable way to manipulate provider configuration without importing global singletons.

## Accessing the active runtime

```ts
import {
  getCliRuntimeContext,
  getCliRuntimeServices,
  setCliRuntimeContext,
  resetCliProviderInfrastructure,
} from '../runtime/runtimeSettings.js';
```

| Helper                                                     | Description                                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `setCliRuntimeContext(settingsService, config?, options?)` | Registers the runtime context that backs CLI commands. Bootstrap calls this during startup and can refresh it when rehydrating settings. |
| `getCliRuntimeContext()`                                   | Returns the active `ProviderRuntimeContext`. Throws if the runtime is not initialised.                                                   |
| `getCliRuntimeServices()`                                  | Returns `{ settingsService, config, providerManager }` so UI hooks can interact with them safely.                                        |
| `resetCliProviderInfrastructure()`                         | Clears cached managers – useful in tests to ensure a fresh bootstrap.                                                                    |

## Provider transitions

| Helper                       | Purpose                                                                                                                              |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `switchActiveProvider(name)` | Implements `/provider`. Updates the scoped `SettingsService`, reconfigures the `ProviderManager`, and refreshes auth when necessary. |
| `getActiveProviderName()`    | Returns the provider selected for the current runtime.                                                                               |
| `listProviders()`            | Enumerates registered providers for UI pickers.                                                                                      |
| `getActiveProviderStatus()`  | Supplies status components with provider, auth type, and model information.                                                          |

## Credentials & endpoints

| Helper                              | Purpose                                                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `updateActiveProviderApiKey(value)` | Backs `/key` and `/keyfile`. Stores the secret on the runtime `SettingsService` and refreshes authentication. |
| `updateActiveProviderBaseUrl(url)`  | Backs `/baseurl`. Persists overrides and clears them when called with `null` or `'none'`.                     |
| `getActiveToolFormatState()`        | Reports the effective tool format and overrides for diagnostics.                                              |

## Models and parameters

| Helper                            | Purpose                                                                  |
| --------------------------------- | ------------------------------------------------------------------------ |
| `setActiveModel(name)`            | Applies `/model` selections, updating `Config` and the runtime snapshot. |
| `getActiveModelName()`            | Reads the current model resolved for the runtime.                        |
| `setActiveModelParam(key, value)` | Updates model parameters for the active provider.                        |
| `clearActiveModelParam(key)`      | Removes a parameter override.                                            |
| `getActiveModelParams()`          | Returns the current parameter map for inspection or debugging.           |

## Profiles and persistence

| Helper                          | Purpose                                                                  |
| ------------------------------- | ------------------------------------------------------------------------ |
| `buildRuntimeProfileSnapshot()` | Captures the runtime state saved into profiles.                          |
| `saveProfileSnapshot(name)`     | Persists the snapshot through `ProfileManager`.                          |
| `loadProfileByName(name)`       | Applies stored profiles to the active runtime (used by `/profile load`). |
| `deleteProfileByName(name)`     | Removes a stored profile and clears runtime references.                  |
| `listSavedProfiles()`           | Enumerates available profiles.                                           |
| `getActiveProfileName()`        | Returns the profile currently associated with the runtime.               |
| `setDefaultProfileName(name)`   | Defines the profile that loads automatically on startup.                 |

## Diagnostics & utilities

| Helper                            | Purpose                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `getRuntimeDiagnosticsSnapshot()` | Captures provider, model, and ephemeral settings for `/diagnostics`.                      |
| `getCliProviderManager(options?)` | Returns the provider manager, optionally wiring history callbacks for transcript logging. |
| `getCliOAuthManager()`            | Exposes the OAuth manager that was registered with the runtime, or `null` if none exists. |

## Nested contexts

Automation flows and `/subagent` runs can create isolated contexts while reusing the same helpers:

```ts
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  clearActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core';
import {
  getCliRuntimeContext,
  switchActiveProvider,
} from '../runtime/runtimeSettings.js';

export async function runSubagentJob(metadata: Record<string, unknown>) {
  const parent = getCliRuntimeContext();
  const runtime = createProviderRuntimeContext({
    config: parent.config,
    metadata,
  });
  setActiveProviderRuntimeContext(runtime);
  try {
    if (metadata.provider) {
      await switchActiveProvider(String(metadata.provider));
    }
    // Execute task-specific logic here
  } finally {
    clearActiveProviderRuntimeContext();
    setActiveProviderRuntimeContext(parent);
  }
}
```

The helpers always operate on the active context, ensuring nested runs can adjust provider credentials or model parameters without disturbing the caller.
