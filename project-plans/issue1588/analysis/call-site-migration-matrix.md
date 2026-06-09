# Call-Site Migration Matrix: Settings Service Instance APIs (Lifecycle-Only)

Plan ID: PLAN-20260608-ISSUE1588

## Scope: Lifecycle-Only — NOT The Full Import Inventory

**WARNING: IMPORTANT: This matrix covers ONLY `getSettingsService`, `registerSettingsService`, and `resetSettingsService` call sites — the settings service instance lifecycle APIs. It does NOT constitute the full import inventory for the settings extraction.**

### Why This Distinction Matters

The singleton call-site matrix covers approximately 68 sites. The actual import surface requiring migration is much larger. Implementers MUST NOT treat this matrix as the complete migration checklist. The full import inventory must be completed before P08 execution and must cover ALL workspaces, including:

- **Root-barrel imports** of ALL moved symbols from `@vybestack/llxprt-code-core` (not just lifecycle APIs)
- **Deep-path imports** from `@vybestack/llxprt-code-core/settings/*`, `@vybestack/llxprt-code-core/config/storage.js`, `@vybestack/llxprt-code-core/config/profileManager.js`
- **Type imports** from `@vybestack/llxprt-code-core/types/modelParams`
- **Mock imports** (`vi.mock` paths) referencing old core settings/config paths
- **Dynamic `import()` calls** referencing old core settings/config paths
- **All workspaces** including `packages/lsp`, `packages/a2a-server`, `packages/test-utils`

The full import inventory is required before P08 begins per `plan/08-consumer-migration-impl.md` prerequisites and `analysis/preflight-results-template.md` inventory commands. This lifecycle-only matrix is sufficient for P06 adapter design but is NOT sufficient for P08 consumer migration.

## Full Import Inventory Requirement (Before P08)

Before P08 execution begins, a complete refreshed import inventory covering ALL workspaces must be completed. This lifecycle-only matrix covers only `getSettingsService`/`registerSettingsService`/`resetSettingsService` call sites — approximately 68 sites. The full import inventory must additionally cover:

- Root-barrel named imports of ALL moved symbols (`SettingsService`, `ProfileManager`, `Storage`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `SETTINGS_REGISTRY`, type guards, `AuthConfig`/`AuthConfigSchema`, etc.)
- Deep-path imports: `@vybestack/llxprt-code-core/settings/*`, `@vybestack/llxprt-code-core/config/(storage|profileManager)`
- Type imports: `@vybestack/llxprt-code-core/types/modelParams`
- `vi.mock()` paths referencing old core settings/config paths
- Dynamic `import()` calls with old core settings/config paths
- All workspaces: core, providers, CLI, a2a-server, test-utils, lsp

Scan commands for the full inventory are in `analysis/preflight-results-template.md` and `analysis/consumer-import-matrix.md`. The refreshed inventory must record actual grep counts and must be verified before P08 proceeds. The full import inventory must include scans for:

```bash
# 1. Root-barrel named imports of ALL moved symbols
rg -n "import.*\{[^}]*(SettingsService|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY|ProfileManager|Storage|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|ModelParams|EphemeralSettings|hasAuthConfig|isOAuthProfile|AuthConfig|AuthConfigSchema)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'

# 2. Deep-path imports
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'

# 3. Type imports
rg -n "from ['"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'

# 4. vi.mock paths
rg -n "vi\.mock.*['"].*settings/|vi\.mock.*['"].*config/(storage|profileManager)" packages --glob '*.ts'

# 5. Dynamic imports (static and deep)
rg -n "import\(['"]@vybestack/llxprt-code-core/settings/|import\(['"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'

# 6. All workspaces explicitly (including lsp, a2a-server, test-utils)
for ws in core providers cli lsp a2a-server test-utils; do
  echo "=== packages/$ws ==="
  rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|import.*(SettingsService|ProfileManager|Storage|ModelParams|Profile).*from.*@vybestack/llxprt-code-core" packages/$ws --glob '*.ts' 2>/dev/null || echo "(none)"
done
```

## Classification Categories

