# Final Architecture: Settings Package Extraction

Plan ID: PLAN-20260608-ISSUE1588

## P01 Preflight Architecture Validation

The P0.5 preflight confirmed all architectural assumptions in this document. No preflight findings disproved the planned architecture. Specifically:

1. **Cycle blockers remain correctly classified**: All five blockers (compression import, runtime context import, profile type import, config constructor ownership, and LLXPRT_CONFIG_DIR coupling) were validated against actual code and remain correctly resolved per this document.
2. **Provider package convention confirmed**: The preflight captured `packages/providers/package.json`, `tsconfig.json`, `vitest.config.ts`, and `index.ts` as the convention baseline. Settings follows this precedent exactly.
3. **a2a-server dependency confirmed minimal**: a2a-server has no direct imports of moved symbols. The `Storage` hits were from `@google-cloud/storage` (GCS SDK) and `AsyncLocalStorage` (Node built-in), not our `Storage` class.
4. **CLI god-object scope confirmed**: CLI-specific settings schema files (`packages/cli/src/config/settingsSchema.*`, `packages/cli/src/config/cliEphemeralSettings.*`, `packages/cli/src/runtime/runtimeContextFactory.*`, `packages/cli/src/runtime/runtimeAccessors.*`) are explicitly deferred. Only import-path migration (P08) touches CLI; no CLI-specific logic moves.
5. **Issue #1584 provider boundary precedent honored**: Settings follows the same package name pattern (`@vybestack/llxprt-code-settings`), build convention, export map style, and vitest workspace alias pattern established by the providers extraction.

## Target Package Dependency Direction

```text
packages/settings  -> external runtime deps only (Node APIs, zod if profile schemas require it)
packages/core      -> packages/settings
packages/providers -> packages/settings and packages/core
packages/cli       -> packages/settings, packages/core, packages/providers
packages/a2a-server -> packages/core and packages/settings only where direct settings APIs are needed
```

Forbidden production dependencies:

```text
packages/settings -> packages/core
packages/settings -> packages/providers
packages/settings -> packages/tools
packages/settings -> packages/cli
packages/core     -> packages/providers (preserved from issue1584)
```

## Why This Direction Is Required

Settings are used by core runtime, providers, CLI, and tests. If settings imports core runtime context, the graph becomes `core -> settings -> core`. If settings imports providers, the graph becomes `providers -> settings -> providers` or `core -> settings -> providers -> core`. Both violate issue #1588 and issue #1584 package-boundary decisions.

Therefore all types needed by settings must be either:

1. moved into `packages/settings`, or
2. expressed as settings-owned structural interfaces, or
3. passed in by core/CLI/providers through dependency injection.

## Component Ownership

| Component | Current Location | Target Owner | Reason |
|-----------|------------------|--------------|--------|
| `SettingsService` | `packages/core/src/settings/SettingsService.ts` | `packages/settings/src/settings/SettingsService.ts` | Public entry point requested by issue |
| Settings types | `packages/core/src/settings/types.ts` | `packages/settings/src/types.ts` | Foundation types used by all consumers |
| Settings registry | `packages/core/src/settings/settingsRegistry.ts` | `packages/settings/src/settings/settingsRegistry.ts` | Single source of truth for validation/metadata |
| Settings service instance management | `packages/core/src/settings/settingsServiceInstance.ts` | `packages/settings/src/settings/settingsServiceInstance.ts` | Requested by issue; must be decoupled from core runtime context |
| Storage path helpers | `packages/core/src/config/storage.ts` | `packages/settings/src/storage/Storage.ts` | No `packages/storage` exists; temporary internal storage boundary |
| ProfileManager | `packages/core/src/config/profileManager.ts` | `packages/settings/src/profiles/ProfileManager.ts` | Profile resolution is first-class settings concept |
| Profile/model parameter types | `packages/core/src/types/modelParams.ts` | `packages/settings/src/profiles/types.ts` or `src/modelParams.ts` | Prevents settings from importing core |
| Core `Config` hierarchy | `packages/core/src/config/config*.ts` | stays in core for this issue | God-object decomposition prerequisite not complete |
| CLI settings schema/runtime settings | `packages/cli/src/config/**`, `packages/cli/src/runtime/**` | stays in CLI for this issue, inventoried as follow-up | Issue says after god-object decomposition; not ready without broad scope expansion |

