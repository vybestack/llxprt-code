# Package Metadata Constraints

Plan ID: PLAN-20260608-ISSUE1586

## Required Final State

| File | Required Content | Required Absence |
|------|-----------------|-----------------|
| Root `package.json` | `workspaces` includes `packages/auth` BEFORE `packages/core` (build order) | — |
| `packages/auth/package.json` | `name`: `@vybestack/llxprt-code-auth`; `version`: `0.10.0`; `type`: `module`; `main`: `dist/index.js`; `types`: `dist/index.d.ts`; `dependencies`: `{ "zod": "^3.25.76" }`; `devDependencies`: `{ "typescript": "^5.x", "vitest": "^3.x", "eslint": "^9.x", "prettier": "^3.x", "@types/node": "^22.x" }` (versions matching existing packages); standard scripts (build, test, lint, format, typecheck) | No `@vybestack/*` in `dependencies` OR `devDependencies`; no `@napi-rs/keyring`; no provider SDKs |

**Production dependency constraint:** `packages/auth/package.json` `dependencies` MUST contain only `zod` (and Node builtins implicit in the runtime). Zero `@vybestack/*` packages are allowed in `dependencies`. This is enforced by the shared verifier script (Check 1) and by the cycle detection in Check 10.

**Dev/test dependency constraint:** `packages/auth/package.json` `devDependencies` MUST also contain zero `@vybestack/*` packages. Auth tests that need core or providers symbols must use local DI test doubles defined within `packages/auth`, not import from sibling packages. The only exception is if a verifier/test-only rule explicitly requires importing from a sibling package for build-order or type-compatibility checks — but no such exception exists in this plan. All auth tests use local DI test doubles (see `analysis/auth-file-classification.md` Test Migration Policy, which requires 7 tests to be refactored with local DI doubles before moving to auth). The shared verifier script (Check 1) enforces this: it checks both `dependencies` and `devDependencies` for any `@vybestack/*` entries and fails the gate if found.

**Note on `@napi-rs/keyring`:** `@napi-rs/keyring` is forbidden in `packages/auth/package.json` because auth does not directly depend on the keyring native module. Auth uses the `ISecureStore` DI interface; core's `SecureStore` implementation uses `@napi-rs/keyring` internally. The P00a preflight verification checks `@napi-rs/keyring` availability to confirm it remains available for core's `SecureStore` — NOT as an auth dependency. Auth never imports `@napi-rs/keyring` directly; it only consumes the `ISecureStore` interface which core implements. `KeyringTokenStore` does retain Node builtins (`node:fs/promises`, `node:path`, `node:os`) for file-lock/fallback coordination, which is accepted as interim design.

**Package manager note:** P03 includes a mandatory executable gate that verifies which package manager CI uses. **If CI/lockfile strategy is inconsistent, the gate MUST stop the phase — do not allow both npm and pnpm paths to execute.** If CI uses pnpm, all npm commands must be replaced with pnpm equivalents. **Do NOT remove `package-lock.json`** — stop and require a package-manager strategy decision instead. Both `package-lock.json` and `pnpm-lock.yaml` exist at the repo root; the gate resolves which is authoritative.

| `packages/auth/tsconfig.json` | Extends root config; `outDir: "dist"`; `rootDir: "src"` | No references to core/cli/providers |
| `packages/core/tsconfig.json` | Paths alias for `@vybestack/llxprt-code-auth` if needed; references `packages/auth` if project references enabled | — |
| `packages/cli/tsconfig.json` | Paths alias for `@vybestack/llxprt-code-auth` if needed; references `packages/auth` if project references enabled | — |
| `packages/providers/tsconfig.json` | Paths alias for `@vybestack/llxprt-code-auth` if needed | — |

## Build Order and Lockfile

After adding `packages/auth` to workspaces:
1. Add workspace entry in root `package.json` workspaces array BEFORE `packages/core`.
2. Run `npm install` to update `package-lock.json`.
3. Verify `npm run build --workspaces` succeeds (auth before core in build order).
## Package Manager Reconciliation