| Category | Tag | Description | Migration Path |
|----------|-----|-------------|----------------|
| Settings-only singleton | `SINGLETON` | Stores/reads settings service without creating runtime context | Direct migration to settings package import |
| Runtime-context activation | `CONTEXT-ACTIVATE` | Creates or activates a runtime context that contains a settings service | Use core-owned `activateSettingsRuntimeContext()` helper |
| Test cleanup/isolation | `TEST-CLEANUP` | Calls `resetSettingsService()` in `beforeEach`/`afterEach` | Direct migration to settings package import |
| Provider behavior requiring context | `PROVIDER-CONTEXT` | Provider reads settings through `getSettingsService()` expecting active runtime context | Direct migration to settings package import |
| Config method delegation | `CONFIG-DELEGATE` | Core `Config.getSettingsService()` method returning current service | Update to call settings-package `getSettingsService()` internally |

## Core-Owned Replacement Helper

Current `registerSettingsService` sometimes needs to create a `ProviderRuntimeContext`. Settings package cannot do this. Core must provide:

```typescript
// packages/core/src/runtime/settingsRuntimeAdapter.ts
// @plan PLAN-20260608-ISSUE1588.P06
// SOLE BRIDGE: the only file that calls BOTH settings-package singleton functions
// AND core runtime-context functions. No other file may bridge both.

import { registerSettingsService, resetSettingsService } from '@vybestack/llxprt-code-settings';
import { createProviderRuntimeContext, setActiveProviderRuntimeContext, clearActiveProviderRuntimeContext } from './providerRuntimeContext.js';

/**
 * Core-owned adapter that bridges runtime context creation with settings package.
 * Replaces the old behavior where registerSettingsService created a ProviderRuntimeContext.
 * This is the ONLY production path that calls both settings singleton functions AND
 * core runtime-context functions. providerRuntimeContext.ts does NOT import settings.
 */
export function activateSettingsRuntimeContext(settingsService: SettingsService, runtimeId?: string): void {
  const context = createProviderRuntimeContext({ settingsService, runtimeId: runtimeId ?? 'activated-adapter', metadata: { source: 'activateSettingsRuntimeContext' } });
  setActiveProviderRuntimeContext(context);
  registerSettingsService(settingsService);
}

/**
 * Core-owned adapter that clears runtime context and resets settings package state.
 * This is the ONLY production path that clears both. providerRuntimeContext.ts does NOT call resetSettingsService.
 */
export function deactivateSettingsRuntimeContext(): void {
  clearActiveProviderRuntimeContext();
  resetSettingsService();
}
```

### Behavioral Tests Required

- `TEST-ADAPTER-01`: `activateSettingsRuntimeContext(s)` creates a `ProviderRuntimeContext` AND calls `registerSettingsService(s)`. After call, `getSettingsService()` returns `s`.
- `TEST-ADAPTER-02`: `deactivateSettingsRuntimeContext()` clears the active context AND resets settings state. After call, `getSettingsService()` throws.
- `TEST-ADAPTER-03`: Calling `activateSettingsRuntimeContext(s2)` after `activateSettingsRuntimeContext(s1)` switches active context. `getSettingsService()` returns `s2`.
- `TEST-ADAPTER-04`: Settings package `registerSettingsService()` called without adapter does NOT create a `ProviderRuntimeContext`. `peekActiveProviderRuntimeContext()` returns null.
- `TEST-ADAPTER-05`: Tests using `resetSettingsService()` for cleanup: after migration, calling settings-package `resetSettingsService()` clears settings state but does NOT call `clearActiveProviderRuntimeContext()`. Test cleanup that also needs context clearing must use `deactivateSettingsRuntimeContext()` or call both.

### Adapter Idempotency And Call-Count Tests

- `TEST-ADAPTER-06`: `activateSettingsRuntimeContext(s)` called twice with the same service: second call replaces first context. `registerSettingsService` is called both times — verify via call-count tracking.
- `TEST-ADAPTER-07`: `deactivateSettingsRuntimeContext()` called when no context is active: does not throw. Verify `resetSettingsService` call count (it should still be called or verified as a no-op).
- `TEST-ADAPTER-08`: Single owner verification: only `settingsRuntimeAdapter.ts` may call both `registerSettingsService` from settings AND `setActiveProviderRuntimeContext` in the same function body. Other core code must use one or the other, not both. This is the **single owner** rule for bridging settings and runtime context.

**Owner semantics**: `activateSettingsRuntimeContext` / `deactivateSettingsRuntimeContext` are the ONLY production paths that bridge settings lifecycle with runtime context lifecycle. Direct use of both `registerSettingsService` + `setActiveProviderRuntimeContext` outside the adapter indicates a potential double-registration bug and violates the single-owner rule.

