# Phase 05: Package Scaffold Implementation

Plan ID: PLAN-20260608-ISSUE1586.P05

> **Filename matches content:** `05-package-scaffold-impl.md` — scaffold phase

## Prerequisites
- Required: Phase 04a completed

## Phase Tasks

1. Finalize packages/auth public API surface in src/index.ts (minimal: just package exports placeholder).
2. Ensure build produces correct dist/ structure.
3. Run lint and format on auth package.
4. Verify package metadata matches package-metadata-constraints.md.

## Verification Commands

```bash
npm run lint --workspace @vybestack/llxprt-code-auth
npm run format --workspace @vybestack/llxprt-code-auth
npm run typecheck --workspace @vybestack/llxprt-code-auth
npm run build --workspace @vybestack/llxprt-code-auth
npm run test --workspace @vybestack/llxprt-code-auth
node -e "const p=require('./packages/auth/package.json'); const deps=Object.keys(p.dependencies||{}); if(deps.some(d=>d.includes('vybestack'))) { console.error('FORBIDDEN'); process.exit(1) }"
```

## Success Criteria

- `npm run lint --workspace @vybestack/llxprt-code-auth` passes with zero errors
- `npm run typecheck --workspace @vybestack/llxprt-code-auth` passes
- `npm run build --workspace @vybestack/llxprt-code-auth` produces `dist/` with expected output
- `npm run test --workspace @vybestack/llxprt-code-auth` passes (placeholder tests if no real tests yet)
- Zero vybestack dependencies in auth package.json
- Package metadata matches `analysis/package-metadata-constraints.md`

## Failure Recovery

If this phase fails:

1. `git checkout -- packages/auth/src/index.ts` — revert public API changes
2. Verify P03 scaffold is intact: `npm run build --workspace @vybestack/llxprt-code-auth` must still work with empty index
3. Cannot proceed to P06 (interfaces) until scaffold builds correctly