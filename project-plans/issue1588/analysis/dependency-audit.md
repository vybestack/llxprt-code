# Dependency Audit

Plan ID: PLAN-20260608-ISSUE1588

## Baseline Observations

Commands run during planning identified the following high-risk facts:

- `packages/core/src/settings/` currently contains 6 files: `SettingsService.ts`, `types.ts`, `settingsRegistry.ts`, `settingsServiceInstance.ts`, `index.ts`, and `settingsRegistry.test.ts`.
- `packages/core/src/config/` contains storage/profile/config code. Extraction candidates are `storage.ts`, `storage.test.ts`, `profileManager.ts`, and `profileManager.test.ts`.
- Search found 189 settings/profile/storage direct import matches across `packages/**` for core settings/config paths.
- Search found 577 provider-package settings references by name or core settings import. Many are tests, but production provider code also uses `SettingsService`, `getSettingsService`, settings registry data, and provider settings access.
- `packages/providers` already exists from issue #1584 and follows the package name `@vybestack/llxprt-code-providers`; settings must follow the same naming pattern.
- Root workspaces include `packages/providers` but not `packages/settings`.
- No `packages/storage` workspace exists.

## Concrete Cycle Blockers

### Blocker 1: Settings Registry Imports Core Compression

File: `packages/core/src/settings/settingsRegistry.ts`

Current dependency:

```text
settingsRegistry.ts -> ../core/compression/types.js -> core compression subsystem
```

This blocks moving registry to settings because it would create `settings -> core`. The plan resolves this by making compression strategy enum values settings-owned registry data or an intentionally duplicated literal list.

Test update required:

```text
packages/core/src/settings/__tests__/settingsRegistry.test.ts
```

The current test imports `COMPRESSION_STRATEGIES` from core compression and must stop doing so after extraction.

### Blocker 2: Settings Service Instance Imports Core Runtime Context

File: `packages/core/src/settings/settingsServiceInstance.ts`

Current dependency:

```text
settingsServiceInstance.ts -> ../runtime/providerRuntimeContext.js
```

Issue #1588 explicitly includes settings service instance management in the move list. Moving it as-is would create `settings -> core`. The plan resolves this by moving instance management to settings and changing core runtime context to call settings activation/register helpers.

### Blocker 3: ProfileManager Imports Core Profile Types

File: `packages/core/src/config/profileManager.ts`

Current dependency:

```text
profileManager.ts -> ../types/modelParams.js
profileManager.ts -> ../settings/SettingsService.js
```

Moving `ProfileManager` requires moving or splitting profile-related data contracts into settings first. Otherwise `settings -> core` is unavoidable.

Important methods to preserve:

- `saveProfile`
- `saveLoadBalancerProfile`
- `loadProfile`
- `listProfiles`
- `deleteProfile`
- `profileExists`
- `save`
- `load`

**Additional core internal consumers of `ProfileManager`:**

- `packages/core/src/config/subagentManager.ts` — types against or imports `ProfileManager`
- `packages/core/src/config/toolRegistryFactory.ts` — may type against `ProfileManager`
- `packages/core/src/tools/task.ts` — imports or types against core-local `ProfileManager`
- `packages/core/src/core/subagentOrchestrator.ts` — imports or types against core-local `ProfileManager`

After `packages/core/src/config/profileManager.ts` is removed in P09, these consumers must import `ProfileManager` from `@vybestack/llxprt-code-settings`. P06 and P08 must explicitly cover all four files.

Resolution: extend P06/P08 tasks to update imports in all core internal ProfileManager consumers. Add verification scan for relative imports of `../config/profileManager.js` and `./profileManager.js` across `packages/core/src`.

### Blocker 4: Core Config Constructor Owns Settings Creation

Files:

- `packages/core/src/config/configBaseCore.ts`
- `packages/core/src/config/configConstructor.ts`
- `packages/core/src/config/configTypes.ts`

These files store and expose `SettingsService`, `ProfileManager`, and `Storage`. They remain in core but must import these classes/types from settings. They must not construct or register settings through old core paths.

### Blocker 5a: LLXPRT_CONFIG_DIR / MemoryTool Coupling

File: `packages/core/src/config/configBaseCore.ts` line 24, `packages/core/src/tools/memoryTool.ts` line 83

Current dependency:

```text
configBaseCore.ts -> memoryTool.ts (imports LLXPRT_CONFIG_DIR)
storage.ts -> defines own LLXPRT_DIR = '.llxprt' (local constant)
```

