# Phase Verification Matrix

Plan ID: PLAN-20260608-ISSUE1588

## Common Verification Commands

Run these after every phase that changes production or test code, adjusted for phase scope:

```bash
npm run typecheck
npm run test
npm run lint
```

**Important**: When running workspace-scoped test commands, use workspace-relative paths from the package cwd, not root-absolute paths. For example:
- [OK] `npm run test --workspace @vybestack/llxprt-code-core -- --run src/runtime`
- [ERROR] `npm run test --workspace @vybestack/llxprt-code-core -- --run packages/core/src/runtime`

Preflight (P0.5) must validate which path convention works. All plan verification commands use workspace-relative paths.

Before check-in and in P10, run the full required suite:

```bash
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load synthetic "write me a haiku and nothing else"
```

## Boundary Scans

All boundary scans use **enforcing** `rg -n` capture-and-check-empty patterns (not `rg -c`) or `rg -q` fail/pass patterns. Where `rg -c` was previously used, it has been replaced. Exact JSON dependency checks use Node.js `require()` for local metadata reads, not regex.

### Reusable Settings Package Boundary Check Script

All phases that verify settings package boundaries MUST use the unified boundary check defined in `plan/03-decoupling-stub.md` Section 8a. This replaces per-scan ad-hoc commands with a single reusable pattern covering `packages/settings/**/*.ts(x)`, `package.json` (`dependencies` AND `devDependencies`), `tsconfig.json`, and `vitest.config.ts`.

```bash
# === START: Unified settings package boundary check (enforcing) ===
# 1. Source files: no forbidden imports
SETTINGS_SRC=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_SRC" && echo "OK: settings src has no forbidden imports" || { echo "FAIL: forbidden imports in settings src:"; echo "$SETTINGS_SRC"; exit 1; }
# 2. All TypeScript files (including tests, configs): no forbidden imports
SETTINGS_ALL=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_ALL" && echo "OK: settings package has no forbidden imports" || { echo "FAIL: forbidden imports in settings package:"; echo "$SETTINGS_ALL"; exit 1; }
# 3. Package metadata: no forbidden deps (dependencies AND devDependencies, using Node JSON parsing)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server']; const found=forbidden.filter(n=>d[n]); if(found.length>0){console.error('FAIL: forbidden deps:',found.join(', '));process.exit(1);} console.log('OK: settings deps clean');"
# 4. tsconfig.json: no references to core/providers/cli
rg -n "core|providers|cli" packages/settings/tsconfig.json && echo "FAIL: tsconfig has core/providers/cli references" || echo "OK: tsconfig clean"
# 5. vitest.config.ts: no forbidden workspace aliases
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/vitest.config.ts 2>/dev/null && echo "WARN: vitest alias references found" || echo "OK: vitest config clean"
# 6. Export map style: verify all subpaths use {types, import} objects (not bare strings)
node -e "const p=require('./packages/settings/package.json'); for(const[k,v] of Object.entries(p.exports)){if(typeof v==='string'){console.error('FAIL: bare string export for',k);process.exit(1);}} console.log('OK: all exports use {types, import} objects');"
# 7. Guard: settings does not import CLI settingsSchema
rg -n "settingsSchema" packages/settings/src --glob '*.ts' 2>/dev/null && echo "FAIL: settings imports CLI settingsSchema" || echo "OK: settings does not import CLI settingsSchema"
# === END: Unified settings package boundary check ===
```

### Standard Boundary Scans

