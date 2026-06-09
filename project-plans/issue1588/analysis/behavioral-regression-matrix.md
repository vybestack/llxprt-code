# Behavioral Regression Matrix

Plan ID: PLAN-20260608-ISSUE1588

## Purpose

This extraction is behavior-preserving. Tests must prove settings/profile/storage behavior and consumer integration still work through real code paths after moving packages. Tests that only prove files import or mocks were called are insufficient.

## Required Behavioral Expectations

### BVE-01: SettingsService Global And Provider Settings

**Observable Behavior:** Setting and retrieving global and provider-specific values works exactly as before.

**Scenarios:**

- Set a global key with `set`, then read it with `get`.
- Set provider-specific values with `setProviderSetting`, then read them with `getProviderSettings` and `getSettings`.
- `updateSettings` merges provider values without erasing unrelated provider settings.
- `switchProvider` updates active provider behavior.
- `clear` resets state.

**Tests:** Move existing SettingsService tests if present or add behavioral tests in `packages/settings`.

### BVE-02: Settings Changed Events

**Observable Behavior:** `onSettingsChanged` subscribers receive events with correct key/value/provider information when settings change.

**Anti-mock rule:** Do not only assert a spy was called; assert event payload values.

**Explicit event behavior tests required:**

- **BVE-02a: `'change'` event from `set`**: When `set(key, value)` is called, a `'change'` event is emitted with the correct key and value in the payload. Test must assert the event name is exactly `'change'`, not just that some event fired.
- **BVE-02b: `'provider-change'` event from `setProviderSetting`**: When `setProviderSetting(provider, key, value)` is called, a `'provider-change'` event is emitted with provider, key, and value details. Test must assert the event name is exactly `'provider-change'`.
- **BVE-02c: `'cleared'` event from `clear`**: When `clear()` is called, a `'cleared'` event is emitted. Test must assert the event name is exactly `'cleared'`.
- **BVE-02d: `onSettingsChanged` / `'settings_changed'` behavior**: If `SettingsService` exposes `onSettingsChanged` method or emits `'settings_changed'` events, test must verify: (1) whether `onSettingsChanged` subscribes to `'settings_changed'` events specifically or is an alias for the general `'change'` event, (2) what payload shape is delivered, (3) whether `'settings_changed'` is a separate event from `'change'` or an alias. If `'settings_changed'` is not actually emitted in current implementation, the test must document this fact rather than assuming it exists.

### BVE-03: Registry Validation And Metadata

**Observable Behavior:** Registry functions preserve current validation, parsing, alias, completion, protected key, and provider config key behavior.

**Scenarios:**

- Valid setting values parse/normalize to expected values.
- Invalid values return errors matching current behavior.
- Aliases resolve to existing canonical keys.
- `compression.strategy` accepts the same four current strategy values without importing core compression.
- Protected settings remain protected.

### BVE-04: Profile Persistence

**Observable Behavior:** Profile files under `~/.llxprt/profiles` save, load, list, delete, and existence-check correctly for standard and load balancer profiles.

**Scenarios:**

- `saveProfile` writes a standard profile with provider/model/modelParams/ephemeralSettings.
- `saveLoadBalancerProfile` writes a load balancer profile.
- `loadProfile` returns the exact persisted data.
- `save` exports current `SettingsService` state into profile format.
- `load` imports profile data into `SettingsService`.
- Missing profiles return the current error/undefined behavior.

### BVE-05: Storage Paths

**Observable Behavior:** Every moved `Storage` path helper returns the same path as before, especially global LLxprt paths and project temp paths.

**Method-by-method Storage ownership classification**: Each Storage method falls into a category that justifies whether it belongs in settings or would be better in a future `packages/storage`. Since no `packages/storage` exists, all Storage methods move to settings temporarily with an explicit internal storage seam marker for future extraction.

