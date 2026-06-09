# Phase 03: Decoupling Stubs And Settings-Owned Type Boundaries

## Phase ID

`PLAN-20260608-ISSUE1588.P03`

## Prerequisites

- Required: Phase 02c verified.
- Preflight verification complete.

## Requirements Implemented (Expanded)

### REQ-DEP-001: Cycle-Free Dependency Direction

**Full Text**: Settings must not depend on providers, tools, CLI, or core.

**Behavior**:

- GIVEN current blockers
- WHEN decoupling stubs/types are introduced
- THEN settings-owned types can be moved without importing core

**Why This Matters**: Implementation cannot move `ProfileManager` or singleton management safely without this boundary.

## Implementation Tasks

### Explicit Settings Package Scaffold Requirements

P03 MUST create the new `packages/settings` workspace package with ALL of the following artifacts. Each is required for the package to compile, run tests, and integrate with the workspace. This checklist is exhaustive for a new workspace package.

#### 1. `packages/settings/package.json`

- `name`: `@vybestack/llxprt-code-settings`
- `version`: match repository current package version
- `type`: `"module"`
- `main`: `"dist/index.js"`
- `types`: `"dist/index.d.ts"`
- `exports`: root export + mandatory subpath exports per the **concrete export map** below (using `dist/src/...` paths matching providers build convention)
- `files`: `["dist"]`
- `scripts.build`: `"node ../../scripts/build_package.js"`
- `scripts.test`: `"vitest run"` (MUST recursively discover nested test directories including `src/profiles/__tests__` and `src/storage/__tests__`)
- `scripts.test:ci`: `"vitest run"`
- `scripts.typecheck`: `"tsc --noEmit"`
- `scripts.lint`: `"eslint . --ext .ts,.tsx"`
- `scripts.format`: `"prettier --write ."`
- `dependencies`: include `zod` (verified required for `AuthConfigSchema`)
- `devDependencies`: vitest, typescript, `@types/node` (per providers/core convention — Node filesystem modules in Storage/ProfileManager require Node type definitions)
- **Forbidden dependencies**: `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code` (CLI) — in BOTH `dependencies` AND `devDependencies`