## Settings Service Instance Decoupling

Current `settingsServiceInstance.ts` imports core `providerRuntimeContext`. That cannot move as-is. The target architecture is:

1. `packages/settings` owns `getSettingsService`, `registerSettingsService`, `resetSettingsService`, and optional scoped activation helpers.
2. `packages/core/src/runtime/providerRuntimeContext.ts` manages context state only (`setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`). It does NOT import or call settings-package functions. `packages/core/src/runtime/settingsRuntimeAdapter.ts` bridges context activation/clearing with settings singleton registration/reset — the adapter is the sole authorized bridge.
3. Providers import singleton helpers from settings, not core.
4. Tests verify runtime context switches do not leak settings between isolated contexts.

This inverts the current coupling: core runtime context may know settings exists, but settings never knows core runtime context exists.

### Singleton/Runtime-Context Replacement Semantics

Current behavior of `settingsServiceInstance.ts`:

- `getSettingsService()`: reads the active `ProviderRuntimeContext` (via `getActiveProviderRuntimeContext()`), and returns `context.settingsService` if context exists, otherwise returns the module-level singleton. If neither exists, throws.
- `registerSettingsService(settingsService)`: if an active `ProviderRuntimeContext` exists, sets `context.settingsService = settingsService`. If no context exists, creates a new `ProviderRuntimeContext` with the settings service and activates it.
- `resetSettingsService()`: clears the active `ProviderRuntimeContext` (calls `clearActiveProviderRuntimeContext()`) AND resets the module-level settings instance.

Target behavior in `packages/settings`:

- `registerSettingsService(settingsService)` stores the settings service in settings-package-owned state ONLY. It does NOT create a `ProviderRuntimeContext` and does NOT import core.
- `getSettingsService()` returns the currently registered settings service from settings-package-owned state, or throws the current-style error if none is registered.
- `resetSettingsService()` clears the settings-package-owned state only. It calls `clear()` on the previous service if current behavior requires it.

**Lifecycle single-owner resolution**: There is exactly ONE owner for syncing settings state with runtime context — the core-owned `settingsRuntimeAdapter.ts`. The rules are:

1. **`providerRuntimeContext.ts` does NOT directly call `registerSettingsService` or `resetSettingsService`**. It manages context state only (`setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`). It does NOT import settings-package functions. When context is activated/cleared, `providerRuntimeContext.ts` only updates its own context state.
2. **`settingsRuntimeAdapter.ts` is the sole bridge**: it calls both runtime-context functions AND settings-package singleton functions. Specifically:
   - `activateSettingsRuntimeContext()` calls `createProviderRuntimeContext()`, `setActiveProviderRuntimeContext()`, AND `registerSettingsService()`.
   - `deactivateSettingsRuntimeContext()` calls `clearActiveProviderRuntimeContext()` AND `resetSettingsService()`.
   No other file may call both a settings-package singleton function AND a core runtime-context function in the same code path.
