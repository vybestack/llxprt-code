# Boundary Verification Script Specification

Plan ID: PLAN-20260608-ISSUE1588

## Purpose

Define a reusable boundary verification script (`scripts/check-settings-boundary.js`) that consolidates the repeated inline shell scans across multiple verification phases into a single authoritative, checked-in script. This eliminates drift between phases and ensures enforcement is consistent.

## Script Location

`scripts/check-settings-boundary.js` — checked into the repository as a runnable Node.js script.

## Required Checks

The script MUST implement the following checks, each exiting 1 on failure and 0 on success. All checks use `rg -n` (line-level output for diagnosability) and capture-and-check-empty enforcement patterns.

### 1. Settings Source Forbidden Imports

```bash
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' --glob '*.tsx'
```

Exit 1 if output is non-empty. Message: `FAIL: forbidden imports in settings src`.

### 2. Settings All Files Forbidden Imports

```bash
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx'
```

Exit 1 if output is non-empty. Message: `FAIL: forbidden imports in settings package`.

### 3. Settings Package Metadata Forbidden Dependencies

Node.js script reading `packages/settings/package.json`, checking both `dependencies` and `devDependencies` for `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-a2a-server`. Exit 1 if any found. Message: `FAIL: forbidden deps: <list>`.

### 4. tsconfig.json Forbidden References

Check `packages/settings/tsconfig.json` for references to core/providers/cli. Exit 1 if found. Message: `FAIL: tsconfig has core/providers/cli references`.

### 5. vitest.config.ts Forbidden Aliases

Check `packages/settings/vitest.config.ts` for forbidden workspace aliases. Warn only (not a hard failure) since some test configs may need provider fixtures.

### 6. Export Map Style Verification

Node.js script verifying all subpath exports in `packages/settings/package.json` use `{types, import}` objects, not bare strings. Exit 1 if any bare string found. Message: `FAIL: bare string export for <key>`.

### 7. Old-Path Import Scan

```bash
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'
```

Exit 1 if output is non-empty. Message: `FAIL: old path imports found`.

### 8. Root-Barrel Moved-Symbol Import Scan

Uses the canonical blocklist from `analysis/anti-shim-policy.md`:
`ISettingsService`, `GlobalSettings`, `SettingsChangeEvent`, `ProviderSettings`, `UISettings`, `AdvancedSettings`, `EventListener`, `EventUnsubscribe`, `SettingsTelemetrySettings`, `DiagnosticsInfo`, `SettingsService`, `ProfileManager`, `Storage`, `ModelParams`, `Profile`, `StandardProfile`, `LoadBalancerProfile`, `EphemeralSettings`, `getSettingsService`, `registerSettingsService`, `resetSettingsService`, `SETTINGS_REGISTRY`, `AuthConfig`, `AuthConfigSchema`, `hasAuthConfig`, `isOAuthProfile`, `isLoadBalancerProfile`, `isStandardProfile`, `LoadBalancerConfig`, `LoadBalancerSubProfileConfig`.

The script MUST include `LoadBalancerConfig` and `LoadBalancerSubProfileConfig` in the symbol pattern. Excludes settings package imports (which are legitimate new-path imports).

```bash
rg -n "import.*\{[^}]*(<SYMBOL>)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts'
```

Exit 1 if output is non-empty. Message: `FAIL: root-barrel moved-symbol imports found`.

### 9. Anti-Shim/Compatibility File Scan

Check for compatibility-named files: `(SettingsService|ProfileManager|Storage)(V2|New|Compat|Wrapper|Copy)\.(ts|tsx)$`. Exit 1 if found. Message: `FAIL: compatibility-named files found`.

### 10. Core Re-Export Scan (Post-P09 only)

Check that core barrel (`packages/core/src/index.ts`, `packages/core/index.ts`) does not re-export any blocklist symbols. Exit 1 if found. Message: `FAIL: core re-exports moved symbols`.

### 11. Core modelParams Subpath Export Scan (Post-P09 only)

Check `packages/core/package.json` for `modelParams` subpath export. Exit 1 if found. Message: `FAIL: modelParams subpath export found`.

### 12. Core Relative Settings Import Scan

```bash
rg -n "from ['"].*settings/(SettingsService|settingsServiceInstance|settingsRegistry)|from ['"].*\.\./settings/" packages/core/src --glob '*.ts'
```

Exit 1 if output is non-empty (enforced from P09 onward). Before P09, report only.

### 13. Core Relative Config/Storage Import Scan

```bash
rg -n "from ['"].*(config/storage|config/profileManager)|vi\.mock\(['"].*config/storage|vi\.mock\(['"].*config/profileManager" packages/core/src --glob '*.ts'
```

Exit 1 if output is non-empty (enforced from P09 onward). Before P09, report only.

### 14. vi.mock Path Scan for Old Settings/Storage Paths

```bash
rg -n "vi\.mock\(['"].*(settings/SettingsService|settings/settingsServiceInstance|settings/settingsRegistry|config/storage|config/profileManager)" packages --glob '*.ts'
```

Exit 1 if output is non-empty after P08 migration. Includes relative and package-relative mock paths.

### 15. Dynamic Import Path Scan for Old Settings/Storage Deep Paths

```bash
rg -n "import\(['"].*(@vybestack/llxprt-code-core/settings/|@vybestack/llxprt-code-core/config/(storage|profileManager))" packages --glob '*.ts'
```

Exit 1 if output is non-empty after P09. Catches `import('@vybestack/llxprt-code-core/settings/SettingsService.js')` and similar dynamic imports.