Resolution: Both files define the same literal constant `.llxprt`. After migration:
- Settings `Storage.ts` keeps its own `LLXPRT_DIR = '.llxprt'` constant (moved from `packages/core/src/config/storage.ts` line 12).
- Core `configBaseCore.ts` replaces the import from `memoryTool.ts` with a local constant `const LLXPRT_DIR = '.llxprt'`.
- Tests prove identical paths without cross-package imports:

```typescript
// packages/settings/src/storage/__tests__/Storage.test.ts
test('LLXPRT_DIR equals .llxprt without importing core/tools', () => {
  expect(LLXPRT_DIR).toBe('.llxprt');
});

// packages/core/src/config/config.test.ts
test('configBaseCore uses local LLXPRT_DIR', () => {
  // configBaseCore.getLlxprtDir() uses local constant, not memoryTool import
  expect(config.getLlxprtDir()).toBe(path.join(targetDir, '.llxprt'));
});
```

No import from memoryTool.ts or settings is needed for this constant.

### Blocker 5: Provider Package Imports Core Settings Paths
Examples:

- `packages/providers/src/BaseProvider.ts` imports `SettingsService` and `getSettingsService` from core settings paths.
- `packages/providers/src/providerConfigKeys.ts` imports `SETTINGS_REGISTRY` from core settings registry.
- Many provider tests import `SettingsService`, `resetSettingsService`, or `registerSettingsService` from core settings paths.

After extraction, providers may depend on `@vybestack/llxprt-code-settings`. This is allowed and improves the graph because providers no longer need core for settings APIs.

### Blocker 6: Core Package Public Exports

`packages/core/package.json` exports settings deep paths today, and core index files export `SettingsService`, settings service instance helpers, `ProfileManager`, and `Storage`. If these remain as wrappers after migration, the extraction becomes a shim instead of a boundary. P09 must remove those exports and scans must prove the old paths are gone.

**Extended blocklist**: Core index also re-exports `Profile`, `StandardProfile`, `LoadBalancerProfile`, `ModelParams`, `EphemeralSettings`, `isLoadBalancerProfile`, `isStandardProfile`, `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile` from `./types/modelParams.js`. Core `package.json` may have `./types/modelParams.js` as a subpath export. All of these must be removed in P09.