3. **`configConstructor.ts`** uses `activateSettingsRuntimeContext()` — it does NOT call `registerSettingsService` directly. **The production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()` is a P06 task** (P03b creates a transparent no-op adapter but does NOT wire configConstructor).
4. **Test cleanup** uses settings-package `resetSettingsService()` directly (for settings state only) or `deactivateSettingsRuntimeContext()` (for combined settings+context cleanup).

This resolves the previous ambiguity where final-architecture said "providerRuntimeContext set/clear syncs settings" while the adapter also called register/reset around set/clear. The definitive answer: **the adapter bridges; providerRuntimeContext does not import or call settings functions**.

Core-owned adapter for context creation:

- **`settingsRuntimeAdapter.ts` is the SOLE bridge between settings lifecycle and runtime context lifecycle**. `providerRuntimeContext.ts` does NOT directly call settings-package functions; it relies on the adapter instead. This prevents double-registration.
- `setActiveProviderRuntimeContext(context)` is called by the adapter; the adapter also calls `registerSettingsService(context.settingsService)`. providerRuntimeContext stays agnostic of settings.
- `clearActiveProviderRuntimeContext()` is called by the adapter; the adapter also calls `resetSettingsService()`. providerRuntimeContext stays agnostic of settings.
- This replaces the old pattern where `registerSettingsService` could _create_ a runtime context. The core adapter is the only code that bridges runtime context and settings instance management.

### Core-Owned Runtime Context Adapter

Current `registerSettingsService` can create a `ProviderRuntimeContext` when none exists. In the target architecture, settings cannot create core objects, so core must provide an adapter for callers that need context creation:

```typescript
// packages/core/src/runtime/settingsRuntimeAdapter.ts
// @plan PLAN-20260608-ISSUE1588.P06
// SOLE BRIDGE: the only file that calls BOTH settings-package singleton functions
// AND core runtime-context functions. No other file may bridge both.

import { registerSettingsService, resetSettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext, setActiveProviderRuntimeContext, clearActiveProviderRuntimeContext } from './providerRuntimeContext.js';

export function activateSettingsRuntimeContext(settingsService: SettingsService, runtimeId?: string): void {
  const context = createProviderRuntimeContext({
    settingsService,
    runtimeId: runtimeId ?? 'activated-adapter',
    metadata: { source: 'activateSettingsRuntimeContext' },
  });
  setActiveProviderRuntimeContext(context);
  registerSettingsService(settingsService);
}

