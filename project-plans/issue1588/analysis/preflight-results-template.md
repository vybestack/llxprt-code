## Preflight Results Template

Plan ID: PLAN-20260608-ISSUE1588

Copy this file to `analysis/preflight-results.md` during Phase 0.5 and paste actual command outputs. Do not begin P03 until this artifact is populated and verified.

### Compression Strategy Preflight Values

Record the exact current `COMPRESSION_STRATEGIES` values. Settings registry tests MUST assert these as literal strings without importing core compression:

```bash
echo "=== COMPRESSION_STRATEGIES values ==="
grep -A5 'COMPRESSION_STRATEGIES = \[' packages/core/src/core/compression/types.ts
```

### a2a-Server Dependency Verification

Verify a2a-server import status with actual scan output (not assumptions):

```bash
echo "=== a2a-server settings symbol imports ==="
rg -n "import.*Storage|import.*SettingsService|import.*ProfileManager|import.*getSettingsService|import.*registerSettingsService|import.*resetSettingsService|import.*SETTINGS_REGISTRY" packages/a2a-server/src --glob '*.ts' && echo "FOUND: a2a-server imports settings symbols" || echo "OK: a2a-server does not import settings symbols directly"
echo "=== a2a-server core imports ==="
rg -n "from ['"]@vybestack/llxprt-code-core" packages/a2a-server/src --glob '*.ts'
```

### Node JSON Package Metadata Reads

Package metadata verification uses Node.js `require()` for local JSON reads (acceptable for file-system JSON reads, not ESM package imports). This avoids regex-only package name matching that could miss substring collisions (e.g., `@vybestack/llxprt-code` matching `@vybestack/llxprt-code-settings`). All forbidden dependency checks and package metadata lookups MUST use Node JSON parsing.

## Branch And Workspace

```bash
git status --short
git branch --show-current
```

Expected: branch `issue1588`, no unrelated uncommitted changes except plan artifacts.

## Workspace Package Inventory

```bash
node -e "const p=require('./package.json'); console.log(p.workspaces.join('\n'))"
find packages -maxdepth 2 -name package.json -print | sort
```

Expected: no existing `packages/settings` before implementation unless a prior phase created it; no `packages/storage` workspace currently.

## Package Convention Baseline

```bash
cat packages/providers/package.json
cat packages/providers/tsconfig.json
cat packages/providers/vitest.config.ts
cat packages/providers/index.ts
cat packages/providers/src/index.ts
```

Expected: settings package scaffold follows this convention with package name `@vybestack/llxprt-code-settings`.

## Settings Source Inventory

```bash
find packages/core/src/settings -maxdepth 3 -type f | sort
find packages/core/src/config -maxdepth 2 -type f | sort
```

Expected: confirms current source/test files before moving.

## Type/Interface Verification

```bash
sed -n '1,260p' packages/core/src/settings/types.ts
sed -n '1,260p' packages/core/src/settings/SettingsService.ts
sed -n '1,260p' packages/core/src/settings/settingsRegistry.ts
sed -n '1,180p' packages/core/src/settings/settingsServiceInstance.ts
sed -n '1,260p' packages/core/src/config/profileManager.ts
sed -n '1,260p' packages/core/src/config/storage.ts
sed -n '1,340p' packages/core/src/types/modelParams.ts
```

Paste output summaries and note any divergence from this plan.

## Dependency Blocker Verification

```bash
rg -n "COMPRESSION_STRATEGIES|providerRuntimeContext|types/modelParams|SettingsService|ProfileManager|Storage" packages/core/src/settings packages/core/src/config packages/core/src/types --glob '*.ts'
```

Expected: confirms concrete blockers before coding.

## Consumer Import Inventory

```bash
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|from ['\"].*settings/|from ['\"].*config/(storage|profileManager)" packages --glob '*.ts'
# Include packages/lsp explicitly
rg -n "SettingsService|ProfileManager|Storage|settingsServiceInstance|@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages/lsp --glob '*.ts'
```

Paste output or store full output in a referenced artifact if too large.

## Root-Barrel Import Inventory

```bash
rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts'
```

Record all consumers importing moved symbols from core root barrel.

## Dynamic Import And vi.mock Path Inventory

```bash
rg -n "vi\.mock.*['\"].*settings/|vi\.mock.*['\"].*config/(storage|profileManager)|import\(['\"]@vybestack/llxprt-code-core['\"]\)\.then" packages --glob '*.ts'
# Scan for direct deep dynamic imports of old core settings/config paths
rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'
```

Record old import paths in test mocks and dynamic imports.

## Core Internal ProfileManager Consumers

```bash
rg -n "from ['\"].*\.\./config/profileManager|from ['\"].*\.\/profileManager|from ['\"].*config/profileManager\.js" packages/core/src --glob '*.ts'
```

Record all core files importing ProfileManager relatively.

## modelParams Type Consumer Inventory

Before moving or deleting `packages/core/src/types/modelParams.ts`, preflight MUST record the complete symbol list from the file. This list is the authoritative source for what must be migrated:

```bash
# Record the complete symbol list from modelParams.ts
echo "=== modelParams.ts Symbol List ==="
grep -n "^export " packages/core/src/types/modelParams.ts
echo "=== End Symbol List ==="
```