**Settings type blocklist**: Core also re-exports `ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `SettingsService` from its root barrel. All of these must be removed in P09. Scans must check for ALL of these in core barrel re-exports and `package.json` subpath exports. Any remaining re-export of these symbols from core after P09 is a forbidden compatibility shim.

## CLI God-Object Deferral Audit

Issue #1588 mentions CLI settings schema/runtime settings after god-object decomposition. The following CLI files/config areas are inventoried for deferral. They remain CLI-owned because they depend on CLI-specific god objects:

| CLI File/Directory | Reason for Deferral |
|---------------------|---------------------|
| `packages/cli/src/config/settingsSchema.ts` (or `.js`) | CLI-specific settings definition for JSON schema generation; used by root scripts but not a settings-registry concern |
| `packages/cli/src/config/postConfigRuntime.ts` | Uses local `getSettingsService()` wrapper; deep integration with CLI god-object config flow |
| `packages/cli/src/runtime/runtimeContextFactory.ts` | CLI startup context wiring depends on CLI god objects |
| `packages/cli/src/runtime/runtimeAccessors.ts` | CLI runtime accessors wrapping core config delegation |
| `packages/cli/src/commands/settings*.ts` (if they exist) | Command-specific settings UI logic depends on CLI command framework |

Consumer migration (P08) updates their imports of moved symbols to settings-package imports, but does NOT move the CLI-specific logic itself.

## a2a-Server Dependency Verification

Inspection of `packages/a2a-server/src/` shows that a2a-server defines its own `Settings` interface and `loadSettings()` function for reading user/workspace settings. It imports `LLXPRT_CONFIG_DIR` from core (via `@vybestack/llxprt-code-core`). However, `LLXPRT_CONFIG_DIR` is defined in `memoryTool.ts`, not a settings-package symbol. After settings extraction, a2a-server still needs `LLXPRT_CONFIG_DIR` from core (or the constant needs to be accessible another way).

To verify this analysis is still correct at implementation time, run:

```bash
# Verify a2a-server does NOT directly import Storage/SettingsService/ProfileManager/getSettingsService/registerSettingsService/resetSettingsService
rg -n "import.*Storage|import.*SettingsService|import.*ProfileManager|import.*getSettingsService|import.*registerSettingsService|import.*resetSettingsService|import.*SETTINGS_REGISTRY" packages/a2a-server/src --glob '*.ts' && echo "FOUND: a2a-server imports settings symbols" || echo "OK: a2a-server does not import settings symbols directly"
# Verify what a2a-server DOES import from core
rg -n "from ['"]@vybestack/llxprt-code-core" packages/a2a-server/src --glob '*.ts'
```

**Conclusion**: a2a-server does NOT need a direct `@vybestack/llxprt-code-settings` dependency. It continues accessing any settings behavior indirectly through core. Its core imports include `LLXPRT_CONFIG_DIR` from `memoryTool.ts` which stays in core.

**Verification required at implementation time**: The above analysis is based on code inspection at planning time. Before P08, the preflight verification MUST run the a2a-server scan commands above and record the actual output to confirm no direct settings imports exist. If any direct settings imports are found, P08 must add a direct `@vybestack/llxprt-code-settings` dependency to a2a-server.

Inspection of `packages/a2a-server/src/` reveals that a2a-server does NOT directly import `Storage`, `SettingsService`, `ProfileManager`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, or any symbols from `modelParams.ts`. Its `config/settings.ts` defines its own `Settings` interface and `loadSettings()` function for reading user/workspace settings JSON — entirely independent of the core `SettingsService` being moved. It imports `LLXPRT_CONFIG_DIR` from core (via `@vybestack/llxprt-code-core`) but this is a `memoryTool.ts` export, not a settings-package symbol.

**Conclusion**: a2a-server does NOT need a direct `@vybestack/llxprt-code-settings` dependency. It continues accessing any settings behavior indirectly through core. If future issues migrate a2a-server's own settings logic, that would require a separate scope decision.

## P01 Preflight Validation

All blockers documented above were cross-verified against P0.5 preflight command output. The preflight scan confirms:

1. **Blocker 1 confirmed**: `settingsRegistry.ts` imports `COMPRESSION_STRATEGIES` from `../core/compression/types.js` line 5, used at line 1093 — exact same dependency as documented.
2. **Blocker 2 confirmed**: `settingsServiceInstance.ts` imports from `../runtime/providerRuntimeContext.js` lines 17-20 — exact same dependency as documented.
3. **Blocker 3 confirmed**: `profileManager.ts` imports `Profile`, `LoadBalancerProfile` from `../types/modelParams.js` lines 9-10 and `isLoadBalancerProfile` line 10, `SettingsService` from `../settings/SettingsService.js` line 11 — all as documented.
4. **Blocker 4 confirmed**: `configBaseCore.ts` imports `type { SettingsService }` line 50, `type { ProfileManager }` line 51, `type { Storage }` line 53. `configConstructor.ts` imports `registerSettingsService` line 65, `SettingsService` line 66, `peekActiveProviderRuntimeContext` line 67 — all as documented.
5. **Blocker 5a confirmed**: Both `storage.ts` (line 12) and `memoryTool.ts` (line 83) define local `.llxprt` constants.
6. **a2a-server false positive clarified**: The preflight grep for `Storage|SettingsService|...` in `packages/a2a-server/src` returned false positives: `Storage` from `@google-cloud/storage`, `AsyncLocalStorage` from `node:async_hooks`, and `requestStorage` from a local module. a2a-server does NOT import any of our settings/config/profile/storage symbols. The preflight `FOUND: a2a-server imports settings symbols` output is a grep-pattern false positive.
7. **Compression strategy values confirmed**: `COMPRESSION_STRATEGIES = ['middle-out', 'top-down-truncation', 'one-shot', 'high-density']` as recorded.
8. **No `packages/storage` exists**: Confirmed by workspace inventory scan.
9. **All modelParams.ts exports identified**: `AuthConfig`, `AuthConfigSchema`, `ModelParams`, `EphemeralSettings`, `LoadBalancerSubProfileConfig`, `LoadBalancerConfig`, `StandardProfile`, `LoadBalancerProfile`, `Profile`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile` — matching the move-map classification.

No preflight findings disproved the documented architectural assumptions. All blockers remain correctly classified with their planned resolutions.

## Deterministic Workspace Dependency Graph Checks

In addition to grep-based import scans, verify the workspace dependency graph is cycle-free and that settings has no forbidden dependencies using deterministic Node.js checks. **These are two separate checks with different scopes:**