```bash
rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts'
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts'
find packages/core/src/settings -type f 2>/dev/null | sort
rg -n "settings/SettingsService|settings/settingsRegistry|settings/settingsServiceInstance|config/storage|config/profileManager" packages/core/package.json packages/core/src/index.ts packages/core/index.ts
# Root-barrel moved-symbol import scan (enforcing: capture-and-check-empty)
ROOT_BARREL_IMPORTS=$(rg -n "import.*\{[^}]*(SettingsService|ProfileManager|Storage|ModelParams|Profile|StandardProfile|LoadBalancerProfile|EphemeralSettings|SETTINGS_REGISTRY|getSettingsService|registerSettingsService|resetSettingsService)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core['\"]" packages --glob '*.ts' 2>/dev/null || true)
test -z "$ROOT_BARREL_IMPORTS" && echo "OK: no root-barrel moved-symbol imports" || { echo "FAIL: root-barrel moved-symbol imports found:"; echo "$ROOT_BARREL_IMPORTS"; exit 1; }
# Moved profile/model type imports from core (enforcing)
rg -n "import.*\{[^}]*(ModelParams|EphemeralSettings|Profile|StandardProfile|LoadBalancerProfile|isLoadBalancerProfile|isStandardProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}.*from ['\"]@vybestack/llxprt-code-core" packages --glob '*.ts'
rg -n "from ['\"]@vybestack/llxprt-code-core/types/modelParams" packages --glob '*.ts'
# Dynamic import and vi.mock old paths (enforcing: capture-and-check-empty)
MOCK_IMPORTS=$(rg -n "vi\.mock.*['\"].*settings/|vi\.mock.*['\"].*config/(storage|profileManager)|import\(['\"]@vybestack/llxprt-code-core['\"]\)\.then" packages --glob '*.ts' 2>/dev/null || true)
test -z "$MOCK_IMPORTS" && echo "OK: no old vi.mock/dynamic import paths" || { echo "FAIL: old vi.mock/dynamic import paths found:"; echo "$MOCK_IMPORTS"; exit 1; }
# Settings package MUST not import consumers
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['\"]" packages/settings/src --glob '*.ts'
# Core relative profileManager imports (enforcing)
PROFILEREL_IMPORTS=$(rg -n "from ['\"].*config/profileManager" packages/core/src --glob '*.ts' 2>/dev/null || true)
test -z "$PROFILEREL_IMPORTS" && echo "OK: no core relative profileManager imports" || { echo "FAIL: core relative profileManager imports found:"; echo "$PROFILEREL_IMPORTS"; exit 1; }
# Type file existence
test ! -f packages/core/src/types/modelParams.ts
# Core re-exports of moved types (profile/model) (enforcing)
PROFILE_TYPE_EXPORTS=$(rg -n "export.*\{[^}]*(Profile|StandardProfile|LoadBalancerProfile|ModelParams|EphemeralSettings|isLoadBalancerProfile|AuthConfig|AuthConfigSchema|hasAuthConfig|isOAuthProfile)[^}]*\}" packages/core/src/index.ts packages/core/index.ts 2>/dev/null || true)
test -z "$PROFILE_TYPE_EXPORTS" && echo "OK: no moved profile/model type re-exports in core barrel" || { echo "FAIL: moved profile/model type re-exports found:"; echo "$PROFILE_TYPE_EXPORTS"; exit 1; }
# Core re-exports of moved settings types and singleton functions (enforcing)
SETTINGS_TYPE_EXPORTS=$(rg -n "export.*\{[^}]*(SettingsService|ISettingsService|GlobalSettings|SettingsChangeEvent|ProviderSettings|UISettings|AdvancedSettings|EventListener|EventUnsubscribe|SettingsTelemetrySettings|DiagnosticsInfo|getSettingsService|registerSettingsService|resetSettingsService|SETTINGS_REGISTRY)[^}]*\}" packages/core/src/index.ts packages/core/index.ts 2>/dev/null || true)
test -z "$SETTINGS_TYPE_EXPORTS" && echo "OK: no moved settings type/singleton re-exports in core barrel" || { echo "FAIL: moved settings type/singleton re-exports found:"; echo "$SETTINGS_TYPE_EXPORTS"; exit 1; }
MODELPARAMS_EXPORT=$(rg -n "modelParams" packages/core/package.json packages/core/src/index.ts 2>/dev/null || true)
test -z "$MODELPARAMS_EXPORT" && echo "OK: no modelParams subpath export" || { echo "FAIL: modelParams subpath export found:"; echo "$MODELPARAMS_EXPORT"; exit 1; }
# Built-runtime import verification for all documented exports (ESM dynamic import)
# PREREQUISITE: npm install and full workspace build must be complete before this check
# Validates package exports against actual package.json export map and built files
node --input-type=module -e "
  const fs = await import('fs');
  const path = await import('path');
  const pkg = JSON.parse(fs.readFileSync('./packages/settings/package.json', 'utf8'));
  const paths = ['.', ...Object.keys(pkg.exports).filter(k => k !== '.')];
  for (const p of paths) {
    const importSpecifier = p === '.' ? '@vybestack/llxprt-code-settings' : '@vybestack/llxprt-code-settings/' + p.replace('./', '');
    // Verify built file exists for each declared export
    const exportEntry = pkg.exports[p];
    const jsPath = typeof exportEntry === 'object' ? exportEntry.import : exportEntry;
    const fullPath = path.join('./packages/settings', jsPath);
    if (!fs.existsSync(fullPath)) { console.error('FAIL: built export', p, 'missing:', fullPath); process.exitCode = 1; continue; }
    try {
      const mod = await import(importSpecifier);
      console.log('OK:', p);
    } catch (e) {
      console.error('FAIL:', p, e.message);
      process.exitCode = 1;
    }
  }
"
# Deep dynamic import scan for old core settings/config paths (enforcing)
DEEP_DYNAMIC=$(rg -n "import\(['\"]@vybestack/llxprt-code-core/settings/|import\(['\"]@vybestack/llxprt-code-core/config/(storage|profileManager)" packages --glob '*.ts' 2>/dev/null || true)
test -z "$DEEP_DYNAMIC" && echo "OK: no deep dynamic imports of old paths" || { echo "FAIL: deep dynamic imports of old paths found:"; echo "$DEEP_DYNAMIC"; exit 1; }
# Extended settings package boundary scan: all files, not just src/ (uses reusable script above)
# Settings package metadata boundary: dependencies and devDependencies (Node JSON parsing)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('FORBIDDEN:', n, 'in', Object.keys(p.dependencies||{}).includes(n) ? 'dependencies' : 'devDependencies'); process.exit(1); }; console.log('settings deps OK')"
# STUB/will-be-implemented fraud scan for production source (excluding adapter stubs during P03b-P06)
rg -rn -E "(STUB|will be implemented|not yet implemented|placeholder)" packages --include="*.ts" | grep -v ".test.ts" | grep -v "settingsRuntimeAdapter.ts.*STUB.*P03b"
# Schema/docs verification
npm run schema:settings 2>&1 | tail -3
npm run docs:settings 2>&1 | tail -3
# Lockfile verification
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
# .llxprt status check
git status --short .llxprt
# npm vs pnpm evidence
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "pnpm lockfile absent"
# Include packages/lsp in scan (enforcing)
LSP_IMPORTS=$(rg -n "@vybestack/llxprt-code-core/settings|@vybestack/llxprt-code-core/config/(storage|profileManager)|import.*SettingsService|import.*ProfileManager" packages/lsp --glob '*.ts' 2>/dev/null || true)
test -z "$LSP_IMPORTS" && echo "OK: no unmigrated LSP imports" || { echo "FAIL: unmigrated LSP imports found:"; echo "$LSP_IMPORTS"; exit 1; }
# a2a-server scan: verify no direct dependencies on settings symbols (may need update at implementation time)
A2A_IMPORTS=$(rg -n "import.*Storage|import.*SettingsService|import.*ProfileManager|import.*getSettingsService|import.*registerSettingsService|import.*resetSettingsService|import.*SETTINGS_REGISTRY" packages/a2a-server/src --glob '*.ts' 2>/dev/null || true)
test -z "$A2A_IMPORTS" && echo "OK: a2a-server has no direct settings symbol imports" || { echo "INFO: a2a-server imports settings symbols (may need dependency update):"; echo "$A2A_IMPORTS"; }
rg -n "from ['\"]@vybestack/llxprt-code-core" packages/a2a-server/src --glob '*.ts'
```