**Concrete export map** (inline — every export path MUST correspond to a real source file and the built file MUST be verified to exist after `npm run build`):

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    },
    "./settings/SettingsService.js": {
      "types": "./dist/src/settings/SettingsService.d.ts",
      "import": "./dist/src/settings/SettingsService.js"
    },
    "./settings/settingsServiceInstance.js": {
      "types": "./dist/src/settings/settingsServiceInstance.d.ts",
      "import": "./dist/src/settings/settingsServiceInstance.js"
    },
    "./settings/settingsRegistry.js": {
      "types": "./dist/src/settings/settingsRegistry.d.ts",
      "import": "./dist/src/settings/settingsRegistry.js"
    },
    "./profiles/ProfileManager.js": {
      "types": "./dist/src/profiles/ProfileManager.d.ts",
      "import": "./dist/src/profiles/ProfileManager.js"
    },
    "./profiles/types.js": {
      "types": "./dist/src/profiles/types.d.ts",
      "import": "./dist/src/profiles/types.js"
    },
    "./storage/Storage.js": {
      "types": "./dist/src/storage/Storage.d.ts",
      "import": "./dist/src/storage/Storage.js"
    }
  }
}
```

P03 verification MUST confirm that each export source file exists at the corresponding `src/` path (e.g., `packages/settings/src/settings/SettingsService.ts` exists, `packages/settings/src/profiles/types.ts` exists) and that after build, each declared `dist/src/...` output file exists.

#### 2. `packages/settings/tsconfig.json`

- Extends `../../tsconfig.json`
- `outDir`: `"dist"`
- `include`: `["src"]`
- `exclude`: `["dist", "node_modules"]` consistent with providers
- `tsBuildInfoFile`: under `../../node_modules/.cache/tsbuildinfo`
- NO references to core/providers/cli packages

#### 3. `packages/settings/index.ts`

- Re-exports `./src/index.js`

#### 4. `packages/settings/src/` Layout

- `src/index.ts` — package public API barrel
- `src/types.ts` — settings-owned type stubs
- `src/settings/SettingsService.ts` — stub (may be empty or throw)
- `src/settings/settingsServiceInstance.ts` — stub
- `src/settings/settingsRegistry.ts` — stub
- `src/profiles/ProfileManager.ts` — stub
- `src/profiles/types.ts` — stub
- `src/storage/Storage.ts` — stub

#### 5. `packages/settings/vitest.config.ts`

- Configure vitest to recursively discover tests in all subdirectories (`src/__tests__`, `src/profiles/__tests__`, `src/storage/__tests__`)
- Include workspace source alias plugin entries if needed per preflight verification
- Follow the same pattern as providers vitest config

#### 6. Workspace Registration

- [ ] `packages/settings` to root `package.json` workspaces array (BEFORE `packages/core`)
- Run `npm install` (NOT `pnpm install`) to update `package-lock.json`
- Verify no `pnpm-lock.yaml` is created
- **Lockfile diff verification**: After `npm install`, run `git diff package-lock.json` to confirm only settings-related changes appear. The diff must contain `packages/settings` entries and workspace metadata. If unrelated churn appears, investigate before proceeding.
- Record the `git diff --stat package-lock.json` output in the phase completion marker.

#### 6a. Root Build Ordering Verification

After workspace registration, verify that the root build order accommodates the new settings package. The root `package.json` workspaces array currently lists `packages/core` before any future `packages/settings`, and `scripts/build.js` runs `npm run build --workspaces` which builds in workspace-array order (not dependency order). The implementation **MUST** do one of:

1. **Insert `packages/settings` before `packages/core` in the root `package.json` workspaces array**, so `npm run build --workspaces` builds settings before core/providers/CLI that depend on it; OR
2. **Modify `scripts/build.js` to explicitly build `@vybestack/llxprt-code-settings` before building other workspaces** (e.g., add `npm run build --workspace @vybestack/llxprt-code-settings` before the `--workspaces` invocation).

Option (1) is preferred because it respects `npm run build --workspaces` workspace-array ordering and is least invasive. Option (2) is acceptable if workspace-array reordering causes other issues.

```bash
# Verify settings builds independently before consumers
npm run build --workspace @vybestack/llxprt-code-settings
# Verify root build still works (settings must build before core/providers/CLI that import it)
npm run build
# Check current workspace order — settings MUST appear before core
node -e "const p=require('./package.json'); const ws=p.workspaces; const si=ws.indexOf('packages/settings'); const ci=ws.indexOf('packages/core'); console.log('settings at index', si, 'core at index', ci); if (si === -1) { console.error('FAIL: settings not in workspaces'); process.exit(1); } if (si > ci) { console.error('FAIL: settings must be before core'); process.exit(1); } console.log('OK: settings builds before core');"
# Verify scripts/build.js does not hard-code package lists excluding settings
grep -n 'packages/core' scripts/build.js | head -5 || echo "OK: no hard-coded package lists in build.js"
# Verify predocs:settings builds settings before core
npm run predocs:settings 2>&1 | tail -3
```

**predocs:settings handling**: The `predocs:settings` script currently runs `npm run build --workspace @vybestack/llxprt-code-core`. After settings extraction, core depends on settings (type-only for type imports during P03b, full dependency after P06). If `predocs:settings` only builds core, it WILL fail because core type-checks against settings. The implementation must either:
- Replace `predocs:settings` with `npm run build --workspace @vybestack/llxprt-code-settings && npm run build --workspace @vybestack/llxprt-code-core`; OR
- Replace `predocs:settings` with `npm run build` (full build which handles ordering).

Record which approach was taken in the phase completion marker.

#### 7. Compilation Verification

- `npm run typecheck --workspace @vybestack/llxprt-code-settings` MUST pass
- `npm run build --workspace @vybestack/llxprt-code-settings` MUST pass

#### 8. Package Test Command Availability

- `npm run test --workspace @vybestack/llxprt-code-settings` MUST run without error (empty test suite is acceptable for P03, but vitest must start and find zero tests). Settings `vitest.config.ts` MUST include `passWithNoTests: true` so that an empty suite does not cause a nonzero exit. This is explicitly required because `vitest run` returns a nonzero exit code when zero test files are discovered, and P03 creates scaffold directories before P04 adds test files.
- Test command MUST recursively search nested directories (not just `src/__tests__`)

#### 8a. Settings Package Boundary Check (Reusable Script — Mandatory P03 Artifact)

All phases that verify settings package boundaries MUST use `scripts/check-settings-boundary.js` (created in P03 as a mandatory artifact) as the **authoritative** boundary enforcement mechanism. This script consolidates the repeated inline shell scans across multiple verification phases into a single authoritative, checked-in script. This eliminates drift between phases and ensures enforcement is consistent. Inline scans in plan phase files are **supplemental** and must be consistent with the script — if there is a discrepancy, the script is authoritative.

**P03 MUST create `scripts/check-settings-boundary.js`** following the specification in `analysis/boundary-verification-script.md`. After creation, P03 verification MUST confirm the script runs and exits 0 when settings has no forbidden imports/deps.

**P08/P09/P10 authoritative enforcement**: P08, P09, and P10 MUST invoke `node scripts/check-settings-boundary.js` as the primary boundary enforcement mechanism. Inline shell snippets in these phases are supplemental and must be consistent with the script. Any discrepancy between inline snippets and the boundary script is resolved in favor of the script.

```bash
node scripts/check-settings-boundary.js --check source-imports,metadata,old-paths,root-barrel,lockfile
```

For reference, the inline shell pattern below matches what the script implements. Phases that have not yet created the script may use the inline pattern temporarily, but MUST switch to the script once it exists.

```bash
# Unified settings package boundary check (enforcing — must exit 0 on pass, nonzero on fail)
# 1. Source files: no forbidden imports
SETTINGS_SRC=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_SRC" && echo "OK: settings src has no forbidden imports" || { echo "FAIL: forbidden imports in settings src:"; echo "$SETTINGS_SRC"; exit 1; }
# 2. All TypeScript files (including tests, configs): no forbidden imports
SETTINGS_ALL=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_ALL" && echo "OK: settings package has no forbidden imports" || { echo "FAIL: forbidden imports in settings package:"; echo "$SETTINGS_ALL"; exit 1; }
# 3. Package metadata: no forbidden deps (dependencies AND devDependencies)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code','@vybestack/llxprt-code-tools','@vybestack/llxprt-code-a2a-server']; const found=forbidden.filter(n=>d[n]); if(found.length>0){console.error('FAIL: forbidden deps:',found.join(', '));process.exit(1);} console.log('OK: settings deps clean');"
# 4. tsconfig.json: no references to core/providers/cli
rg -n "core|providers|cli" packages/settings/tsconfig.json && echo "FAIL: tsconfig has core/providers/cli references" || echo "OK: tsconfig clean"
# 5. vitest.config.ts: no forbidden workspace aliases
rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/vitest.config.ts 2>/dev/null && echo "WARN: vitest alias references found" || echo "OK: vitest config clean"
# 6. Export map style: verify all subpaths use {types, import} objects (not bare strings)
node -e "const p=require('./packages/settings/package.json'); for(const[k,v] of Object.entries(p.exports)){if(typeof v==='string'){console.error('FAIL: bare string export for',k);process.exit(1);}} console.log('OK: all exports use {types, import} objects');"
```

This boundary check is used in P03, P03a, P05, P05a, P06a, P08a, P09, P09a, P10, and P10a verification commands wherever settings package boundary scans are required.

#### 9. Forbidden Dependency/Import Checks

- `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts'` returns zero
- Node.js metadata check: `packages/settings/package.json` has no forbidden workspace deps in `dependencies` or `devDependencies`
- `@types/node` present in `devDependencies` (required for Storage/ProfileManager Node filesystem and path module types)
- No references to core providers/cli in `tsconfig.json`

