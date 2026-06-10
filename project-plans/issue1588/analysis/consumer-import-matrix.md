# Consumer Import Matrix

Plan ID: PLAN-20260608-ISSUE1588

## P01 Preflight Import Validation

The P0.5 preflight collected comprehensive import scan output. This section records the key validation findings against the preflight inventory:

### Deep-Path Import Validation (Confirmed)

| Source File | Import Pattern | Count | P08 Migration Required |
|---|---|---|---|
| `packages/providers/src/` | `@vybestack/llxprt-code-core/settings/SettingsService.js` | 25+ production+test files | Yes — all to `@vybestack/llxprt-code-settings` |
| `packages/providers/src/providerConfigKeys.ts` | `@vybestack/llxprt-code-core/settings/settingsRegistry.js` | 1 production file | Yes |
| `packages/providers/src/BaseProvider.ts` | Both `SettingsService` and `getSettingsService` deep paths | 2 imports | Yes |
| `packages/core/src/` internal | Relative `../settings/` and `../config/storage.js`, `../config/profileManager.js` | 19+ Storage consumers, 10+ ProfileManager consumers | Yes |
| `packages/cli/src/` | `@vybestack/llxprt-code-core` root barrel for `Storage`, `ProfileManager`, `Profile`, `SettingsService` | 30+ files | Yes |
| `packages/a2a-server/` | No direct settings/config/profile/storage imports (false positive on `Storage` from `@google-cloud/storage`) | 0 | No direct migration needed |

### vi.mock Path Inventory (Confirmed)

| File | vi.mock Target | P08 Action |
|---|---|---|
| `packages/core/src/config/config.test.ts` | `../settings/settingsServiceInstance.js` | Update to `@vybestack/llxprt-code-settings/settings/settingsServiceInstance.js` or local path |
| `packages/core/src/policy/policy-updater.test.ts` | `../config/storage.js` | Update |
| `packages/core/src/policy/persistence.test.ts` | `../config/storage.js` | Update |
| `packages/core/src/code_assist/oauth2.test.ts` | `../config/storage.js` | Update |
| `packages/core/src/mcp/file-token-store.test.ts` | `../config/storage.js` | Update |
| `packages/core/src/lsp/__tests__/system-integration.test.ts` | `../../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/lsp/__tests__/e2e-lsp.test.ts` | `../../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/config/config-lsp-integration.test.ts` | `../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/core/prompts.coreMemory.test.ts` | `../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/integration-tests/provider-settings-integration.spec.ts` | `../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/integration-tests/profile-integration.test.ts` | `../settings/settingsServiceInstance.js` | Update |
| `packages/core/src/tools/memoryTool.test.ts` | `../settings/settingsServiceInstance.js` | Update |

### Root-Barrel Moved-Symbol Import Inventory (Confirmed)

The preflight root-barrel scan confirmed 60+ consumer import statements across `packages/cli`, `packages/core`, and `packages/providers` that import moved symbols from `@vybestack/llxprt-code-core`. These must all be migrated in P08 to `@vybestack/llxprt-code-settings`.

### Core Internal ProfileManager Consumer Inventory (Confirmed)

| Core File | Import Pattern |
|---|---|
| `packages/core/src/config/subagentManager.ts` | `import type { ProfileManager } from './profileManager.js'` |
| `packages/core/src/config/toolRegistryFactory.ts` | `import { ProfileManager } from './profileManager.js'` |
| `packages/core/src/config/configBaseCore.ts` | `import type { ProfileManager } from './profileManager.js'` |
| `packages/core/src/tools/task.ts` | `import type { ProfileManager } from '../config/profileManager.js'` |
| `packages/core/src/core/subagentOrchestrator.ts` | `import type { ProfileManager } from '../config/profileManager.js'` |
| `packages/core/src/index.ts` | `export * from './config/profileManager.js'` |
| `packages/core/src/config/profileManager.test.ts` | `import { ProfileManager } from './profileManager.js'` |
| `packages/core/src/config/test/subagentManager.test.ts` | `import { ProfileManager } from '../profileManager.js'` |
| `packages/core/src/integration-tests/profile-integration.test.ts` | `import { ProfileManager } from '../config/profileManager.js'` |
| `packages/core/src/core/subagentOrchestrator.test.ts` | `import type { ProfileManager } from '../config/profileManager.js'` |