**Check 1: Production dependency cycle detection (dependencies ONLY)**. Dev dependency cycles are development-only and non-blocking. Only production cycles — where package A's `dependencies` depends on B and B's `dependencies` depends on A — break runtime.

**Check 2: Settings forbidden-dependency check (dependencies AND devDependencies)**. Settings must not depend on core/providers/CLI/tools/a2a-server even in `devDependencies`, because dev dependency cycles could still pull those packages into the settings build/test environment.

```bash
# Check 1: Production dependency cycle detection (dependencies only)
node -e "
  const fs = require('fs');
  const path = require('path');
  const root = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
  const graph = {};
  for (const ws of root.workspaces) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(ws, 'package.json'), 'utf8'));
      const deps = pkg.dependencies || {};
      graph[pkg.name] = Object.keys(deps).filter(d => d.startsWith('@vybestack/llxprt-code'));
    } catch {}
  }
  // Detect cycles via DFS
  const visited = new Set();
  const stack = new Set();
  function dfs(node) {
    if (stack.has(node)) { console.error('FAIL: production cycle detected involving', node); process.exit(1); }
    if (visited.has(node)) return;
    visited.add(node); stack.add(node);
    for (const dep of (graph[node] || [])) dfs(dep);
    stack.delete(node);
  }
  for (const node of Object.keys(graph)) dfs(node);
  console.log('OK: no production cycles in dependencies-only graph');
  // Print the graph for verification
  for (const [pkg, deps] of Object.entries(graph)) {
    console.log(pkg, '->', deps.join(', ') || '(no workspace production deps)');
  }
}

# Check 2: Settings package forbidden deps (enforcing, both deps and devDeps)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server']; const found=forbidden.filter(n=>d[n]); if(found.length>0){console.error('FAIL: settings has forbidden deps:',found.join(', '));process.exit(1);} console.log('OK: settings has no forbidden deps in dependencies or devDependencies. All deps:', Object.keys(d).join(', ') || 'none');"
```

Run these after P05, P08, and P09 to confirm the dependency graph is cycle-free.

### Note on Dependency Check Scopes

**Check 1** (production cycle detection) uses `dependencies` ONLY because dev dependency cycles are development-only and non-blocking. **Check 2** (settings forbidden-dep check) uses BOTH `dependencies` AND `devDependencies` because dev dependencies can still pull forbidden packages into the settings build/test environment. These are two separate checks with different scopes and different failure conditions. They MUST NOT be merged or conflated.

## Package Dependency Checks Required

Package metadata checks use **Node.js JSON parsing** (e.g., `require('./packages/settings/package.json')`) for exact field comparison, not regex-only patterns. This avoids package-name collision/regex risks (e.g., `@vybestack/llxprt-code` matching `@vybestack/llxprt-code-settings`). Exact JSON parsing is mandatory for all forbidden dependency checks.

```bash
# Settings package forbidden deps (exact JSON parsing for both dependencies and devDependencies)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server']; const found=forbidden.filter(n=>d[n]); if(found.length>0){console.error('FAIL: forbidden deps:',found.join(', '));process.exit(1);} console.log('OK: settings deps clean');"
# Core must depend on settings after migration
node -e "const p=require('./packages/core/package.json'); if(!(p.dependencies||{})['@vybestack/llxprt-code-settings']){console.error('FAIL: core must depend on settings');process.exit(1);} console.log('OK: core depends on settings');"
# Providers must depend on settings after migration
node -e "const p=require('./packages/providers/package.json'); if(!(p.dependencies||{})['@vybestack/llxprt-code-settings']){console.error('FAIL: providers must depend on settings');process.exit(1);} console.log('OK: providers depends on settings');"
```

## Compression Strategy Registry Values

The `compression.strategy` registry key uses `enumValues: [...COMPRESSION_STRATEGIES]` where `COMPRESSION_STRATEGIES` is imported from `packages/core/src/core/compression/types.ts`. After extraction, the settings registry test cannot import `COMPRESSION_STRATEGIES` from core compression. The registry entry must use settings-owned literal values. **Preflight MUST record the exact current `COMPRESSION_STRATEGIES` values** by running:

```bash
# Record exact current compression strategy values (preflight requirement)
grep -A5 'COMPRESSION_STRATEGIES = \[' packages/core/src/core/compression/types.ts
# Expected recorded values: 'middle-out', 'top-down-truncation', 'one-shot', 'high-density'
```