### Files to Create Or Modify

- All scaffold files listed above
- `scripts/check-settings-boundary.js` — **mandatory P03 creation artifact** per `analysis/boundary-verification-script.md`. Must implement all 12 checks specified in the boundary verification script spec. Must be verified to run (exits 0 when settings has no forbidden imports/deps) before P03 completion.
- `packages/settings/src/profiles/__tests__/` — create directory only when test files are added in P04 (empty directories are not tracked by git; do NOT use `.gitkeep`)
- `packages/settings/src/storage/__tests__/` — create directory only when test files are added in P04 (empty directories are not tracked by git; do NOT use `.gitkeep`)
- Root `package.json` — add `packages/settings` to workspaces (BEFORE `packages/core` for correct build ordering)
- `package-lock.json` — updated by `npm install`

All new code/tests must include `@plan PLAN-20260608-ISSUE1588.P03` and relevant requirements.

## Verification Commands

```bash
npm run typecheck
npm run typecheck --workspace @vybestack/llxprt-code-settings
npm run build --workspace @vybestack/llxprt-code-settings
npm run test --workspace @vybestack/llxprt-code-settings
# Forbidden import scans (enforcing: capture-and-check-empty patterns)
SETTINGS_SRC=$(rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers|@vybestack/llxprt-code['"]" packages/settings/src --glob '*.ts' --glob '*.tsx' 2>/dev/null || true)
test -z "$SETTINGS_SRC" && echo "OK: settings src has no forbidden imports" || { echo "FAIL: forbidden imports in settings src:"; echo "$SETTINGS_SRC"; exit 1; }
# Package metadata forbidden dependency check (both dependencies and devDependencies)
node -e "const p=require('./packages/settings/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; for (const n of ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']) if (d[n]) { console.error('FORBIDDEN:', n); process.exit(1); }; console.log('settings deps OK')"
# Verify tsconfig has no core/providers/cli references
rg -n "core|providers|cli" packages/settings/tsconfig.json && echo "FAIL: tsconfig has core/providers/cli references" || echo "OK: tsconfig clean"
# Verify workspace registration with settings BEFORE core
node -e "const p=require('./package.json'); const ws=p.workspaces; const si=ws.indexOf('packages/settings'); const ci=ws.indexOf('packages/core'); if(si===-1){console.error('FAIL: settings not in workspaces');process.exit(1);} if(si>ci){console.error('FAIL: settings must be before core in workspaces');process.exit(1);} console.log('OK: settings before core in workspaces');"
# Verify package-lock.json updated, no pnpm-lock.yaml
test -f package-lock.json && echo "npm lockfile present"
test ! -f pnpm-lock.yaml && echo "no pnpm lockfile"
# Verify export map source-file mapping (two cases):
# 1. Root export ".": import "./dist/index.js" maps to packages/settings/index.ts (source entrypoint)
# 2. Subpath exports "./dist/src/...": import "./dist/src/X.js" maps to packages/settings/src/X.ts
node -e "const p=require('./packages/settings/package.json'); const fs=require('fs'); const path=require('path'); for(const[k,v] of Object.entries(p.exports)){const importPath=typeof v==='object'?v.import:v; let srcPath; if(k==='.'){srcPath='./index.ts';}else{srcPath=importPath.replace('./dist/','./src/').replace(/\.js$/,'.ts');} const full=path.join('./packages/settings',srcPath); if(!fs.existsSync(full)){console.error('FAIL: export',k,'source missing:',full);process.exit(1);} } console.log('OK: all export source files exist');"
# Additionally verify packages/settings/src/index.ts exists (the public API barrel, distinct from root index.ts)
test -f packages/settings/src/index.ts && echo "OK: settings/src/index.ts exists" || { echo "FAIL: settings/src/index.ts missing"; exit 1; }
# Verify built export files exist after build
npm run build --workspace @vybestack/llxprt-code-settings
node -e "const p=require('./packages/settings/package.json'); const fs=require('fs'); const path=require('path'); for(const[k,v] of Object.entries(p.exports)){const importPath=typeof v==='object'?v.import:v; const full=path.join('./packages/settings',importPath); if(!fs.existsSync(full)){console.error('FAIL: built export',k,'missing:',full);process.exit(1);}} console.log('OK: all built export files exist');"
# predocs:settings must build settings before core
npm run predocs:settings 2>&1 | tail -3
# Root build ordering: settings before core
node -e "const p=require('./package.json'); const ws=p.workspaces; const si=ws.indexOf('packages/settings'); const ci=ws.indexOf('packages/core'); if(si===-1){console.error('FAIL: settings not in workspaces');process.exit(1);} if(si>ci){console.error('FAIL: settings must be before core');process.exit(1);} console.log('OK: settings builds before core');"
```