### 16. ProviderRuntimeContext Settings-Agnostic Rule

```bash
rg -n "SettingsService|registerSettingsService|resetSettingsService|getSettingsService|from ['"]@vybestack/llxprt-code-settings" packages/core/src/runtime/providerRuntimeContext.ts 2>/dev/null
```

Exit 1 if output is non-empty. `providerRuntimeContext.ts` must not import or reference settings-package types/functions.

### 17. No packages/storage Verification

```bash
test ! -d packages/storage && echo "OK: no packages/storage directory" || { echo "FAIL: packages/storage directory exists"; exit 1; }
node -e "const p=require('./package.json'); if(p.workspaces&&p.workspaces.includes('packages/storage')){console.error('FAIL: packages/storage in workspaces');process.exit(1);} console.log('OK: no packages/storage in workspaces');"
```

Exit 1 if `packages/storage` exists on disk or in workspaces array.

### 18. Core Barrel Shim Export Scan (Post-P09)

```bash
rg -n "export.*\{[^}]*(SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile|LoadBalancerConfig|LoadBalancerSubProfileConfig)[^}]*\}" packages/core/src/index.ts packages/core/index.ts
```

Exit 1 if output is non-empty (enforced from P09 onward).

### 19. settingsRuntimeAdapter Single-Owner Bridge Scan

This check enforces the single-owner rule: only `settingsRuntimeAdapter.ts` may bridge settings-package singleton functions AND core runtime-context functions. It is aware of aliased imports, multiline imports, and wrapper function names.

Logic:
1. Parse full file content for import specifiers and function identifiers.
2. Find files that import both settings-package singleton functions (`registerSettingsService`/`resetSettingsService`/`getSettingsService`) AND core runtime-context functions (`setActiveProviderRuntimeContext`/`clearActiveProviderRuntimeContext`/`createProviderRuntimeContext`).
3. Check for aliased imports (e.g., `import { registerSettingsService as reg } from '...'`).
4. Check for re-exported bridge helpers or wrapper function names.
5. Exclude `settingsRuntimeAdapter.ts` itself, test files, and type-only imports.
6. Also explicitly check for `getActiveProviderRuntimeContext`/`peekActiveProviderRuntimeContext` decisions — callers using context reads are allowed, but combining register+context-bridge calls outside the adapter is not.

Exit 1 if any violation is found.

### 20. Lockfile Verification

Check that `package-lock.json` exists and `pnpm-lock.yaml` does not. Exit 1 if conditions not met.

## Usage In Plans

All verification phases should reference this script instead of inline shell snippets. Example:

```bash
node scripts/check-settings-boundary.js --check source-imports,metadata,old-paths,root-barrel,lockfile
```

Each check outputs `OK: <check-name>` on success or `FAIL: <check-name>: <details>` on failure. Exit code is 1 if any check fails, 0 if all pass.

The script supports the following check names (select individual checks or `all`):
- `source-imports` (check 1)
- `all-files-imports` (check 2)
- `metadata` (check 3)
- `tsconfig-references` (check 4)
- `vitest-aliases` (check 5)
- `export-style` (check 6)
- `old-paths` (check 7)
- `root-barrel` (check 8)
- `anti-shim` (check 9)
- `core-re-exports` (check 10)
- `modelParams-subpath` (check 11)
- `relative-settings-imports` (check 12)
- `relative-storage-imports` (check 13)
- `vi-mock-paths` (check 14)
- `dynamic-import-paths` (check 15)
- `provider-runtime-context` (check 16)
- `no-storage-package` (check 17)
- `core-barrel-shim` (check 18)
- `adapter-single-owner` (check 19)
- `lockfile` (check 20)

Running `node scripts/check-settings-boundary.js` with no `--check` flag runs all checks.

**Post-P09 only**: Checks 10, 11, 12, 13, 14, 15, 18 enforce zero matches only after P09 cleanup. Before P09, these checks report violations but do not fail. Use `--phase pre-p09` to run in report-only mode for these checks.

**Post-P08 only**: Checks 7, 14, 15 enforce zero matches only after P08 consumer migration. Use `--phase pre-p08` to run in report-only mode.

## Plan Integration

This script is the **authoritative** boundary enforcement mechanism. All verification phases MUST use it as the primary boundary check instead of duplicated inline grep snippets. Inline scans in plan phase files are **supplemental** and must be consistent with the script's checks — if there is a discrepancy, the script is authoritative.

This script is created in P03 (alongside settings package scaffold) as a **mandatory** artifact. P03 must create the script file, verify it runs (exits 0 when settings has no forbidden imports/deps), and commit it. Later phases MUST use this script instead of drifting inline scans. Inline scans that appear in plan phase files must be consistent with the script's logic and symbol lists — if there is a discrepancy, the script is authoritative.

**P03 creation mandate**: `scripts/check-settings-boundary.js` is listed as a mandatory P03 created artifact. P03 must create the script file, verify it runs (exits 0 when settings package has no forbidden imports/deps), and commit it. Later phases MUST use this script instead of ad-hoc inline shell snippets for boundary checks. The script MUST also verify that `packages/settings/src/index.ts` exists as the canonical root public API barrel (separate from `packages/settings/index.ts` which re-exports `./src/index.js`).

**P08/P09/P10 authoritative enforcement**: P08, P09, and P10 MUST invoke `node scripts/check-settings-boundary.js` as the primary boundary enforcement mechanism. Inline shell snippets in these phases are supplemental and must be consistent with the script. Any discrepancy between inline snippets and the boundary script is resolved in favor of the script.