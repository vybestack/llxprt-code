# Phase 03: Package Scaffold Stub

Plan ID: PLAN-20260608-ISSUE1586.P03

> **Filename matches content:** `03-package-scaffold-stub.md` — scaffold phase

## Prerequisites
- Required: Phase 02c completed
- DI interfaces design complete in analysis artifacts

## Requirements Implemented

### REQ-AUTH-001.2: packages/auth follows workspace package conventions
**Behavior**: GIVEN existing workspace conventions, WHEN packages/auth is created, THEN it builds, typechecks, and runs tests using the same scripts as other packages.

### REQ-DEP-001.3: packages/auth depends only on zod and Node builtins
**Behavior**: GIVEN packages/auth package.json, WHEN npm install runs, THEN only zod appears as external dependency.

## Implementation Tasks

### Step 0: Package Manager Gate (Required Before Any npm Commands — Enforcing)

This gate is a **mandatory executable verification** that MUST pass (exit 0) before any install or lockfile commands in this phase. **If the gate exits non-zero, STOP the phase — do not allow any npm or pnpm commands to proceed.** Resolve the package-manager strategy inconsistency before continuing.

**If the gate determines CI uses `pnpm`**: **STOP** — do not proceed with npm or pnpm commands. An explicit package-manager strategy decision from the project owner is required before any install/lockfile commands. The gate must not recommend lockfile changes or tool switches within this phase. **Do NOT remove `package-lock.json` or `pnpm-lock.yaml`** — lockfile removal is out of scope and potentially destructive.

**If the gate determines CI uses `npm`**: proceed with npm commands; `package-lock.json` is the authoritative lockfile.

**Critical:** Do not allow both npm and pnpm paths to execute in the same phase. If the CI/lockfile strategy is inconsistent, the phase MUST stop for a strategy decision — never silently proceed with a mix of tools.

```bash
# Mandatory package-manager gate — exits non-zero on inconsistency
node -e "
const fs = require('fs');
const path = require('path');

// 1. Determine which package manager CI uses
let ciUsesPnpm = false;
let ciUsesNpm = false;
try {
  const workflowsDir = path.join(process.cwd(), '.github/workflows');
  const entries = fs.readdirSync(workflowsDir);
  for (const entry of entries) {
    const content = fs.readFileSync(path.join(workflowsDir, entry), 'utf8');
    if (/pnpm\s+(install|ci|run)/.test(content)) ciUsesPnpm = true;
    if (/npm\s+(install|ci|run)/.test(content)) ciUsesNpm = true;
  }
} catch (e) {
  console.error('WARN: No .github/workflows found; checking scripts in root package.json');
}

// 2. Check root package.json scripts and packageManager field
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const scripts = Object.values(root.scripts || {});
const scriptsUseNpm = scripts.some(s => typeof s === 'string' && /\bnpm\b/.test(s));
const scriptsUsePnpm = scripts.some(s => typeof s === 'string' && /\bpnpm\b/.test(s));
const declaredPm = root.packageManager || '';

// 3. Check lockfile presence
const hasPackageLock = fs.existsSync('package-lock.json');
const hasPnpmLock = fs.existsSync('pnpm-lock.yaml');

// 4. Resolve: which PM does CI actually use?
let effectivePm;
if (ciUsesNpm && !ciUsesPnpm) {
  effectivePm = 'npm';
} else if (ciUsesPnpm && !ciUsesNpm) {
  effectivePm = 'pnpm';
} else if (ciUsesNpm && ciUsesPnpm) {
  console.error('FAIL: CI workflows use both npm and pnpm — resolve ambiguity first');
  process.exit(1);
} else {
  // No CI workflows found; fall back to scripts convention
  if (scriptsUseNpm && !scriptsUsePnpm) effectivePm = 'npm';
  else if (scriptsUsePnpm && !scriptsUseNpm) effectivePm = 'pnpm';
  else {
    console.error('FAIL: Cannot determine package manager — no CI workflows and ambiguous scripts');
    process.exit(1);
  }
}

// 5. Verify lockfile consistency
if (effectivePm === 'npm') {
  if (!hasPackageLock) {
    console.error('FAIL: CI uses npm but package-lock.json is missing');
    process.exit(1);
  }
  console.log('OK: CI uses npm; package-lock.json is authoritative');
  if (hasPnpmLock) {
    console.error('NOTE: pnpm-lock.yaml exists alongside npm; package-lock.json takes precedence.');
  }
  if (declaredPm && declaredPm.startsWith('pnpm')) {
    // packageManager declares pnpm but CI uses npm — this is a conflict that must block
    console.error('FAIL: packageManager field declares pnpm but CI uses npm — resolve this conflict before proceeding');
    process.exit(1);
  }
} else {
  // pnpm
  if (!hasPnpmLock) {
    console.error('FAIL: CI uses pnpm but pnpm-lock.yaml is missing');
    process.exit(1);
  }
  console.log('OK: CI uses pnpm; pnpm-lock.yaml is authoritative');
  if (hasPackageLock) {
    console.error('NOTE: package-lock.json exists alongside pnpm; pnpm-lock.yaml is authoritative per CI.');
  }
}

process.exit(0);
"
```

## Step 1: Create Package Scaffold
- `packages/auth/package.json` — `@vybestack/llxprt-code-auth`, version 0.10.0, deps: zod only
  - MUST include: `@plan:PLAN-20260608-ISSUE1586.P03`