**providerRuntimeContext.ts must NOT import or call settings-package singleton functions** — it stays agnostic of settings. The adapter is the sole bridge. This prevents double-registration where both providerRuntimeContext and the adapter attempt to sync settings state.

### Adapter Permitted Bridge Scan Logic

After P06, enforce the single-owner rule with a concrete scan:

```bash
# Production bridge scan: find files that import BOTH settings-package singleton functions
# AND core runtime-context functions, excluding the adapter itself and test files
# Step 1: Find files importing settings singleton functions
# Step 2: Among those, check if they also import runtime-context functions
# Step 3: Any file other than settingsRuntimeAdapter.ts in production code is a violation

# Test cleanup exemption: test files (.test.ts, .spec.ts) may import both for setup/teardown
# Mock exemption: vi.mock paths that reference settings functions are not bridge calls
# Production bridge = runtime call to both settings-package singleton AND core context function
```

Classification of bridge call types:

| Call Type | Description | Allowed In |
|-----------|-------------|-----------|
| Production bridge | Imports both `registerSettingsService`/`resetSettingsService` AND `setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext` in the same file's runtime code | `settingsRuntimeAdapter.ts` ONLY |
| Test cleanup | Test file imports both for `beforeEach`/`afterEach` cleanup | Any `.test.ts`/`.spec.ts` file |
| Mock path | `vi.mock(...)` reference to settings function | Any test file (not a real call path) |
| Settings-only | Settings-package singleton function only, no context function | Any consumer (direct migration) |
| Context-only | Core context function only, no settings function | `providerRuntimeContext.ts` and callers |

**Test ownership**: Adapter tests live in `packages/core`. Settings-package tests test ONLY settings-owned state (singleton register/reset/get). Settings tests MUST NOT import or assert anything about `ProviderRuntimeContext`.

## Call-Site Inventory

### registerSettingsService Call Sites

| File | Location | Category | Migration Action |
|------|----------|----------|-----------------|
| `packages/core/src/settings/settingsServiceInstance.ts` | L40-66 (definition) | — | Moves to settings package; semantics change to singleton-only |
| `packages/core/src/config/configConstructor.ts` | L65, L217 | `CONTEXT-ACTIVATE` | Replace with `activateSettingsRuntimeContext()` from core adapter **in P06** (P03b does NOT wire configConstructor) |
| `packages/core/src/index.ts` | L326 | — | Remove re-export in P09 |
| `packages/cli/src/auth/oauth-manager.spec.ts` | L835, L850 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/cli/src/auth/oauth-manager.token-reuse.spec.ts` | L205 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/cli/src/auth/oauth-manager.issue1317.spec.ts` | L221 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/providers/src/openai-vercel/providerRegistry.test.ts` | L55 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts` | L59 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/providers/src/ProviderManager.test.ts` | L77 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/providers/src/BaseProvider.test.ts` | L179 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/core/src/integration-tests/settings-remediation.test.ts` | L49, L263 | `TEST-CLEANUP` + `SINGLETON` | Migrate import; if test relies on context creation behavior, use adapter |
| `packages/core/src/config/config.ephemeral.test.ts` | L22 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/core/src/auth/precedence.test.ts` | L71 | `TEST-CLEANUP` | Migrate import to settings package; no behavior change |
| `packages/core/src/lsp/__tests__/system-integration.test.ts` | L171 | `TEST-CLEANUP` (mock) | Migrate mock to settings package import |
| `packages/core/src/lsp/__tests__/e2e-lsp.test.ts` | L172 | `TEST-CLEANUP` (mock) | Migrate mock to settings package import |
| `packages/core/src/config/config-lsp-integration.test.ts` | L176 | `TEST-CLEANUP` (mock) | Migrate mock to settings package import |

### resetSettingsService Call Sites

