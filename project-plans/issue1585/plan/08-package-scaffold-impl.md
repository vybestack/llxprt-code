# Phase 08: Package Scaffold Implementation

## Phase ID

`PLAN-20260608-ISSUE1585.P08`

## Purpose

Implement package scaffold and metadata changes to satisfy P07 tests. P08 is restricted to scaffold, build, and **package metadata only** — all release workflow, sandbox, Dockerfile, version, prepare-package, release test, and bind-release-deps changes belong exclusively to P14.

**P08 vs P14 ownership boundary**: P08 owns `packages/tools/package.json` exports, dependencies, and lockfile/workspace wiring. P14 owns all release workflow (`release.yml`, `release-process.test.js`, `build_sandbox.js`, `Dockerfile`, `scripts/version.js`, `scripts/prepare-package.js`, `bind-release-deps.js`) and sandbox changes. If a change touches release workflow, sandbox builds, or Docker install order, it belongs in P14, not P08.

## Prerequisites

- Required: P07a completed (scaffold/build tests exist, some failing).

## Requirements Implemented

### REQ-PKG-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-PKG-BOUNDARY

**Behavior specification**:
- GIVEN: Scaffold/build tests exist (some failing)
- WHEN: Package scaffold implementation is completed
- THEN: All scaffold/build tests pass; package.json exports, dependencies, and tsconfig are correct; no package cycles; lockfile updated

**Why it matters**: Missing package metadata means the package cannot be consumed by dependents or published.

## Implementation Tasks

### Step 0: Export Stubs For P10 Test Symbols

Before P10, `packages/tools` MUST export stub classes/functions for every tool and utility referenced by P10 tests. Stubs may throw `NotYetImplemented`, but import resolution and constructor signatures must match the target public API. Cross-reference with `analysis/tools-public-export-manifest.md` to ensure complete coverage.

### Step 1: Update packages/tools/package.json Exports

Add subpath exports matching the package export policy from 00-overview.md:

```json
"exports": {
  ".": {
    "types": "./dist/index.d.ts",
    "import": "./dist/index.js"
  },
  "./IToolFormatter.js": "./dist/src/formatters/IToolFormatter.js",
  "./ToolFormatter.js": "./dist/src/formatters/ToolFormatter.js",
  "./ToolIdStrategy.js": "./dist/src/formatters/ToolIdStrategy.js",
  "./toolIdNormalization.js": "./dist/src/formatters/toolIdNormalization.js",
  "./doubleEscapeUtils.js": "./dist/src/formatters/doubleEscapeUtils.js",
  "./toolNameUtils.js": "./dist/src/formatters/toolNameUtils.js"
}
```

### Step 2: Declare External Dependencies Only (No Core/Providers/CLI)

Add to packages/tools/package.json only external runtime dependencies (per `analysis/dependency-relocation-final.md`).

**Note on `zod-to-json-schema`**: Confirmed used by both `packages/core/src/tools/activate-skill.ts` (moves to tools) and `packages/core/src/agents/executor.ts` (stays in core). Evidence: `rg -n "zod-to-json-schema" packages/core/src packages/cli/src packages/providers/src -g "*.ts"`. It MUST be declared in tools dependencies. Core must also add it to its own dependencies (currently undeclared in core/package.json — a pre-existing gap).

```json
"dependencies": {
  "@ast-grep/napi": "^0.40.5",
  "@google/genai": "1.30.0",
  "cheerio": "^1.1.2",
  "diff": "^8.0.3",
  "fast-glob": "^3.3.3",
  "glob": "^12.0.0",
  "html-to-text": "^9.0.5",
  "node-fetch": "^3.3.2",
  "shell-quote": "^1.8.3",
  "turndown": "^7.2.2",
  "zod": "^3.25.76",
  "zod-to-json-schema": "^3.25.1"
}
```

**FORBIDDEN**: `packages/tools` MUST NOT list `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or `@vybestack/llxprt-code` in dependencies or devDependencies.

**Core dependency remediation for zod-to-json-schema**: Because `packages/core/src/agents/executor.ts` also imports `zod-to-json-schema`, P08 must add `"zod-to-json-schema": "^3.25.1"` to `packages/core/package.json` as a direct dependency if it is not already declared there, then run `npm install` and verify `package-lock.json` records the dependency. This is not a tools-to-core dependency; it fixes a pre-existing undeclared core runtime dependency while tools receives its own direct dependency.

**Anti-cycle verifier**: Add a Node script or test assertion that scans `packages/tools/package.json` dependencies and devDependencies for any `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, or `@vybestack/llxprt-code` entries. This check MUST fail the build if a forbidden dependency is present:

```bash
# Anti-cycle check: fail if any forbidden monorepo package is in tools dependencies
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']; for (const f of forbidden) { if (d[f]) { console.error('FORBIDDEN DEPENDENCY: '+f+' found in packages/tools/package.json'); process.exit(1); } }; console.log('Anti-cycle check passed');"
# Verify zod-to-json-schema is declared
node -e "const p=require('./packages/tools/package.json'); if (!p.dependencies || !p.dependencies['zod-to-json-schema']) { console.error('MISSING: zod-to-json-schema not in tools dependencies'); process.exit(1); } console.log('zod-to-json-schema check passed');"
```

Add this as a permanent test assertion in P07 scaffold tests so the check survives across all subsequent phases.

### Step 3: Update Lockfile And Verify Workspace

```bash
npm install
# Verify packages/tools exists in package-lock.json
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
# Verify packages/tools is in root workspaces
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
```

**npm/package-lock process guards** (despite honest pnpm note in root packageManager field):

```bash
# Guard: package-lock.json MUST exist (not pnpm-lock.yaml)
test -f package-lock.json
# Guard: pnpm-lock.yaml MUST NOT exist
test ! -f pnpm-lock.yaml
# Guard: packages/tools entry MUST exist in package-lock.json
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) { console.error('MISSING: packages/tools not in package-lock.json'); process.exit(1); }"
# Guard: packages/tools MUST appear in root workspaces
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) { console.error('MISSING: packages/tools not in root workspaces'); process.exit(1); }"
# Guard: core package-lock entry MUST declare tools dependency after install
node -e "const lock=require('./package-lock.json'); const core=lock.packages['packages/core']; if (core && !core.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('MISSING: core does not declare tools dependency in lockfile'); process.exit(1); }"
# Guard: providers package-lock entry MUST declare tools dependency after install
node -e "const lock=require('./package-lock.json'); const prov=lock.packages['packages/providers']; if (prov && !prov.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('MISSING: providers does not declare tools dependency in lockfile'); process.exit(1); }"
# Guard: CLI package-lock entry MUST NOT declare direct tools dependency
node -e "const lock=require('./package-lock.json'); const cli=lock.packages['packages/cli']; if (cli && cli.dependencies?.['@vybestack/llxprt-code-tools']) { console.error('FORBIDDEN: CLI has direct tools dependency in lockfile'); process.exit(1); }"
```

Add these guards as permanent test assertions in P07 scaffold tests so they survive across all subsequent phases.

### Step 4: Verify tsconfig Path Mappings (Boundary Rule)

`packages/tools/tsconfig.json` MUST allow only self path mappings. Path mappings to `../core`, `../providers`, or `../cli` are FORBIDDEN — they would create compile-time cycles.

```bash
# Verify no forbidden path mappings in tools tsconfig
node -e "const c=require('./packages/tools/tsconfig.json'); const paths=Object.keys(c.compilerOptions?.paths||{}); const refs=(c.references||[]).map(r=>r.path); const all=[...paths,...refs]; const forbidden=all.filter(p=>p.includes('../core')||p.includes('../providers')||p.includes('../cli')); if (forbidden.length) { console.error('FORBIDDEN TSCONFIG PATH:', JSON.stringify(forbidden)); process.exit(1); }; console.log('tsconfig path-mapping check passed');"
```

Add this as a permanent test assertion in P07 scaffold tests so the check survives across all subsequent phases.

### Step 5: Run Scaffold Tests And Build

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
npm run test --workspace @vybestack/llxprt-code-tools
```

### Step 6: Create Public Export Manifest Artifact

Create `analysis/tools-public-export-manifest.md` listing every symbol that `packages/tools` MUST export at the top level and every subpath. This artifact is referenced by P10 (for stub creation), P11 (for barrel export completeness), and P16 (for importability smoke tests).

```bash
# Generate manifest from current core tools exports
rg -n "^export " packages/core/src/tools -g "*.ts" | \
  rg -v "__tests__|\.test\.|\.spec\." | \
  awk -F: '{print $1}' | sort -u | \
  while read f; do echo "=== $f ==="; rg "^export " "$f" -g "*.ts"; done \
  > project-plans/issue1585/analysis/tools-public-export-manifest.md