Boundary scans are expected to fail before cleanup phases. P09/P10 require them to pass.

## Phase-Specific Checks

| Phase | Required Additional Verification |
|-------|----------------------------------|
| P0.5 | `analysis/preflight-results.md` populated with actual outputs |
| P01 | Move map and consumer matrix updated from current grep results |
| P02 | Pseudocode files have numbered lines and no TypeScript implementation |
| P02b | Integration contract covers core, providers, CLI, profile/storage, singleton lifecycle |
| P03 | Decoupling stubs compile; **typecheck MUST pass**; no settings-to-core imports introduced; **explicit scaffold checklist items all fulfilled**: package.json, tsconfig, index, src layout, vitest config, workspace registration, exports, compilation, package test command availability, forbidden dependency/import checks; **no pnpm-lock.yaml**; **empty test directories include `.gitkeep` or are created only when test files are added** |
| P03b | Minimal adapter/config wiring stubs compile; `settingsRuntimeAdapter.ts` exists with NotYetImplemented stubs; core type-only imports from settings present; tsconfig/settings path aliases present **in core, providers, AND CLI**; providers `vitest.config.ts` has settings alias; providers and CLI have settings dependency; **CLI `vitest.config.ts` has settings root and subpath aliases**; **CLI alias verification command confirms settings source resolution (not stale dist)**; **build ordering check: settings package build succeeds before consumers import it** |
| P03c | P03b verification: adapter stubs throw NotYetImplemented (not fake behavior); type-only imports do not change runtime; existing core imports unchanged (temporary duplicates allowed); **providers and CLI both have path aliases and settings dependency** |
| P04 | New tests fail naturally against stubs/missing implementation; no reverse tests; **test command runs nested `src/profiles/__tests__` and `src/storage/__tests__` tests**; **capture-and-assert red-phase logic exits 0 only when nonzero test exit, no module-resolution errors, and expected behavioral/stub failures present** |
| P04b | Vertical-slice integration tests exist **FOR CORE ONLY** and fail against stubs; **provider/CLI integration tests do NOT exist yet (deferred to P07)**; no mock theater; **test files in owning consumer package (core), NOT in `packages/settings`**; settings package has zero consumer imports; **test commands use workspace-relative paths (`src/__tests__/settings-integration`, not `packages/core/src/...`)**; **each slice names exact production entrypoint/import path and requires test to fail when consumer wiring is absent**; **expected-failure output assertions prove behavioral/stub failures (NotYetImplemented, AssertionError), NOT module resolution errors (Cannot find module, Module not found)** |
| P05 | `npm run test --workspace @vybestack/llxprt-code-settings` passes (including nested profile/storage tests); settings package builds; **built-runtime ESM import verification for all documented exports (must run AFTER full `npm run build` from root, not only settings package build)**; **temporary duplicate policy enforced (old core files independent, no shims/forwarding)**; **extended boundary check: all `packages/settings/**/*.ts` and `**/*.tsx`, `package.json` (dependencies + devDependencies), `tsconfig.json`, `vitest.config.ts` scanned for forbidden imports/deps**; **schema/docs scripts verified if phase touches CLI schema imports or aliases**; **profile/storage tests use real temp filesystem directories, not mock-only** |
| P05a | P04b **core** integration test pass gate is NOT run in P05a (deferred to P06a because the adapter is still a transparent no-op stub — the test would always fail on no-op behavior, not on settings implementation). Extended boundary check; schema/docs early verification; built-runtime ESM import verification runs AFTER full root build (`npm run build`); deterministic workspace graph check: no cycles, settings has no forbidden deps; LLXPRT_DIR identity verified; root build ordering verified |
| P06 | Core config/runtime targeted tests pass; runtime isolation behavior verified; **core `settingsRuntimeAdapter.ts` exists and provides `activateSettingsRuntimeContext`/`deactivateSettingsRuntimeContext`**; `configConstructor.ts` uses adapter (P06 wires the production call-site switch from `registerSettingsService()` to `activateSettingsRuntimeContext()`); **adapter idempotency and call-count tests pass**; **single-owner scan passes (enforcing Node.js script)**; **`providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan covers imports, type references, and constructor calls)**; **adapter permitted bridge scan passes (enforcing)**; **LLXPRT_DIR decoupled: `configBaseCore.ts` uses local constant, not import from memoryTool** |
| P06a | P04b **core** integration test rerun as first pass gate for production configConstructor/runtime wiring (P06a is the first pass gate where the adapter is fully implemented and configConstructor is wired — must pass); **single-owner and bridge scan rerun (enforcing)**; **lifecycle wording verified: `settingsRuntimeAdapter.ts` is sole owner calling both runtime-context AND settings helpers; `providerRuntimeContext.ts` stays settings-agnostic**; **LLXPRT_DIR constant identity verified**; **post-build stale export pre-check**; **deterministic workspace graph check** |
| P07 | Consumer migration tests fail naturally before P08 implementation; **migration follows call-site matrix**; **old-import scans are INVENTORY/REPORT-ONLY in P07 red phase — they do NOT exit 1 on non-empty results; zero enforcement begins in P08/P08a/P09**; **behavioral CLI test must be deterministic (concrete integration test or `--profile-load synthetic` smoke test)** |
| P08 | Core/providers/CLI targeted tests pass; old import scan trending to zero; **refreshed full import inventory before P08 including providers deep imports and all workspaces including `packages/lsp`**; **deep dynamic import scan for old core settings/config paths**; **`packages/lsp` explicitly scanned** |
| P08a | **Core** vertical-slice integration test (from P04b) rerun as pass gate; **provider/CLI** vertical-slice integration tests (from P07) rerun as pass gate — all must pass after consumer migration; **built-runtime ESM import verification for all documented exports (after full root build)**; **refreshed full import inventory confirms zero old-path matches**; **deterministic workspace graph check**; **post-build stale export scan of core dist** |
| P09 | Anti-shim scans pass; old core source files/exports removed; `modelParams.ts` deleted; no root-barrel moved-symbol imports; **STUB/will-be-implemented fraud scan fails if such comments remain in production source**; **all root settings type exports removed from core barrel (ISettingsService, GlobalSettings, SettingsChangeEvent, etc.)**; **LLXPRT_DIR decoupled: configBaseCore uses local constant**; **old core settings directory and all moved files (config/storage.ts, config/profileManager.ts, types/modelParams.ts, etc.) do NOT exist — enforced by `test ! -f` and `test ! -d` checks (not just `find | sort` report)**; **`providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan)** |
| P10 | Full required suite and smoke command pass; **`npm run format` completion records resulting `git status --short` and `git diff --stat` output**; package boundary graph checks pass; **built-runtime ESM import verification for all documented exports (after full root build)**; **deep dynamic import scan**; **`.llxprt/` unchanged (git status --short .llxprt)**; **npm vs pnpm evidence recorded**; **schema/docs verification**; **lockfile/no pnpm-lock verification**; **post-build stale export scan of core dist**; **deterministic workspace graph check (two separate checks: production cycles over `dependencies` ONLY; settings forbidden deps over `dependencies` AND `devDependencies`; MUST NOT be merged)**; **CLI behavioral test is deterministic** |
| P10a | Reviewer writes holistic semantic assessment; **`.llxprt/` unchanged verified**; **deterministic workspace graph check (production cycles over `dependencies` ONLY — dev dependency cycles are non-blocking; settings forbidden deps over `dependencies` AND `devDependencies` — dev deps can pull forbidden packages into settings build/test. These are two separate checks with different scopes and MUST NOT be merged)**; **post-build stale export scan of core dist**; **`providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan covers imports, type references, and constructor calls)**; **CLI behavioral test is deterministic** |
| P09a | Cleanup semantic verification; anti-shim; **LLXPRT_DIR decoupled verified**; **deterministic workspace graph check (production cycles over `dependencies` ONLY; settings forbidden deps over `dependencies` AND `devDependencies`; two separate checks, MUST NOT be merged)**; **post-build stale export scan of core dist**; **`providerRuntimeContext.ts` does NOT import, construct, or reference `SettingsService` or settings-package functions (expanded scan)** |

## Deferred Implementation Detection

Run after implementation phases P05, P08, and P09 against modified files:

```bash
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages --include="*.ts" | grep -v ".test.ts" | grep -v "settingsRuntimeAdapter.ts.*STUB.*P03b"
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages --include="*.ts" | grep -v ".test.ts"
find packages -type f | rg '(V2|New|Compat|Wrapper|Copy)\.(ts|tsx)$'
```

Existing unrelated matches must be justified in phase verification. New matches in touched implementation code fail the phase. **Post-P06 fraud scan**: after P06 replaces P03b adapter stubs with full implementation, `STUB`/`will be implemented` comments in `settingsRuntimeAdapter.ts` and any other production source files must fail the phase. The P03b adapter stub comment is explicitly exempted during P03b-P06, but P06 must remove it.