All must be migrated after `ProfileManager` moves to `@vybestack/llxprt-code-settings`.

### modelParams Deep-Path Import Inventory (Confirmed)

| File | Import |
|---|---|
| `packages/providers/src/LoadBalancingProvider.ts` | `import type { Profile } from '@vybestack/llxprt-code-core/types/modelParams.js'` |
| `packages/core/src/integration-tests/profile-integration.test.ts` | `import type { Profile } from '../types/modelParams.js'` |
| `packages/core/src/index.ts` | `export * from './types/modelParams.js'` |
| `packages/core/src/config/profileManager.test.ts` | `import type { Profile, LoadBalancerProfile } from ../types/modelParams.js` |
| `packages/core/src/config/profileManager.ts` | `import type { Profile, LoadBalancerProfile } + import { isLoadBalancerProfile } from ../types/modelParams.js` |
| `packages/core/src/core/subagentOrchestrator.ts` | `import type { Profile } from ../types/modelParams.js` |
| `packages/core/src/core/subagentOrchestrator.test.ts` | `import type { Profile } from ../types/modelParams.js` |
| Multiple CLI files | `import type { Profile } from '@vybestack/llxprt-code-core'` (root barrel) |
| Multiple CLI files | `import type { LoadBalancerProfile } from '@vybestack/llxprt-code-core'` (root barrel) |

### LSP Package Import Validation (Confirmed)

The `packages/lsp` directory was not explicitly included in the preflight's a2a-server scan but is covered by the general `packages` grep patterns. The consumer import matrix scan commands explicitly include `packages/lsp` in verification. No direct settings/config/profile/storage imports were found in `packages/lsp` based on the preflight data.

## Root-Barrel Import Inventory

Consumers importing moved symbols from the core root barrel `@vybestack/llxprt-code-core` (not deep paths) must be migrated explicitly. The following symbols are confirmed as moved from core root to settings package:

| Moved Symbol | Core Root Export Used By | Migration Action |
|---|---|---|
| `SettingsService` | CLI tests, provider tests, core config | Change to `@vybestack/llxprt-code-settings` |
| `getSettingsService` | Provider production/tests, CLI runtime | Change to `@vybestack/llxprt-code-settings` |
| `registerSettingsService` | Core config constructor, tests | Change to `@vybestack/llxprt-code-settings` |
| `resetSettingsService` | Provider tests, CLI tests | Change to `@vybestack/llxprt-code-settings` |
| `SETTINGS_REGISTRY` | Provider production (`providerConfigKeys`) | Change to `@vybestack/llxprt-code-settings` |
| `ProfileManager` | CLI tests/production | Change to `@vybestack/llxprt-code-settings` |
| `Storage` | CLI tests/production, a2a-server | Change to `@vybestack/llxprt-code-settings` |
| `Profile` | Core subagent code, providers | Change to `@vybestack/llxprt-code-settings` |
| `StandardProfile` | Core subagent code, CLI | Change to `@vybestack/llxprt-code-settings` |
| `LoadBalancerProfile` | Core subagent code | Change to `@vybestack/llxprt-code-settings` |
| `isLoadBalancerProfile` | Core subagent code | Change to `@vybestack/llxprt-code-settings` |
| `isStandardProfile` | Core/config code | Change to `@vybestack/llxprt-code-settings` |
| `ModelParams` | Providers, core config | Change to `@vybestack/llxprt-code-settings` |
| `EphemeralSettings` | Core settings, providers | Change to `@vybestack/llxprt-code-settings` |
| `hasAuthConfig` | Core subagent code | Change to `@vybestack/llxprt-code-settings` |
| `isOAuthProfile` | Core subagent code | Change to `@vybestack/llxprt-code-settings` |
| `AuthConfig` / `AuthConfigSchema` | Core config, settings registry | Change to `@vybestack/llxprt-code-settings` |
| `ISettingsService` | Provider tests, core consumers | Change to `@vybestack/llxprt-code-settings` |
| `GlobalSettings` | Core config, provider consumers | Change to `@vybestack/llxprt-code-settings` |
| `SettingsChangeEvent` | Core settings, event consumers | Change to `@vybestack/llxprt-code-settings` |
| `ProviderSettings` | Provider production/tests | Change to `@vybestack/llxprt-code-settings` |
| `UISettings` | CLI UI hooks | Change to `@vybestack/llxprt-code-settings` |
| `AdvancedSettings` | Core config | Change to `@vybestack/llxprt-code-settings` |
| `EventListener` | Core event consumers | Change to `@vybestack/llxprt-code-settings` |
| `EventUnsubscribe` | Core event consumers | Change to `@vybestack/llxprt-code-settings` |
| `SettingsTelemetrySettings` | Core telemetry | Change to `@vybestack/llxprt-code-settings` |
| `DiagnosticsInfo` | Core diagnostics consumers | Change to `@vybestack/llxprt-code-settings` |

