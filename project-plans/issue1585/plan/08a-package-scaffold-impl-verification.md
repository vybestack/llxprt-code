# Phase 08a: Scaffold Implementation Verification

## Phase ID

`PLAN-20260608-ISSUE1585.P08a`

## Purpose

Verify package builds, lockfile updated, no cycles were introduced, and package metadata is correct. P08a only verifies scaffold/build/package metadata — release workflow verification belongs to P14a.

## Prerequisites

- Required: P08 completed (package scaffold implemented).

## Verification Tasks

### Step 1: Build And Typecheck

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools
npm run build --workspace @vybestack/llxprt-code-tools
```

### Step 2: Verify Anti-Cycle Check

```bash
# Anti-cycle check: fail if any forbidden monorepo package is in tools dependencies
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; const forbidden=['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code']; for (const f of forbidden) { if (d[f]) { console.error('FORBIDDEN DEPENDENCY: '+f); process.exit(1); } }; console.log('Anti-cycle check passed');"
```

### Step 3: Verify tsconfig Path-Mapping Boundary Rule

```bash
# Verify no forbidden path mappings in tools tsconfig
node -e "const c=require('./packages/tools/tsconfig.json'); const paths=Object.keys(c.compilerOptions?.paths||{}); const refs=(c.references||[]).map(r=>r.path); const all=[...paths,...refs]; const forbidden=all.filter(p=>p.includes('../core')||p.includes('../providers')||p.includes('../cli')); if (forbidden.length) { console.error('FORBIDDEN TSCONFIG PATH:', JSON.stringify(forbidden)); process.exit(1); }; console.log('tsconfig path-mapping check passed');"
```

### Step 4: Verify Lockfile And Workspace

```bash
npm install
node -e "const p=require('./package-lock.json'); if (!p.packages['packages/tools']) process.exit(1)"
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/tools')) process.exit(1)"
```

### Step 5: Verify No Cycles

```bash
npm ls @vybestack/llxprt-code-core 2>&1 | grep -i cycle
npm ls @vybestack/llxprt-code-tools 2>&1 | grep -i cycle
```

### Step 6: Run Scaffold Tests

```bash
npm run test --workspace @vybestack/llxprt-code-tools
```

## Verification Commands

```bash
npm run typecheck --workspace @vybestack/llxprt-code-tools && \
npm run build --workspace @vybestack/llxprt-code-tools && \
node -e "const p=require('./packages/tools/package.json'); const d={...(p.dependencies||{}),...(p.devDependencies||{})}; ['@vybestack/llxprt-code-core','@vybestack/llxprt-code-providers','@vybestack/llxprt-code'].forEach(f => { if (d[f]) process.exit(1); });" && \
node -e "const c=require('./packages/tools/tsconfig.json'); const paths=Object.keys(c.compilerOptions?.paths||{}); const refs=(c.references||[]).map(r=>r.path); const all=[...paths,...refs]; if (all.filter(p=>p.includes('../core')||p.includes('../providers')||p.includes('../cli')).length) process.exit(1);" && \
npm run test --workspace @vybestack/llxprt-code-tools
```

## Semantic Verification Checklist

- [ ] Package builds.
- [ ] Anti-cycle verifier passes (no forbidden monorepo deps in tools package.json).
- [ ] tsconfig path-mapping boundary rule passes (no ../core, ../providers, ../cli paths).
- [ ] Lockfile includes packages/tools.
- [ ] No dependency cycles.
- [ ] Scaffold tests pass.

## Success Criteria

- All verification commands succeed.
- Package metadata is correct (anti-cycle, tsconfig boundary).
- No release workflow changes verified here (that is P14a scope).

## Failure Recovery

Return to P08 to fix scaffold/metadata issues.

## Phase Completion Marker

Create `project-plans/issue1585/.completed/P08a.md` with verification output.