The root `package.json` declares `"packageManager": "pnpm@10.17.0+sha512..."` and a `pnpm-lock.yaml` exists at the repo root. However, a `package-lock.json` also exists, and all project scripts and CI use npm commands (`npm run build`, `npm run test`, `npm run typecheck`, etc.).

**Authoritative package manager MUST be verified at preflight (P00a/P03 gate).** The gate MUST inspect three signals: (1) the `packageManager` field in root `package.json`, (2) which lockfiles are present (`package-lock.json`, `pnpm-lock.yaml`, or both), and (3) what package manager commands CI workflow files actually use. If these signals conflict (e.g., `packageManager` declares pnpm but CI uses npm, or both lockfiles are present), the gate MUST exit non-zero and STOP the phase. The phase MUST NOT proceed with any install/lockfile commands until a strategy decision resolves the inconsistency. **Do NOT delete `package-lock.json` or `pnpm-lock.yaml`** — the gate determines which is authoritative and requires a strategy decision if they conflict.

1. Run the mandatory executable gate script (see P00a/P03 Step 0). The gate inspects CI workflow files and **exits non-zero on any inconsistency** — it does NOT permit proceeding with mixed npm/pnpm paths. If the gate exits non-zero, the phase MUST stop for a strategy decision before any install or lockfile commands.
2. If CI uses `npm` (the expected case based on project scripts): `npm install`/`npm ci` commands and `package-lock.json` are authoritative. The `pnpm-lock.yaml` and `packageManager` field are stale artifacts that contradict actual CI practice. Document this discrepancy but proceed with npm.
3. If CI uses `pnpm`: **STOP** — do not proceed with npm or pnpm commands. An explicit package-manager strategy decision from the project owner is required. **Do NOT remove `package-lock.json`** — stop and require a package-manager strategy update decision instead.

**Why npm commands are likely required:** The workspace configuration (`workspaces` array in root `package.json`) and all scripts (`npm run build --workspaces`, `npm run test --workspace @vybestack/llxprt-code-auth`, etc.) are npm workspace commands. Running these under pnpm would require script changes and a different workspace configuration approach.

**Lockfile handling:** If npm is authoritative: `package-lock.json` is updated by `npm install`/`npm ci` commands. If the `packageManager` field declares pnpm while CI uses npm, this is a **blocking conflict** — STOP and require a package-manager strategy decision before proceeding. Do not merely document the discrepancy. If pnpm is authoritative: STOP for a strategy decision; do not proceed with mixed tooling. Do NOT remove `package-lock.json` or `pnpm-lock.yaml`.

4. Verify `npm run typecheck` passes for all workspace packages.
5. Fresh checkout test: `npm install && npm run build --workspaces` must pass without additional steps.

## TypeScript Configuration Requirements

### Root Workspace Build Order

The root `package.json` `workspaces` array determines `npm run build --workspaces` order. `packages/auth` MUST appear before `packages/core` to ensure auth builds first:

```json
{
  "workspaces": [
    "packages/auth",
    "packages/core",
    "packages/providers",
    "packages/cli",
    ...
  ]
}
```

### Consumer tsconfig Path Aliases

Consumer packages (core, cli, providers) that import from `@vybestack/llxprt-code-auth` MUST have TypeScript path aliases configured so `tsc --noEmit` resolves the package:

**`packages/core/tsconfig.json`:**
```json
{
  "compilerOptions": {
    "paths": {
      "@vybestack/llxprt-code-auth": ["../auth/src/index.ts"],
      "@vybestack/llxprt-code-auth/*": ["../auth/src/*"]
    }
  }
}
```

**`packages/cli/tsconfig.json` and `packages/providers/tsconfig.json`:**
Same pattern with appropriate relative path to `../auth/src/index.ts`.

### Consumer tsconfig Project References (if applicable)

If any consumer package uses TypeScript project references, add a reference to `packages/auth/tsconfig.json`:

```json
{
  "references": [
    { "path": "../auth" }
  ]
}
```

### Verification Commands

```bash
# After adding workspace entry, dependencies, and tsconfig aliases:
npm install
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-core
npm run typecheck --workspace @vybestack/llxprt-code-providers
npm run typecheck --workspace @vybestack/llxprt-code
npm run build --workspaces
```

### Fresh Checkout Verification (Optional / Manual)

This verification confirms that a clean environment can build the project from scratch. Because it destroys `node_modules`, it should only be run in a disposable context:

```bash
# WARNING: This removes node_modules. Use one of these safe alternatives:
#
# Option A: Use a git worktree (recommended for CI or local verification)
#   git worktree add /tmp/issue1586-checkout main
#   cd /tmp/issue1586-checkout
#   npm install && npm run build --workspaces
#   git worktree remove /tmp/issue1586-checkout
#
# Option B: Use npm ci (preserves lockfile integrity without removing node_modules)
npm ci && npm run build --workspaces
#
# Option C: Full fresh checkout (manual, in a throwaway clone)
#   cd /tmp && git clone <repo-url> issue1586-fresh && cd issue1586-fresh
#   npm install && npm run build --workspaces
#   rm -rf /tmp/issue1586-fresh
```

## Required Package Script Conventions

`packages/auth/package.json` scripts must match existing conventions:

```json
{
  "build": "node ../../scripts/build_package.js",
  "lint": "eslint . --ext .ts,.tsx",
  "format": "prettier --write .",
  "test": "vitest run",
  "test:ci": "vitest run",
  "typecheck": "tsc --noEmit"
}
```

**Note on format script:** Root `package.json` uses `prettier --experimental-cli --write .`, while existing packages use `prettier --write .`. The auth package follows the existing package convention (`prettier --write .`). Confirm at preflight that this convention is still current by checking `packages/core/package.json` format script.

## Exports Field

`packages/auth/package.json` SHOULD include an `exports` field following core's pattern:

```json
{
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js"
    }
  }
}
```

No sub-path exports initially. Consumers import from the main entry point. If deep-path access is needed (e.g., for providers importing `CodexOAuthTokenSchema`), add sub-path exports explicitly.

## Dependency Direction Enforcement

### Build Order

The build must proceed in dependency order:
1. `packages/auth` (no vybestack deps)
2. `packages/core` (depends on auth)
3. `packages/providers` (depends on auth AND core)
4. `packages/cli` (depends on core, auth, providers)

### Cycle Detection

```bash
# Verify no cycle: auth must not depend on core/cli/providers in dependencies OR devDependencies
# Production deps have zero @vybestack/*; devDeps also have zero @vybestack/*
# (Auth tests use local DI test doubles, not sibling package imports)
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys({...p.dependencies,...p.devDependencies}); if(deps.some(d=>d.startsWith('@vybestack/'))) { console.error('CYCLE RISK:',deps.filter(d=>d.startsWith('@vybestack/'))); process.exit(1) }"

# Verify core depends on auth
node -e "const p=require('./packages/core/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: core must depend on auth'); process.exit(1) }"

# Verify cli depends on auth
node -e "const p=require('./packages/cli/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: cli must depend on auth'); process.exit(1) }"

# Verify providers depends on auth
node -e "const p=require('./packages/providers/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-auth']) { console.error('MISSING: providers must depend on auth'); process.exit(1) }"

# Verify providers also depends on core (non-auth utilities: SettingsService, etc.)
node -e "const p=require('./packages/providers/package.json'); const deps=p.dependencies||{}; if(!deps['@vybestack/llxprt-code-core']) { console.error('MISSING: providers must depend on core for non-auth utilities'); process.exit(1) }"
```

## Workspace Registration

```bash
# Root package.json workspaces must include packages/auth
node -e "const p=require('./package.json'); if(!p.workspaces.includes('packages/auth')) { console.error('MISSING: packages/auth not in workspaces'); process.exit(1) }"
```