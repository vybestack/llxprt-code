# Phase 09a: Auth Move Stub Verification

Plan ID: PLAN-20260608-ISSUE1586.P09a

## Verification Tasks
- [ ] All 15 core auth production files exist in packages/auth/src/ (or stubs)
- [ ] All 20 test files exist in packages/auth/src/__tests__/ and packages/auth/src/proxy/__tests__/
  - 10 root-level test files → `packages/auth/src/__tests__/`

## Test Migration Enforcement
- [ ] Auth-package tests use only local DI test doubles (no core/providers imports)
- [ ] `rg -n "@vybestack/llxprt-code-core|@vybestack/llxprt-code-providers" packages/auth/src --glob '*.test.ts' --glob '*.spec.ts'` returns zero matches
- [ ] All 20 original test files have `packages/auth` as explicit final destination
  - 13 tests with no cross-package deps: moved as-is
  - 7 tests with cross-package deps: refactored with DI test doubles then moved
- [ ] Zero test files relocated to owning packages (all 20 in `packages/auth`)
- [ ] Zero test files remain under `packages/core/src/auth/`
- [ ] Stubs throw NotYetImplemented (DI not yet wired)
- [ ] Moved files compile with typecheck
- [ ] No core import in auth package production code
- [ ] No relative import escape from packages/auth/src
- [ ] `npm run build --workspace @vybestack/llxprt-code-auth` succeeds (with stubs compiling)

## Move Map Coverage
- [ ] Every entry in auth-move-map.md has a corresponding file in packages/auth (production) or its assigned final destination (tests)
- [ ] All 15 production file moves accounted for in packages/auth
- [ ] All 20 test files accounted for in `packages/auth`
- [ ] Zero test files remain under packages/core/src/auth/