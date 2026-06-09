# Phase 18a: Cleanup Verification

Plan ID: PLAN-20260608-ISSUE1586.P18a

## Verification Tasks
- [ ] `packages/core/src/auth/` directory empty or removed
- [ ] `packages/core/src/auth-factories.ts` exists at correct path (NOT inside auth/ subdir)
- [ ] Core package.json `exports` field has no auth subpath entries (Node.js verifier exits only if `./auth/precedence.js` or `./auth/types.js` still present)
- [ ] Core index.ts re-exports auth from @vybestack/llxprt-code-auth only
- [ ] No V2/New/Compat/Copy auth files (verified by filename scan)
- [ ] No auth→core imports in auth package (canonical scan)
- [ ] No relative import escapes from packages/auth/src
- [ ] Auth package has only zod as npm dependency
- [ ] All builds pass for core, auth, CLI
- [ ] All typecheck passes
- [ ] `auth-precedence-resolver.ts` exists in `packages/auth/src/` and exports `AuthPrecedenceResolver` class
- [ ] `packages/auth/src/index.ts` re-exports `AuthPrecedenceResolver` from `auth-precedence-resolver.ts`

## Anti-Shim Gate
- [ ] No wrapper files in core/src/auth/
- [ ] No compatibility re-exports that are not direct `export ... from '@vybestack/llxprt-code-auth'`
- [ ] No forbidden dependency in auth package.json

## Repo-Wide Old-Path Scan (canonical, single instance)
- [ ] No `@vybestack/llxprt-code-core/auth` import paths anywhere in repo
- [ ] No `core/src/auth` relative import paths anywhere in repo