### Root-Barrel Import Scan Commands

Detect named imports of moved symbols from core root barrel:

```bash
rg -n "import.*\{[^}]*(SettingsService|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY|ProfileManager|Storage|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|ModelParams|EphemeralSettings|hasAuthConfig|isOAuthProfile|AuthConfig|AuthConfigSchema|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'
```

Expected: final state zero matches for moved symbols from core root.

### Complete Core-Relative Storage Import Inventory

The following files import `Storage` from core-relative paths and MUST be migrated in P08 before P09 deletes `packages/core/src/config/storage.ts`:

| File | Import Path | Migration Target |
|------|-------------|-----------------|
| `packages/core/src/policy/config.ts` | `../config/storage.js` or `./storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/policy/config.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/policy/policy-updater.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/policy/persistence.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/services/gitService.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/services/gitService.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/skills/skillManager.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/skills/skillManager.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/hooks/trustedHooks.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/hooks/hookSystem.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/hooks/hookRegistry.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/storage/SessionPersistenceService.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/storage/SessionPersistenceService.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/models/registry.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/mcp/file-token-store.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/mcp/file-token-store.test.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/utils/installationManager.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/utils/userAccountManager.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/code_assist/oauth-credential-storage.ts` | `../config/storage.js` | `@vybestack/llxprt-code-settings` |

These must be inventoried before P08 begins using:

```bash
rg -n "from ['"].*(config/storage|\.\./config/storage|\./storage)" packages/core/src --glob '*.ts'
rg -n "vi\.mock\(['"].*config/storage" packages/core/src --glob '*.ts'
```

### Complete Core-Relative Settings Import Inventory

The following files import settings module files via relative paths within core and MUST be migrated before P09 deletes `packages/core/src/settings/`:

| File | Import Path | Migration Target |
|------|-------------|-----------------|
| `packages/core/src/integration-tests/settings-remediation.test.ts` | `../settings/settingsServiceInstance.js`, `../settings/SettingsService.js` | `@vybestack/llxprt-code-settings` |
| `packages/core/src/lsp/__tests__/system-integration.test.ts` | `../../settings/settingsServiceInstance.js` (vi.mock) | `@vybestack/llxprt-code-settings` |
| `packages/core/src/lsp/__tests__/e2e-lsp.test.ts` | `../../settings/settingsServiceInstance.js` (vi.mock) | `@vybestack/llxprt-code-settings` |
| `packages/core/src/utils/shell-utils.shellReplacement.test.ts` | `../settings/SettingsService.js` | `@vybestack/llxprt-code-settings` |