| File | Location | Category | Migration Action |
|------|----------|----------|-----------------|
| `packages/core/src/settings/settingsServiceInstance.ts` | L66 (definition) | — | Moves to settings package; semantics change to settings-state-only reset |
| `packages/core/src/index.ts` | L325 | — | Remove re-export in P09 |
| `packages/core/src/config/config.test.ts` | L156 | `TEST-CLEANUP` (mock) | Migrate mock to settings package |
| `packages/core/src/runtime/providerRuntimeContext.test.ts` | L23, L29, L74 | `TEST-CLEANUP` | Migrate to settings package; if test relies on context clearing, use `deactivateSettingsRuntimeContext()` |
| `packages/core/src/auth/precedence.test.ts` | L16, L70 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/core/src/auth/invalidateProviderCache.test.ts` | L26, L39 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/core/src/config/config.ephemeral.test.ts` | L11, L21 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/core/src/integration-tests/settings-remediation.test.ts` | L10, L38, L70, L254 | `TEST-CLEANUP` | Migrate to settings package; if test relies on context clearing, add explicit `clearActiveProviderRuntimeContext()` or use adapter |
| `packages/cli/src/auth/oauth-manager.spec.ts` | L13, L821, L826 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/cli/src/auth/oauth-manager.token-reuse.spec.ts` | L26, L212 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/cli/src/auth/oauth-manager.issue1317.spec.ts` | L24, L228 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/cli/src/config/config.loadMemory.test.ts` | L13, L304 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/providers/src/openai/OpenAIProvider.emptyResponseRetry.test.ts` | L24 | `TEST-CLEANUP` | Migrate import to settings package |
| `packages/providers/src/openai/__tests__/OpenAIProvider.e2e.test.ts` | L43 | `TEST-CLEANUP` | Migrate import to settings package |
| `packages/providers/src/openai/OpenAIProvider.deepseekReasoning.test.ts` | L35 | `TEST-CLEANUP` | Migrate import to settings package |
| `packages/providers/src/openai/OpenAIProvider.integration.test.ts` | L41 | `TEST-CLEANUP` | Migrate import to settings package |
| `packages/providers/src/openai-vercel/providerRegistry.test.ts` | L52 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/providers/src/__tests__/ProviderManager.sandboxBaseUrl.test.ts` | L56 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/providers/src/ProviderManager.test.ts` | L12-13, L34, L75, L148 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/providers/src/BaseProvider.test.ts` | L25-26, L178 | `TEST-CLEANUP` | Migrate to settings package |
| `packages/providers/src/integration/multi-provider.integration.test.ts` | L67, L178, L400, L580 | `TEST-CLEANUP` | Migrate to settings package |

### getSettingsService Call Sites