Expected symbols: `AuthConfig`, `AuthConfigSchema`, `ModelParams`, `EphemeralSettings`, `LoadBalancerSubProfileConfig`, `LoadBalancerConfig`, `StandardProfile`, `LoadBalancerProfile`, `Profile`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`. Any additional symbols must be included in the migration plan.

Record all consumers of modelParams types (deep and root imports):

```bash
rg -n "from ['"]@vybestack/llxprt-code-core/types/modelParams|from ['"].*types/modelParams" packages --glob '*.ts'
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['"]@vybestack/llxprt-code-core['"]" packages --glob '*.ts'
```

Before moving or deleting `packages/core/src/types/modelParams.ts`, preflight MUST record the complete symbol list from the file. This list is the authoritative source for what must be migrated:

```bash
# Record the complete symbol list from modelParams.ts
echo "=== modelParams.ts Symbol List ==="
grep -n "^export " packages/core/src/types/modelParams.ts
echo "=== End Symbol List ==="
```

Expected symbols: `AuthConfig`, `AuthConfigSchema`, `ModelParams`, `EphemeralSettings`, `LoadBalancerSubProfileConfig`, `LoadBalancerConfig`, `StandardProfile`, `LoadBalancerProfile`, `Profile`, `isLoadBalancerProfile`, `isStandardProfile`, `hasAuthConfig`, `isOAuthProfile`. Any additional symbols must be included in the migration plan.

Record all consumers of modelParams types (deep and root imports):

```bash
rg -n "from ['\"]@vybestack/llxprt-code-core/types/modelParams|from ['\"].*types/modelParams" packages --glob '*.ts'
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts'
```

Record all consumers of modelParams types (deep and root imports).

## Test Infrastructure Verification

```bash
npm run test --workspace @vybestack/llxprt-code-core -- --run src/settings src/config/storage.test.ts src/config/profileManager.test.ts
npm run test --workspace @vybestack/llxprt-code-providers -- --run src/BaseProvider.test.ts src/providerConfigKeys.ts
```

If targeted commands differ due current vitest CLI behavior, record the actual command used and result.

## Package Convention Baseline: tsconfig/vitest

```bash
cat packages/providers/tsconfig.json | grep -A5 '"paths"'
cat packages/providers/vitest.config.ts | head -40
# ALSO check CLI tsconfig for existing path aliases (P03b must add settings aliases to CLI too)
cat packages/cli/tsconfig.json | grep -A10 '"paths"'
```

Record current alias patterns so settings alias updates match exactly.

## Root-Script Inventory

```bash
node -e "const p=require('./package.json'); const s={...p.scripts}; for (const k of Object.keys(s)) { if (k.includes('settings') || k.includes('schema') || k.includes('docs')) console.log(k, s[k]); }"
```

Record whether `predocs:settings`, `schema:settings`, `docs:settings` scripts exist and what paths they reference.

## Blocking Issues Found

- [ ] No `packages/storage` exists; plan uses internal settings storage module.
- [ ] `settingsServiceInstance.ts` imports core runtime context; must be redesigned before moving.
- [ ] `ProfileManager` imports core profile types; profile types must move/split first.
- [ ] `settingsRegistry` imports core compression constant; registry must own values.
- [ ] CLI god-object decomposition prerequisite is not complete; CLI-specific schema/runtime logic remains CLI-owned unless plan is updated.
- [ ] `modelParams.ts` must be deleted entirely; all symbols move to settings; no partial-file shim.
- [ ] Core root barrel re-exports of moved symbols must be removed (not left as compatibility shims).
- [ ] Core internal ProfileManager consumers (`subagentManager.ts`, `toolRegistryFactory.ts`, `tools/task.ts`, `subagentOrchestrator.ts`) must be migrated.
- [ ] Downstream tsconfig/vitest alias patterns for settings must be established before cross-package imports work.
- [ ] `zod` is confirmed as a required production dependency for settings (used by `AuthConfigSchema`).
- [ ] Root docs/schema scripts may reference moved core paths that need updating.
- [ ] Settings package test command (`vitest run`) must discover tests in nested directories (`src/profiles/__tests__`, `src/storage/__tests__`), not just `src/__tests__`.
- [ ] CLI tsconfig/vitest path patterns recorded so P03b can add settings aliases.

## npm vs pnpm Stance Evidence

- [ ] `package-lock.json` exists at root (confirms npm is the active package manager).
- [ ] `pnpm-lock.yaml` does not exist (confirms pnpm is not the active package manager).
- [ ] `npm run test` succeeds from root directory.
- [ ] Workspace-level test commands using `--workspace` flag work correctly.

## Workspace Test Command Verification

- [ ] `npm run test --workspace @vybestack/llxprt-code-core -- --run src/settings` works (workspace-relative path from core cwd).
- [ ] `npm run test --workspace @vybestack/llxprt-code-providers -- --run src/BaseProvider.test.ts` works (workspace-relative path from providers cwd).
- [ ] Root-absolute paths like `--run packages/core/src/...` from workspace commands are NOT used (they fail because workspace cwd is the package directory).

## Verification Gate

- [ ] All dependencies verified
- [ ] Type definitions match plan assumptions or plan updated
- [ ] Call paths verified
- [ ] Test infrastructure verified
- [ ] Blockers have explicit phase resolution
- [ ] Root-barrel import inventory complete
- [ ] modelParams type consumer inventory complete
- [ ] Dynamic import/vi.mock path inventory complete (including deep dynamic imports)
- [ ] Core internal ProfileManager consumer inventory complete
- [ ] tsconfig/vitest alias baseline recorded
- [ ] Root docs/schema script inventory recorded
- [ ] npm vs pnpm stance evidence recorded
- [ ] Workspace test command paths verified (workspace-relative, not root-absolute)
- [ ] `packages/lsp` included in downstream import scan