These must be inventoried before P08 begins using:

```bash
rg -n "from ['"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)|vi\.mock\(['"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)" packages/core/src --glob '*.ts'
```

P08 migration tasks must explicitly update every file in both inventories. P09 enforcing scans must confirm zero remaining relative `config/storage` and `settings/` imports in core.

Deep-path and root-barrel imports of moved profile/model types:

```bash
rg -n "from ['"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'
```

Expected: zero after P09. If core `index.ts` continues to re-export these types, that is a compatibility shim violation.

### Dynamic Import And Mock Path Scan

Old import paths also appear in `vi.mock()` and dynamic `import()` calls:

```bash
rg -n "vi\.mock.*['"].*settings/|vi\.mock.*['"].*config/(storage|profileManager)|import\(['"]@vybestack/llxprt-code-core['"]\)" packages --glob '*.ts'
```

Expected: zero matches after migration; any found during P08 must be migrated alongside static imports. Deep dynamic imports of old core settings/config paths (e.g., `import('@vybestack/llxprt-code-core/settings/...')`) must also be caught and migrated.

## Consumer Groups

| Consumer | Current Relationship | Target Relationship | Required Action |
|----------|----------------------|---------------------|-----------------|
| Core runtime | imports core-local settings | imports settings package | Update runtime context/config constructor imports |
| Core config | owns `Storage`, `ProfileManager`, `SettingsService` references | imports settings-owned classes | Update imports while keeping `Config` behavior |
| Providers production | imports core settings deep paths | imports settings package | Add dependency and migrate imports |
| Providers tests | many direct settings instances and singleton mocks | imports settings package | Add dependency and update mocks/imports |
| CLI | imports core settings/profile/storage directly or through config | imports settings package for moved APIs | Add dependency and update imports without moving CLI-specific logic |
| a2a-server | mostly uses core config storage field | indirect through core or direct settings dependency if needed | Preserve behavior; add direct dependency only if imports require it |
| test-utils | may construct runtime settings/config | direct settings imports if needed | Update tests/utilities |
| lsp | uses core config/settings indirectly or directly | must be scanned and migrated if direct imports exist | Add dependency only if direct imports found; include in P08 scan explicitly |

## Core Files To Inspect/Migrate

