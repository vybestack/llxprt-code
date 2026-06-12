# Phase 06: Package Build And Release Wiring

## Phase ID

`PLAN-20260608-ISSUE1585.P06`

## Purpose

Wire packages/tools into the workspace build, typecheck, and release dependency binding. This phase handles metadata and wiring that P03 (scaffold + stubs) did not include: npm install for lockfile, tsconfig references, and bind-release-deps compatibility.

## Prerequisites

- Required: P05a completed (contract implementation verified).
- Artifacts: packages/tools with implemented utilities and passing tests.

## Requirements Implemented

### REQ-PKG-001, REQ-REL-001

**Full requirement blocks**: See `plan/requirements-appendix.md` → REQ-PKG-BOUNDARY, REQ-RELEASE-PROCESS

**Behavior specification**:
- GIVEN: Contract implementations are verified with zero forbidden imports
- WHEN: Build wiring is added (lockfile, tsconfig, bind-release-deps)
- THEN: package-lock.json includes tools; build succeeds; workspace listing shows tools; no cycles

**Why it matters**: Missing lockfile or build wiring means no downstream package can consume tools.

## Implementation Tasks

### Step 0: Create Tools Public Export Manifest

Create `analysis/tools-public-export-manifest.md` listing every symbol that P10 tests will need to import from `@vybestack/llxprt-code-tools`. This manifest maps each tested symbol (tool class, formatter, utility function, type) to its expected export path. P06-P08 must ensure stubs exist for every symbol listed.

### Step 1: Update package-lock.json

```bash
npm install
```

This records packages/tools in the lockfile as a workspace package.

### Step 2: Verify tsconfig References

Ensure packages/tools/tsconfig.json extends the root or follows the providers pattern correctly.

**tsconfig boundary rule**: `packages/tools/tsconfig.json` MUST allow only self path mappings. Path mappings or references to `../core`, `../providers`, or `../cli` are FORBIDDEN — they would create compile-time cycles. Verify with:

```bash
# Verify no forbidden path mappings in tools tsconfig
node -e "const c=require('./packages/tools/tsconfig.json'); const paths=Object.keys(c.compilerOptions?.paths||{}); const refs=(c.references||[]).map(r=>r.path); const all=[...paths,...refs]; const forbidden=all.filter(p=>p.includes('../core')||p.includes('../providers')||p.includes('../cli')); if (forbidden.length) { console.error('FORBIDDEN TSCONFIG PATH:', JSON.stringify(forbidden)); process.exit(1); }; console.log('tsconfig path-mapping check passed');"
```

This check MUST also be added as a permanent assertion in P07 scaffold tests.

### Step 3: Verify Build Works

```bash
npm run build --workspace @vybestack/llxprt-code-tools
```

### Step 4: Verify Bind-Release-Deps Compatibility

```bash
node scripts/bind-release-deps.js --dry-run 2>&1 | grep -i tools || echo "tools not yet in release deps (expected at this stage)"
```

### Files To Modify

- `package-lock.json` (auto-updated by npm install)

## Verification Commands

```bash
npm install
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
npm ls @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] package-lock.json includes packages/tools.
- [ ] Build succeeds for tools package.
- [ ] Workspace listing shows tools.
- [ ] No production code moved yet (only contracts/utilities from P05).

## Success Criteria

- Build passes for tools package.
- Lockfile updated.
- No cycles.

## Failure Recovery

Fix build or lockfile issues before proceeding.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P06.md` with build output and lockfile verification.