Expected: typecheck MUST pass for root and settings workspace; settings builds; test command runs (0 tests OK, `passWithNoTests: true` in vitest config); no forbidden settings imports; no forbidden deps in dependencies or devDependencies; tsconfig has no core/providers/cli references; workspace registration present with settings before core; npm lockfile present; no pnpm lockfile; all export source files exist (root maps to `index.ts`, subpaths map to `src/...`); `packages/settings/src/index.ts` exists as public API barrel; all built export files exist; predocs:settings succeeds; root build orders settings before core; `@types/node` present in settings `devDependencies`; `scripts/check-settings-boundary.js` exists and runs successfully (exits 0).

## Semantic Verification Checklist

- [ ] `scripts/check-settings-boundary.js` exists, implements all 12 checks from `analysis/boundary-verification-script.md`, and runs successfully (exits 0).
- [ ] `scripts/check-settings-boundary.js` includes `LoadBalancerConfig` and `LoadBalancerSubProfileConfig` in the root-barrel moved-symbol scan (check 8).
- [ ] No production behavior is claimed complete.
- [ ] Settings package still has no forbidden dependency.
- [ ] Export map: every subpath uses `{types, import}` objects (no bare string exports).
- [ ] Every declared export source file exists at `src/...` path (root `.` export maps to `index.ts`, subpaths map to `src/...`).
- [ ] Every declared export source file exists (root `.` export maps to `packages/settings/index.ts`; subpaths under `./dist/src/...` map to `packages/settings/src/...`; `packages/settings/src/index.ts` verified separately as public API barrel).
- [ ] Every built export file exists at `dist/src/...` path after build.
- [ ] `passWithNoTests: true` in settings vitest config so empty suite passes.
- [ ] `@types/node` present in settings `devDependencies` (Node filesystem modules in Storage/ProfileManager require Node type definitions).
- [ ] Root `package.json` workspaces array has `packages/settings` before `packages/core`.
- [ ] `scripts/build.js` does not hard-code package ordering that excludes settings.
- [ ] `predocs:settings` script builds settings before core (or uses full build).
- [ ] Unified boundary check (Section 8a) passes.
- [ ] `packages/settings/package.json` inline export map verified against source files and built files.
- [ ] Compression strategy `enumValues` in settings registry will use settings-owned literal values (no import from core compression).

## Success Criteria

The package/type boundary exists for P04 tests. `npm run typecheck` passes (stubs compile cleanly).

## Failure Recovery

Revert P03 files and re-run from P03 after fixing contracts.

## Phase Completion Marker

Create `project-plans/issue1588/.completed/P03.md`.