export function deactivateSettingsRuntimeContext(): void {
  clearActiveProviderRuntimeContext();
  resetSettingsService();
}
```

- `activateSettingsRuntimeContext(s)` replaces the old behavior of `registerSettingsService` creating a context.
- `deactivateSettingsRuntimeContext()` replaces the old behavior of `resetSettingsService` clearing the context.
- The only production caller needing `activateSettingsRuntimeContext` is `configConstructor.ts`.
- All test cleanup sites use settings-package `resetSettingsService()` directly; if they also need context clearing, they call `clearActiveProviderRuntimeContext()` explicitly or use `deactivateSettingsRuntimeContext()`.
- **providerRuntimeContext.ts does NOT import or call settings-package functions** — it stays agnostic. The adapter is the sole bridge.

### Explicit Decision: providerRuntimeContext.ts Ownership

**`providerRuntimeContext.ts` MUST NOT import, construct, or reference `SettingsService` from the settings package.** It is agnostic of settings entirely. The sole bridge between settings and runtime context is `settingsRuntimeAdapter.ts`. This rule is enforced by scan in every verification phase from P06 onward:

```bash
# Enforcing: providerRuntimeContext.ts must NOT import or reference SettingsService or settings singleton functions
SETTINGS_IN_PROV_CTX=$(rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null || true)
test -z "$SETTINGS_IN_PROV_CTX" && echo "OK: providerRuntimeContext.ts is settings-agnostic" || { echo "FAIL: providerRuntimeContext.ts imports/references settings:"; echo "$SETTINGS_IN_PROV_CTX"; exit 1; }
```

This decision resolves the contradiction identified in review-09: `providerRuntimeContext.ts` is not an adapter, not a bridge, and must not import or construct `SettingsService` from settings. The adapter module (`settingsRuntimeAdapter.ts`) is the sole authorized bridge.

### providerRuntimeContext Replacement Type and Call-Site Inventory

Since `providerRuntimeContext.ts` must not reference `SettingsService` directly, the `ProviderRuntimeContext` type needs a replacement for the `settingsService` field. The resolution is:

**Replacement type**: Define a core-owned structural interface `ProviderRuntimeSettingsService` in `providerRuntimeContext.ts` with the minimum methods core needs from a settings-like service:

```typescript
// packages/core/src/runtime/providerRuntimeContext.ts
// Core-owned structural interface for settings service within runtime context.
// Settings package provides the concrete SettingsService implementation;
// providerRuntimeContext only depends on this structural interface.
export interface ProviderRuntimeSettingsService {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  on(event: string, handler: (...args: unknown[]) => void): () => void;
  clear(): void;
}
```

**`ProviderRuntimeContextInit` changes**: The `settingsService` field in `ProviderRuntimeContextInit` becomes typed as `ProviderRuntimeSettingsService` (not `SettingsService`). This allows providerRuntimeContext to stay settings-agnostic while still requiring a settings-like service when creating contexts.

**`settingsService` is required in `ProviderRuntimeContextInit`**: After migration, `createProviderRuntimeContext({})` without a `settingsService` is no longer valid. All call sites must provide a settings service. The adapter provides one via `activateSettingsRuntimeContext(s)`. Call-site inventory:

| Call Site | Current `settingsService` Status | Required Change |
|-----------|----------------------------------|-----------------|
| `configConstructor.ts` | Currently calls `registerSettingsService(s)` directly | Switch to `activateSettingsRuntimeContext(s)` in **P06** (P03b does NOT wire configConstructor) |
| `config.test.ts` | Creates contexts with settings service in tests | Provide `ProviderRuntimeSettingsService` |
| `providerRuntimeContext.test.ts` | Tests context creation/clearing | Provide `ProviderRuntimeSettingsService` |
| `settings-remediation.test.ts` | Tests settings registration | Use adapter |
| `system-integration.test.ts` | Tests settings/LSP integration | Provide `ProviderRuntimeSettingsService` |
| Other test files with `beforeEach`/`afterEach` | Test cleanup using `registerSettingsService`/`resetSettingsService` | Migrate to settings-package imports; use adapter for context creation |

**Default construction behavior**: `createProviderRuntimeContext({})` without a `settingsService` will be invalid after migration. Callers must always provide a settings service. The adapter's `activateSettingsRuntimeContext(s)` function handles this by always passing the settings service when creating contexts.

See `analysis/call-site-migration-matrix.md` for full call-site classification.

### Required Behavioral Tests

Tests MUST cover these scenarios explicitly:

1. **Register-before-context**: Call `registerSettingsService(s)` before any runtime context exists. `getSettingsService()` must return `s`. No core `ProviderRuntimeContext` is created in settings package.
2. **Context-activation-updates-settings**: Core creates a runtime context and activates it. `getSettingsService()` from settings must return the context's settings service.
3. **Context-clearing-resets-settings**: Core clears the active runtime context. Subsequent `getSettingsService()` calls must reflect the cleared state (throw or return undefined/null per semantics).
4. **Settings-isolation**: Two contexts with different settings services. Activating context A then context B, then reading settings, must return context B's settings — not A's.
5. **Reset clears previous service**: `resetSettingsService()` must call `.clear()` on the previous service if current behavior does so.
6. **Core-owned adapter**: `activateSettingsRuntimeContext(s)` creates a `ProviderRuntimeContext` AND calls `registerSettingsService(s)`. `deactivateSettingsRuntimeContext()` clears context AND resets settings state.
7. **Reset-settings-state-only**: Settings-package `resetSettingsService()` clears settings-package state but does NOT call `clearActiveProviderRuntimeContext()`.

## Profile Type Ownership

`ProfileManager` currently imports `Profile`, `LoadBalancerProfile`, and `isLoadBalancerProfile` from core `modelParams.ts`. Moving `ProfileManager` without moving those types would force `settings -> core`, which is forbidden. Therefore the plan requires extracting profile-related types into settings first and updating core/providers imports.

`modelParams.ts` also includes provider model parameter and ephemeral settings types. These are persisted profile/settings data, so settings is the correct owner for the shared data contracts. Core can re-home or import any remaining non-profile model helpers from settings if they are shared.

### Final State Of `modelParams.ts`

The entire file `packages/core/src/types/modelParams.ts` is **deleted** in P09. All symbols move to settings-owned modules:

- Profile types (`Profile`, `StandardProfile`, `LoadBalancerProfile`, `LoadBalancerConfig`, `LoadBalancerSubProfileConfig`) and guards (`isLoadBalancerProfile`, `isStandardProfile`, `isOAuthProfile`, `hasAuthConfig`) move to `packages/settings/src/profiles/types.ts`.
- `ModelParams` and `EphemeralSettings` move to `packages/settings/src/profiles/types.ts`.
- `AuthConfig` and `AuthConfigSchema` (including zod dependency) move to `packages/settings/src/profiles/types.ts`.

No symbols remain in core `modelParams.ts`. Core re-exports of these types from `packages/core/src/index.ts` or `packages/core/package.json` are forbidden compatibility shims after P09.

## Compression Strategy Registry Boundary

`settingsRegistry.ts` currently imports `COMPRESSION_STRATEGIES` from core compression. This is a concrete cycle blocker. The allowed strategy list must become settings-owned registry data. Core compression may either import the settings-owned list if it does not create a cycle, or keep its own runtime constant with a test that verifies the public settings values remain compatible.

The preferred implementation for minimal risk is to define the small list in settings and update the registry test to assert the expected literal list directly, not import core compression.

## Storage Package Gap

Issue #1588 says settings should depend on `packages/storage`, but no such workspace exists. The implementation must not invent a package without a separate scope decision. Instead:

- `Storage` moves into `packages/settings/src/storage/Storage.ts`.
- Public exports make storage path helpers available from settings.
- **Internal storage seam/boundary**: `packages/settings/src/storage/` is a clearly separated internal module with its own directory, public API surface (`Storage` class and `LLXPRT_DIR` constant), and no cross-module dependencies on settings service or profile code beyond what `Storage.ts` already imports. This internal module boundary is explicitly recorded so that a future extraction to `packages/storage` would only need to move this directory and update package exports. The `Storage` class does not import `SettingsService`, `ProfileManager`, or settings registry — it only uses `path`, `os`, `fs`, and `crypto` from Node.js built-ins. This independence makes future extraction clean. Add a `// @storage-seam: This module is a candidate for future extraction to packages/storage` marker to `Storage.ts` to track this boundary.
- The analysis artifact records a future extraction seam: if `packages/storage` is introduced later, this internal module is the source to move.