The settings registry test must assert `compression.strategy` enum values match the recorded literals (`'middle-out'`, `'top-down-truncation'`, `'one-shot'`, `'high-density'`) without importing from core compression.

## Forbidden Import Scans

All forbidden-import scans use **enforcing** logic: they capture output into a variable and test for emptiness with explicit fail messages and `exit 1` on non-empty results. Bare `|| true` is NOT used for scans that must return zero matches.

```bash
OLD_PATH_IMPORTS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$OLD_PATH_IMPORTS" && echo "OK: no old path imports" || { echo "FAIL: old path imports found:"; echo "$OLD_PATH_IMPORTS"; exit 1; }

SETTINGS_IMPORTS=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' 2>/dev/null || true)
test -z "$SETTINGS_IMPORTS" && echo "OK: settings has no forbidden imports" || { echo "FAIL: forbidden imports in settings:"; echo "$SETTINGS_IMPORTS"; exit 1; }

# Cross-package import scan (non-settings, for verification)
rg -n "from ['\"].*settings/|from ['\"].*config/(storage|profileManager)" packages/core/src packages/providers/src packages/cli/src packages/a2a-server/src --glob '*.ts' 2>/dev/null || echo "OK: no cross-package imports"
# Root-barrel moved-symbol scan (enforcing)
ROOT_BARREL_IMPORTS=$(rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts' 2>/dev/null || true)
test -z "$ROOT_BARREL_IMPORTS" && echo "OK: no root-barrel moved-symbol imports" || { echo "FAIL: root-barrel moved-symbol imports found:"; echo "$ROOT_BARREL_IMPORTS"; exit 1; }
# Moved profile/model type import scan (enforcing)
PROFILE_TYPE_IMPORTS=$(rg -n "from ['\"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts' 2>/dev/null || true)
test -z "$PROFILE_TYPE_IMPORTS" && echo "OK: no modelParams deep path imports" || { echo "FAIL: modelParams deep path imports found:"; echo "$PROFILE_TYPE_IMPORTS"; exit 1; }
NAMED_PROFILE_IMPORTS=$(rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core" packages --glob '*.ts' 2>/dev/null || true)
test -z "$NAMED_PROFILE_IMPORTS" && echo "OK: no named profile/model type imports from core" || { echo "FAIL: named profile/model type imports from core found:"; echo "$NAMED_PROFILE_IMPORTS"; exit 1; }
# Core relative ProfileManager imports (enforcing)
PROFILEREL_IMPORTS=$(rg -n "from ['\"].*config/profileManager" packages/core/src --glob '*.ts' 2>/dev/null || true)
test -z "$PROFILEREL_IMPORTS" && echo "OK: no core relative profileManager imports" || { echo "FAIL: core relative profileManager imports found:"; echo "$PROFILEREL_IMPORTS"; exit 1; }
# vi.mock and dynamic import path scan (enforcing)
MOCK_IMPORTS=$(rg -n "vi\.mock.*['\"].*settings/|vi\.mock.*['\"].*config/(storage|profileManager)|import\(['\"]@vybestack/llxprt-code-core['\"]\)\.then" packages --glob '*.ts' 2>/dev/null || true)
test -z "$MOCK_IMPORTS" && echo "OK: no old vi.mock/dynamic import paths" || { echo "FAIL: old vi.mock/dynamic import paths found:"; echo "$MOCK_IMPORTS"; exit 1; }
# Deep dynamic import scan (enforcing)
DEEP_DYNAMIC=$(rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$DEEP_DYNAMIC" && echo "OK: no deep dynamic imports of old paths" || { echo "FAIL: deep dynamic imports of old paths found:"; echo "$DEEP_DYNAMIC"; exit 1; }
# Include packages/lsp in scan (enforcing)
LSP_IMPORTS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null || true)
test -z "$LSP_IMPORTS" && echo "OK: no unmigrated LSP imports" || { echo "FAIL: unmigrated LSP imports found:"; echo "$LSP_IMPORTS"; exit 1; }
```

Expected final state: zero old core settings/config import matches for moved APIs, zero settings-to-core/providers/cli imports, zero root-barrel moved-symbol imports, zero moved type imports from core, zero core relative profileManager imports, zero old vi.mock/dynamic import paths, zero deep dynamic imports of old core settings/config paths, and `packages/lsp` has no unmigrated old imports either.
