# Phase 03a: Package Scaffold Stub Verification (Post-P03)

Plan ID: PLAN-20260608-ISSUE1586.P03a

> **Filename matches content:** `03a-package-scaffold-stub-verification.md` — scaffold phase

## Verification Tasks
- [ ] `npm install` succeeds without errors (lockfile updated)
- [ ] `npm run build --workspace @vybestack/llxprt-code-auth` succeeds (auth builds before core)
- [ ] Package manager gate passed (mandatory executable verification from P03 Step 0)
- [ ] `npm run typecheck --workspace @vybestack/llxprt-code-auth` passes
- [ ] `npm run build --workspace @vybestack/llxprt-code-auth` produces dist/
- [ ] Root workspaces include packages/auth BEFORE packages/core (build order)
- [ ] Core depends on @vybestack/llxprt-code-auth
- [ ] CLI depends on @vybestack/llxprt-code-auth
- [ ] Providers depends on @vybestack/llxprt-code-auth AND @vybestack/llxprt-code-core
- [ ] Auth package.json has ONLY zod as external dependency
- [ ] No core/cli/providers in auth package.json dependencies
- [ ] Core/providers/cli tsconfig path aliases include @vybestack/llxprt-code-auth if needed
- [ ] Core/providers/cli package.json dependencies include @vybestack/llxprt-code-auth
- [ ] Providers package.json also retains @vybestack/llxprt-code-core dependency

## Post-Scaffold Verification (previously labeled "preflight check for packages/auth/package.json")
- [ ] `packages/auth/package.json` exists with correct name, version, type
- [ ] `packages/auth/tsconfig.json` exists and extends root config
- [ ] `packages/auth/vitest.config.ts` exists
- [ ] `packages/auth/src/index.ts` exists (even if minimal)
- [ ] Package manager gate passed (exit 0) before any install commands