## LLXPRT_CONFIG_DIR / MemoryTool Coupling Resolution

`packages/core/src/config/storage.ts` defines its own `LLXPRT_DIR = '.llxprt'` constant (line 12) while `packages/core/src/tools/memoryTool.ts` defines `LLXPRT_CONFIG_DIR = '.llxprt'` (line 83). Currently, `configBaseCore.ts` imports `LLXPRT_CONFIG_DIR` from `memoryTool.ts` for its `getLlxprtDir()` method, creating a coupling between config and tools.

**Resolution**: `Storage` already defines its own local `LLXPRT_DIR` constant. When `Storage` moves to settings, this constant moves with it. `configBaseCore.ts` currently imports from `memoryTool.ts` — after migration, core must either:
1. Define its own local constant (`.llxprt`), or
2. Import the constant from settings package's Storage module.

**Decision**: Option 1 is preferred. Core defines its own local `LLXPRT_DIR = '.llxprt'` constant (the literal string `.llxprt` is trivial and does not justify a cross-package dependency). Settings `Storage` owns its own copy. Tests must prove both resolve to the same value:

```typescript
// packages/settings/src/storage/Storage.ts (moved from core)
export const LLXPRT_DIR = '.llxprt';
// Storage methods use this constant for all path resolution

// packages/core/src/config/configBaseCore.ts (after migration)
const LLXPRT_DIR = '.llxprt'; // local constant, no import from tools or settings needed
// getLlxprtDir() uses this local constant
```