| File | Location | Category | Migration Action |
|------|----------|----------|-----------------|
| `packages/core/src/settings/settingsServiceInstance.ts` | L25 (definition) | — | Moves to settings package |
| `packages/core/src/index.ts` | L324 | — | Remove re-export in P09 |
| `packages/core/src/config/configBaseCore.ts` | L681 | `CONFIG-DELEGATE` | `Config.getSettingsService()` delegates; update internal call to settings package |
| `packages/core/src/config/config.ts` | L364, L390, L687 | `CONFIG-DELEGATE` | Config methods call `this.getSettingsService()`; not a direct singleton call |
| `packages/core/src/config/configConstructor.ts` | L217 | `CONTEXT-ACTIVATE` | Context creation path; use adapter |
| `packages/core/src/core/prompts.ts` | L15, L243, L350, L368, L513 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/core/src/tools/memoryTool.ts` | L30, L384 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/core/src/integration-tests/profile-integration.test.ts` | L11, L25 | `PROVIDER-CONTEXT` | Migrate import (mocked) to settings package |
| `packages/core/src/integration-tests/provider-settings-integration.spec.ts` | L8, L14 | `PROVIDER-CONTEXT` | Migrate import (mocked) to settings package |
| `packages/core/src/config/config.test.ts` | L32, L224, L914 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/core/src/runtime/providerRuntimeContext.test.ts` | L22 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/core/src/auth/precedence.test.ts` | L14, L83, L111, L139, L165, L261, L286, L336, L373, L481, L520, L553, L573, L594, L615 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/core/src/lsp/__tests__/system-integration.test.ts` | L158 | `TEST-CLEANUP` (mock) | Migrate mock path |
| `packages/core/src/lsp/__tests__/e2e-lsp.test.ts` | L159 | `TEST-CLEANUP` (mock) | Migrate mock path |
| `packages/providers/src/BaseProvider.ts` | L34, L132 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/providers/src/anthropic/AnthropicProvider.ts` | L24, L417 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/providers/src/BaseProvider.test.ts` | L24, L65, L90, L190, L298, L433, L508, L541, L555, L577, L612 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/providers/src/openai-vercel/providerRegistry.test.ts` | — | not direct | Uses `registerSettingsService` for setup |
| `packages/cli/src/providers/providerManagerInstance.ts` | L16, L384 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/cli/src/auth/provider-usage-info.ts` | L21, L243 | `PROVIDER-CONTEXT` | Migrate import to settings package |
| `packages/cli/src/nonInteractiveCli.ts` | L57, L287 | `CONFIG-DELEGATE` | Uses `config.getSettingsService()`, not singleton |
| `packages/cli/src/config/postConfigRuntime.ts` | L79, L98, L220, L348 | `CONFIG-DELEGATE` | Uses local `getSettingsService()` wrapper, not singleton |

### Config Method getSettingsService (Indirect Calls)

These call sites use `config.getSettingsService()` which delegates to the core `Config` class. They do NOT directly import the singleton and will work as long as `Config.getSettingsService()` is updated internally.

| Package | Files (non-exhaustive) | Migration Action |
|---------|------------------------|-----------------|
| CLI integration tests | `model-params-isolation`, `base-url-behavior`, `provider-switching`, `consumer-migration-p13`, `modelParams` | No direct import change; Config delegation updated in P06 |
| CLI UI hooks | `streamUtils.ts` | No direct import change |
| CLI commands | `toolsCommand.ts` | No direct import change |
| CLI auth tests | `oauth-manager.*.spec.ts` | Direct `registerSettingsService`/`resetSettingsService` imports must be migrated |
| CLI runtime | `runtimeContextFactory.ts`, `runtimeAccessors.ts` | Config delegation; no direct singleton import |
| Core tools | `task.ts`, `tool-registry.ts`, `codesearch.ts`, `memoryTool.ts` | Mixed: some use `config.getSettingsService()`, some use singleton directly |
| Core agents | `executor.ts`, `ChatSessionFactory.ts` | Config delegation |
| Providers tests | `ProviderManager.test.ts`, `BaseProvider.test.ts` | Direct singleton imports; must be migrated |

## Behavioral Changes And Required Tests

### BVE-06a: Register-Before-Context (unchanged)
Settings-package `registerSettingsService(s)` stores service in settings-package state ONLY. No `ProviderRuntimeContext` created.

### BVE-06b: Context-Activation-Updates-Settings (unchanged)
Core activating a provider runtime context calls `registerSettingsService(context.settingsService)` from settings package.

### BVE-06c: Core-Owned Context Creation Adapter (NEW)
`activateSettingsRuntimeContext(s)` in `packages/core/src/runtime/settingsRuntimeAdapter.ts` creates a `ProviderRuntimeContext` and calls settings-package `registerSettingsService()`. This replaces the old behavior of `registerSettingsService` creating a context.

### BVE-06d: Reset-Settings-State-Only vs Full-Deactivation (NEW)
Settings-package `resetSettingsService()` clears settings-package state and calls `clear()` on previous service. It does NOT call `clearActiveProviderRuntimeContext()`. Tests that previously relied on `resetSettingsService()` also clearing the runtime context must either:
1. Use `deactivateSettingsRuntimeContext()` from core adapter, OR
2. Call both `resetSettingsService()` and `clearActiveProviderRuntimeContext()` explicitly.

### Required Cleanup/Isolation Tests

| Test | Location | Verifies |
|------|----------|----------|
| `settings-register-no-context-creation.test.ts` | `packages/settings` | `registerSettingsService()` does not create runtime context; verifies settings-owned state only |
| `settings-reset-clears-state-only.test.ts` | `packages/settings` | `resetSettingsService()` clears settings state; does NOT assert `ProviderRuntimeContext` (that belongs in core tests) |
| `core-settings-runtime-adapter.test.ts` | `packages/core` | `activateSettingsRuntimeContext()` creates context and registers settings; includes idempotency and call-count tests |
| `core-settings-runtime-adapter-deactivation.test.ts` | `packages/core` | `deactivateSettingsRuntimeContext()` clears context and resets settings; includes double-deactivation and call-count tests |
| `settings-isolation-two-contexts.test.ts` | `packages/core` or root integration | Two contexts with different settings, no stale reads |

## Summary Statistics

| API | Production Direct Import Sites | Test Direct Import Sites | Mock/Vi.fn Sites | Total |
|-----|-------------------------------|-------------------------|-------------------|-------|
| `registerSettingsService` | 1 (`configConstructor.ts`) | 10 | 3 | 14 |
| `resetSettingsService` | 0 | 20 | 1 | 21 |
| `getSettingsService` | 3 (`prompts.ts`, `memoryTool.ts`, `BaseProvider.ts`, `AnthropicProvider.ts`) | 25 | 5 | 33 |

All 68 call sites are classified and have defined migration actions.