| Method/Property | Category | Justification for Temporary Settings Ownership |
|---|---|---|
| `Storage.getGlobalLlxprtDir()` | Settings/profile persistence | Core global settings path, directly tied to settings storage |
| `Storage.getUserPoliciesDir()` | Policy storage | Policy config paths are settings-adjacent; future extraction candidate |
| `Storage.getSystemPoliciesDir()` | Policy storage | Same as getUserPoliciesDir |
| `Storage.getUserSkillsDir()` | Skills/commands storage | Skills paths are settings-adjacent; future extraction candidate |
| `Storage.getMcpOAuthTokensPath()` | MCP auth storage | Auth token paths are settings-adjacent; future extraction candidate |
| `Storage.getInstallationIdPath()` | General app storage | Installation ID is app-level, not settings-specific; future extraction candidate |
| `Storage.getProviderAccountsPath()` | Settings/profile persistence | Provider account paths directly related to settings |
| `Storage.getHomeDir()` | General app storage | Home dir resolution is generic; future extraction candidate |
| `History/project/temp/checkpoint path helpers | Session/history storage | Project paths for session history; future extraction candidate |
| `LLXPRT_DIR` constant | Settings/profile persistence | Core constant `.llxprt`, moves with Storage |
| `Storage.LLXPRT_DIR` (static) | Settings/profile persistence | Same as LLXPRT_DIR |

All non-settings methods have the `@storage-seam` marker and are documented as future extraction candidates. Behavioral tests must cover **every** moved Storage helper, not just global/settings paths.

**Scenarios:**

- Global config/settings/accounts paths remain under `~/.llxprt`.
- User policies directory: `Storage.getUserPoliciesDir()` returns correct path.
- System policies directory: `Storage.getSystemPoliciesDir()` returns correct path.
- User skills directory: `Storage.getUserSkillsDir()` returns correct path.
- MCP OAuth tokens path: `Storage.getMcpOAuthTokensPath()` returns correct path.
- Installation ID path: `Storage.getInstallationIdPath()` returns correct path.
- Provider accounts path: `Storage.getProviderAccountsPath()` returns correct path.
- History/temp/checkpoint/project paths preserve current naming.
- `Storage.LLXPRT_DIR` equals `'.llxprt'` (same literal as core's `LLXPRT_CONFIG_DIR` in `memoryTool.ts`).
- Test proves identical path resolution without settings importing core/tools: `Storage.getGlobalLlxprtDir()` returns `path.join(os.homedir(), '.llxprt')` using settings-owned constant only.
- Core `configBaseCore.getLlxprtDir()` returns `path.join(targetDir, '.llxprt')` using core-local constant (no import from tools or settings).
- Dedicated cross-package consistency test proves `LLXPRT_DIR === '.llxprt'` in both packages without importing from each other.

### BVE-06: Runtime Context Settings Isolation

**Observable Behavior:** Runtime contexts that set different `SettingsService` instances do not leak global settings to each other.

**Scenario:**

1. Create settings A and settings B.
2. Activate context A and set a key.
3. Activate context B and set a different key.
4. Reads through `getSettingsService` return the active context's settings, not a stale singleton.
5. Clearing context resets access/error behavior as before.

### BVE-06a: Register-Before-Context Semantics

**Observable Behavior:** Calling `registerSettingsService(s)` when no `ProviderRuntimeContext` exists stores the service in settings-package state without creating a core `ProviderRuntimeContext`. Subsequent `getSettingsService()` returns `s`.

**Scenarios:**

1. No runtime context exists. Call `registerSettingsService(s1)`. Call `getSettingsService()`. Returns `s1`.
2. Runtime context is subsequently activated with `s2`. Call `getSettingsService()`. Returns `s2` (context overrides previously registered singleton).
3. Runtime context is cleared. Call `getSettingsService()`. Behavior matches cleared-state semantics (throw or undefined per settings package contract).

### BVE-06b: Context Activation Updates Settings

**Observable Behavior:** Core activating a provider runtime context updates the active settings service returned by `getSettingsService()` from the settings package.

**Scenarios:**

1. `registerSettingsService(s1)` called first. `getSettingsService()` returns `s1`.
2. Core creates and activates `ProviderRuntimeContext` with `settingsService = s2`. Settings package `getSettingsService()` returns `s2`.
3. Core clears the runtime context. `getSettingsService()` reflects cleared state.

### BVE-06c: Core-Owned Context Creation Adapter

**Observable Behavior:** `activateSettingsRuntimeContext(s)` creates a `ProviderRuntimeContext` and calls `registerSettingsService(s)` from the settings package. `deactivateSettingsRuntimeContext()` clears the active context and resets settings state. `providerRuntimeContext.ts` does NOT directly call settings-package functions — the adapter is the sole bridge.

**Scenarios:**

1. Call `activateSettingsRuntimeContext(s1)`. `getSettingsService()` returns `s1`. `peekActiveProviderRuntimeContext()` returns a context with `settingsService === s1`.
2. Call `activateSettingsRuntimeContext(s2)`. `getSettingsService()` returns `s2`. The active context's settings service is `s2`.
3. Call `deactivateSettingsRuntimeContext()`. `getSettingsService()` throws. `peekActiveProviderRuntimeContext()` returns null.
4. Test that previously called `registerSettingsService(s)` and expected a context to be created now must call `activateSettingsRuntimeContext(s)`.
5. `providerRuntimeContext.ts` does NOT import or call `registerSettingsService`/`resetSettingsService` — verified by grep scan.

**Tests:** In `packages/core` runtime adapter tests ONLY. Settings-package tests verify settings-owned state only and MUST NOT import core `ProviderRuntimeContext`.

### BVE-06d: Reset-Settings-State-Only vs Full-Deactivation

**Observable Behavior:** `resetSettingsService()` from settings package clears settings-package state and calls `.clear()` on previous service. It does NOT call `clearActiveProviderRuntimeContext()`.

**Scenarios:**

1. Activate runtime context. Call settings-package `resetSettingsService()`. Settings state is cleared, but `peekActiveProviderRuntimeContext()` still returns the context.
2. To fully clear both, call `deactivateSettingsRuntimeContext()` or call `clearActiveProviderRuntimeContext()` then `resetSettingsService()`.

**Owner:** Settings-package `resetSettingsService()` behavior is tested in `packages/settings`. Core adapter deactivation behavior is tested in `packages/core`. Settings tests MUST NOT import or assert anything about core `ProviderRuntimeContext`; they verify only settings-package state changes.

**Adapter idempotency and call counts:**

1. `activateSettingsRuntimeContext(s)` called twice with the same service: second call replaces first context. `registerSettingsService` is called each time — verify call count.
2. `deactivateSettingsRuntimeContext()` called when no context is active: does not throw. `resetSettingsService` may or may not be called — verify call count.
3. Single owner: only `settingsRuntimeAdapter.ts` may bridge both `registerSettingsService` + `setActiveProviderRuntimeContext` in the same function. `providerRuntimeContext.ts` must NOT import or call settings-package functions.

**Adapter permitted bridge scan**: After P06 implementation, verify that only `settingsRuntimeAdapter.ts` bridges settings singleton and runtime context in production code. See `analysis/call-site-migration-matrix.md` for the bridge call classification table and scan logic.

### BVE-07: Provider Settings Consumption

**Observable Behavior:** Providers still use settings for model, base URL, streaming, tool format, auth, custom headers, and reasoning behavior.

**Representative tests:**

- `BaseProvider` model/base URL precedence.
- `providerConfigKeys.ts` reads registry data from settings package.
- OpenAI/Anthropic/OpenAI Vercel provider settings tests pass after import migration.

### BVE-08: CLI Startup And Profile Load

**Observable Behavior:** Startup with profile load still works through the existing CLI path.

**Required command:**

```bash
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

### BVE-09: Package Boundary Enforcement

**Observable Behavior:** No forbidden imports or package cycles exist.

**Tests/Checks:** Use package metadata checks and forbidden import scans from `anti-shim-policy.md` and `package-metadata-constraints.md`.

## Test Quality Rules

- Tests must fail if moved implementation is removed.
- Tests must verify values, state changes, and error behavior, not just imports.
- Integration tests should use real `SettingsService`, real `ProfileManager`, and a temporary directory/home override where feasible.
- Mocks are allowed only for filesystem/environment boundaries when existing tests already use them; assertions must still verify behavior.