- `packages/core/src/runtime/providerRuntimeContext.ts`
- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/config/configConstructor.ts`
- `packages/core/src/config/configTypes.ts`
- `packages/core/src/config/config.ts`
- `packages/core/src/config/subagentManager.ts` — imports `ProfileManager` type
- `packages/core/src/config/toolRegistryFactory.ts` — may type against `ProfileManager`
- `packages/core/src/tools/task.ts` — imports or types against core-local `ProfileManager`
- `packages/core/src/core/subagentOrchestrator.ts` — imports or types against core-local `ProfileManager`
- `packages/core/src/index.ts`
- `packages/core/index.ts`
- `packages/core/package.json`
- `packages/core/tsconfig.json`

### Core Relative Import Scan For ProfileManager

```bash
rg -n "from ['"].*\.\./config/profileManager|from ['"].*\.\/profileManager|from ['"].*config/profileManager\.js" packages/core/src --glob '*.ts'
```

Expected: zero after P09. All core internal `ProfileManager` consumers must be migrated to `@vybestack/llxprt-code-settings`.

## Providers Files To Inspect/Migrate

Known production examples:

- `packages/providers/src/BaseProvider.ts`
- `packages/providers/src/providerConfigKeys.ts`
- `packages/providers/src/anthropic/AnthropicProvider.ts`
- `packages/providers/src/openai/getOpenAIProviderInfo.ts`
- `packages/providers/src/openai/OpenAIProvider.ts`
- `packages/providers/src/openai-responses/OpenAIResponsesProviderBase.ts`
- `packages/providers/src/openai-vercel/OpenAIVercelProvider.ts`

Provider tests extensively import `SettingsService` and singleton helpers; P08 must update tests and mocks consistently.

## CLI Files To Inspect/Migrate

Search during P01/P08 rather than relying on this non-exhaustive list:

```bash
rg -n "SettingsService|settingsRegistry|ProfileManager|Storage|settingsServiceInstance|@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages/cli/src --glob '*.ts'
```

CLI-specific settings schema/runtime files are not moved in this issue unless P01 proves they are already decoupled from CLI concerns and the plan is updated.

## Import Style Decision

The settings package supports both root and subpath imports (see `analysis/package-metadata-constraints.md` for the mandatory exports map):

**Root package imports** (preferred for most consumers):

```typescript
import { SettingsService, getSettingsService } from '@vybestack/llxprt-code-settings';
```

**Subpath imports** (for tree-shaking or grouped module access):

```typescript
import { SettingsService } from '@vybestack/llxprt-code-settings/settings/SettingsService.js';
```

Root imports are the **default and preferred** style. Subpath imports are allowed only when specifically justified by tree-shaking or grouped module access needs. Both styles are verified at build time and runtime. Do not import through core for moved APIs. Migration phases (P06/P07/P08) should use root imports unless a subpath is required for a documented reason.

**Export map justification**: The settings package subpath exports use richer `{types, import}` objects in `package.json`, matching the format already used by `packages/providers`. While some providers subpaths currently use simpler string exports, the settings package follows the more complete {types, import} pattern for consistency with its own mandatory export map specification. This is explicitly justified, not an inconsistency.

### Settings Package Test Import Constraint

`packages/settings` tests MUST NOT import any consumer package (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-a2a-server`) even as dev-only test fixtures. This includes test helper files, mock factories, and vi.mock paths that reference consumer packages. Integration tests that exercise cross-package consumption paths belong in the owning consumer package, not in settings.

## Verification Matrix

| Check | Command | Expected |
|-------|---------|----------|
| No old settings deep imports | `rg -n "@vybestack/llxprt-code-core/settings" packages --glob '*.ts'` | zero |
| No old storage/profile deep imports | `rg -n "@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'` | zero |
| No moved symbols from core root barrel | `rg -n "import.*\{[^}]*(SettingsService\|ProfileManager\|Storage\|ModelParams\|Profile\|StandardProfile\|LoadBalancerProfile\|EphemeralSettings\|SETTINGS_REGISTRY\|getSettingsService\|registerSettingsService\|resetSettingsService)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'` | zero |
| No core relative ProfileManager imports | `rg -n "from ['"].*config/profileManager" packages/core/src --glob '*.ts'` | zero |
| No vi.mock with old paths | `rg -n "vi\.mock.*['"].*settings/\|vi\.mock.*['"].*config/(storage\|profileManager)" packages --glob '*.ts'` | zero |
| No dynamic imports of moved symbols | `rg -n "import\(['"]@vybestack/llxprt-code-core['"]\)\.then" packages --glob '*.ts'` | zero |
| No deep dynamic imports of old core settings/config paths | `rg -n "import\(['"]@vybestack/llxprt-code-core/settings/|import\(['"]@vybestack/llxprt-code-core/config/(storage\|profileManager)" packages --glob '*.ts'` | zero |
| Settings not importing core | `rg -n "@vybestack/llxprt-code-core\|../core\|../../core" packages/settings/src --glob '*.ts'` | zero |
| LSP package no unmigrated old imports | `rg -n "@vybestack/llxprt-code-core/settings\|@vybestack/llxprt-code-core/config/(storage\|profileManager)\|import.*SettingsService\|import.*ProfileManager" packages/lsp --glob '*.ts'` | zero after P08/P09 |
| Providers declare settings dep | package metadata check | present |
| Core declares settings dep | package metadata check | present |
| CLI declares settings dep if direct imports remain | package metadata check | present if needed |