**Required tests**:
- `packages/settings/src/storage/__tests__/Storage.test.ts` must assert `Storage.getGlobalLlxprtDir()` returns `path.join(os.homedir(), '.llxprt')`.
- `packages/core/src/config/config.test.ts` must assert `config.getLlxprtDir()` returns `path.join(targetDir, '.llxprt')`.
- A dedicated test in settings proving `LLXPRT_DIR` equals the literal `'.llxprt'` without importing from core/tools.

This eliminates the `configBaseCore.ts → memoryTool.ts` import chain, ensuring settings storage does not need core/tools for the config directory constant.

## Public API Surface

Recommended exports from `@vybestack/llxprt-code-settings`:

- `SettingsService`
- `getSettingsService`, `registerSettingsService`, `resetSettingsService`
- `SETTINGS_REGISTRY` and registry utility functions
- settings types (`ISettingsService`, `GlobalSettings`, `ProviderSettings`, etc.)
- profile types and guards (`Profile`, `StandardProfile`, `LoadBalancerProfile`, `isLoadBalancerProfile`, `isStandardProfile`)
- `ProfileManager`
- `Storage`

### Source Layout Convention

The settings package follows the same build convention as `packages/providers`:
- Source: `packages/settings/src/`
- Build output: `dist/` (with `outDir: "dist"`)
- TypeScript compiles `src/` to `dist/src/`, so `src/settings/SettingsService.ts` becomes `dist/src/settings/SettingsService.js`
- Root export resolves to `dist/index.js` (from `packages/settings/index.ts` → `./src/index.js`)
- Subpath exports reference `./dist/src/...` paths (e.g., `"./settings/SettingsService.js": "./dist/src/settings/SettingsService.js"`)

**Source layout consistency**: `SettingsService.ts` lives at `packages/settings/src/settings/SettingsService.ts` (matching the `src/settings/` directory convention). This is consistent with:
- The subpath export `./settings/SettingsService.js` → `./dist/src/settings/SettingsService.js`
- The package-metadata-constraints source layout vocabulary specifying `src/settings/`, `src/profiles/`, `src/storage/`
- The providers precedent where source modules live in subdirectories matching their domain

### Export Map Decision: Root-Plus-Subpaths

The settings package exports **both** a root barrel and explicit grouped subpath exports. This matches consumer import patterns and migration ergonomics. See `analysis/package-metadata-constraints.md` for the mandatory `package.json` exports map and built-runtime verification commands.

**Import style preference**: Root imports are the default and preferred style for consumers (e.g., `import { SettingsService } from '@vybestack/llxprt-code-settings'`). Subpath imports are allowed only when specifically justified by tree-shaking or grouped module access needs. Migration phases (P06/P07/P08) should use root imports unless a subpath is required for a documented reason.

Subpath exports are mandatory in `packages/settings/package.json` (using `dist/src/...` paths matching the providers build convention):

- `./settings/SettingsService.js` → `./dist/src/settings/SettingsService.js`
- `./settings/settingsServiceInstance.js` → `./dist/src/settings/settingsServiceInstance.js`
- `./settings/settingsRegistry.js` → `./dist/src/settings/settingsRegistry.js`
- `./profiles/ProfileManager.js` → `./dist/src/profiles/ProfileManager.js`
- `./profiles/types.js` → `./dist/src/profiles/types.js`
- `./storage/Storage.js` → `./dist/src/storage/Storage.js`

Root exports aggregate all public APIs. Subpath exports provide direct access to grouped modules. Consumers may use either style.

No core compatibility wrapper exports are allowed after P09.

## Generated Settings Schema/Docs Ownership

`scripts/generate-settings-schema.ts` and `scripts/generate-settings-doc.ts` import from `packages/cli/src/config/settingsSchema.js`. This CLI-owned schema is separate from the settings registry being moved to `packages/settings`. The scripts remain root-owned and the CLI schema stays in CLI until god-object decomposition. These scripts are NOT part of the settings package and do NOT move. See `analysis/package-metadata-constraints.md` for verification requirements.