- `packages/auth/tsconfig.json` — extends root, outDir dist, rootDir src
- `packages/auth/vitest.config.ts` — following packages/core pattern
- `packages/auth/src/index.ts` — initially empty or minimal placeholder

### Step 2: Register Workspace and Dependencies
- Root `package.json` — add `packages/auth` to workspaces BEFORE `packages/core` (build order)
- `packages/core/package.json` — add `@vybestack/llxprt-code-auth: "file:../auth"` to dependencies
- `packages/cli/package.json` — add `@vybestack/llxprt-code-auth: "file:../auth"` to dependencies
- `packages/providers/package.json` — add `@vybestack/llxprt-code-auth: "file:../auth"` to dependencies (retaining existing `@vybestack/llxprt-code-core: "file:../core"` dependency for non-auth utilities like `SettingsService`)
  - **Intentional early metadata stabilization:** The providers auth dependency is registered here (P03) before provider imports migrate (P15–P17). This is deliberate: it stabilizes package metadata (workspaces, dependencies, lockfile, tsconfig paths) in one atomic scaffold step, ensuring `npm install` and `npm run build --workspaces` work correctly from P03 onward. Actual provider import migration happens in P15–P17; the dependency is simply unused until then.

### Step 3: Update Consumer tsconfig Files
- `packages/core/tsconfig.json` — add paths alias for `@vybestack/llxprt-code-auth` → `../auth/src/index.ts`
- `packages/cli/tsconfig.json` — add paths alias for `@vybestack/llxprt-code-auth` → `../auth/src/index.ts`
- `packages/providers/tsconfig.json` — add paths alias for `@vybestack/llxprt-code-auth` → `../auth/src/index.ts`
- If any consumer uses TypeScript project references, add reference to `../auth`

### Step 4: Install and Lockfile Update (REQUIRED — NOT OPTIONAL)
- Run `npm install` to regenerate `package-lock.json` with the new workspace package
- This step MUST happen before any `npm run build` or `npm run typecheck` commands
- Verify `package-lock.json` has been updated: `git diff package-lock.json | head -20` should show auth package entries
- **Note on lockfile reconciliation:** A `package-lock.json` file exists at the repo root alongside `pnpm-lock.yaml`. The root `package.json` declares `"packageManager": "pnpm@..."`, but all project scripts and CI use npm commands (`npm run build`, `npm run test`, etc.). The package manager gate (P00a/P03 Step 0) must verify which manager CI uses. If npm: `package-lock.json` is authoritative and must be updated by `npm install`. If pnpm: STOP for a strategy decision; do not proceed with mixed tooling.

### Step 5: Verify
- Run verification commands below
- Fresh checkout test: `npm install && npm run build --workspaces` must pass without additional steps

**Note:** This phase creates the package scaffold BEFORE any auth source or test files are added. DI interface stubs (P06) and auth code (P09) are created after this scaffold is verified.

## Verification Commands

**IMPORTANT — Package manager reconciliation gate:** Step 0 MUST pass (exit 0) before any install/lockfile commands. If CI/lockfile strategy is inconsistent, the phase MUST stop — do not allow both npm and pnpm paths to execute. **Do NOT remove `package-lock.json` or `pnpm-lock.yaml`** — instead, stop and require a package-manager strategy decision.

```bash
# Step 4 verification: lockfile updated
npm install
test -f package-lock.json && echo "OK: lockfile exists"
git diff --quiet package-lock.json && echo "WARN: lockfile unchanged" || echo "OK: lockfile updated"

# Build order verification: auth must be before core in workspaces
node -e "const p=require('./package.json'); const ws=p.workspaces; const ai=ws.indexOf('packages/auth'); const ci=ws.indexOf('packages/core'); if(ai===-1){console.error('FAIL: packages/auth not in workspaces');process.exit(1)} if(ci===-1){console.error('FAIL: packages/core not in workspaces');process.exit(1)} if(ai>ci){console.error('FAIL: auth must come before core');process.exit(1)} console.log('OK: auth at index',ai,'core at index',ci)"

# Typecheck and build
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth

# Cycle detection
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys(p.dependencies||{}); if(deps.some(d=>d.includes('vybestack'))) { console.error('FORBIDDEN'); process.exit(1) }"

# Consumer dependency verification
node -e "const p=require('./packages/core/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: core must depend on auth'); process.exit(1) }"
node -e "const p=require('./packages/cli/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: cli must depend on auth'); process.exit(1) }"
node -e "const p=require('./packages/providers/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: providers must depend on auth'); process.exit(1) }"

# P03 verification narrows to auth-package typecheck + build + metadata.
# A full `npm run build --workspaces` is deferred to P05a (scaffold impl)
# when auth has more content, and then verified comprehensively in P19
# (full verification) when auth has its complete public API.
# Running full workspace build at P03 is not justified: auth is empty/minimal
# and consumer imports have not migrated yet.

npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth

# Fresh checkout simulation (optional/manual in disposable worktree only)
# See analysis/package-metadata-constraints.md for safe alternatives
# npm ci && npm run build --workspaces
```

**Success criteria:**
- `npm install` succeeds and updates `package-lock.json`
- `npm run typecheck --workspace @vybestack/llxprt-code-auth` passes
- `npm run build --workspace @vybestack/llxprt-code-auth` produces `dist/`
- Auth workspace entry appears before core in root `package.json` workspaces
- No cycle: auth package.json has zero vybestack dependencies
- All consumer packages list `@vybestack/llxprt-code-auth` in dependencies
- P03 verification narrows to auth-package typecheck + build + metadata; full workspace build deferred to P05a and P19