```

The manifest must list:
1. Every top-level export symbol (from barrel `src/index.ts`)
2. Every subpath export symbol (from `package.json` `"exports"` map)
3. For each symbol: name, kind (class/function/type/interface), source file in tools

**P10 stub validation**: P10 Step 0 must cross-reference this manifest to ensure every listed symbol has a stub export in `packages/tools` before tests are written.

**P11 manifest-based export checks**: After all P11 migration groups, verify the barrel export in `packages/tools/src/index.ts` covers every symbol in the manifest using dynamic import:

```bash
npm run build --workspace @vybestack/llxprt-code-tools
node --input-type=module -e "
import * as tools from '@vybestack/llxprt-code-tools';
const manifest = (await import('./project-plans/issue1585/analysis/tools-public-export-manifest.json', { assert: { type: 'json' } })).default;
for (const sym of manifest.topLevelSymbols) {
  if (!tools[sym]) { console.error('MISSING TOP-LEVEL EXPORT: ' + sym); process.exit(1); }
}
console.log('All', manifest.topLevelSymbols.length, 'top-level exports verified');
"
```

### Files To Modify

- `packages/tools/package.json`
- `package-lock.json` (auto-updated by npm install)

### Files To Create

- `analysis/tools-public-export-manifest.md` (export manifest artifact for P10/P11/P16)

## Verification Commands

```bash
# Scaffold/build tests should now pass
npm run test --workspace @vybestack/llxprt-code-tools
# Anti-cycle check
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']; for (const f of forbidden) { if (d[f]) { console.error('FORBIDDEN DEPENDENCY: '+f); process.exit(1); } }; console.log('OK');"
# zod-to-json-schema check
node -e "const p=require('./packages/tools/package.json'); if (!p.dependencies?.['zod-to-json-schema']) { console.error('MISSING: zod-to-json-schema in tools'); process.exit(1); } console.log('tools zod-to-json-schema OK');"
# core zod-to-json-schema dependency check
node -e "const p=require('./packages/core/package.json'); if (!p.dependencies?.['zod-to-json-schema']) { console.error('MISSING: zod-to-json-schema in core'); process.exit(1); } console.log('core zod-to-json-schema OK');"
# tsconfig path-mapping check
node -e "const c=require('./packages/tools/tsconfig.json'); const paths=Object.keys(c.compilerOptions?.paths||{}); const refs=(c.references||[]).map(r=>r.path); const all=[...paths,...refs]; const forbidden=all.filter(p=>p.includes('../core')||p.includes('../providers')||p.includes('../cli')); if (forbidden.length) { console.error('FORBIDDEN TSCONFIG PATH:', JSON.stringify(forbidden)); process.exit(1); }; console.log('OK');"
# Full typecheck and build
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
# Verify lockfile
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
```

## Semantic Verification Checklist

- [ ] Package.json exports match package export policy.
- [ ] Package.json dependencies are external-only (no core/providers/cli). Includes `zod-to-json-schema`.
- [ ] Anti-cycle verifier passes (no forbidden monorepo deps).
- [ ] tsconfig path-mapping boundary rule passes (no ../core, ../providers, ../cli paths).
- [ ] Lockfile updated with packages/tools entry.
- [ ] Build and scaffold tests pass.
- [ ] No package cycles introduced.
- [ ] npm/package-lock process guards pass (package-lock.json exists, pnpm-lock.yaml absent, packages/tools in lockfile, core declares tools dep, providers declares tools dep, CLI has no direct tools dep).
- [ ] Public export manifest artifact exists (`analysis/tools-public-export-manifest.md`).

## Success Criteria

- All scaffold/build tests pass.
- Package metadata is correct.
- No package cycles.
- P14 owns all release workflow, sandbox, Dockerfile, version, prepare-package, release test, and bind-release-deps changes.
- `zod-to-json-schema` declared in tools dependencies.

## Failure Recovery

Return to P08 to fix package metadata, dependencies, or scaffold issues.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P08.md` with files modified, test results, anti-cycle verification output, and npm/package-lock guard results.
