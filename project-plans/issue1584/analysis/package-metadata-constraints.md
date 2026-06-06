# Package Metadata And Workspace Constraints

Plan ID: PLAN-20260603-ISSUE1584

## Required Final Dependency Direction

| Package | Must Depend On | Must Not Depend On | Notes |
|---------|----------------|--------------------|-------|
| `packages/providers` | `@vybestack/llxprt-code-core` plus direct provider SDK/runtime imports | `@vybestack/llxprt-code` CLI | Providers uses core deep modules temporarily. |
| `packages/cli` | `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers` | none specific | CLI constructs concrete providers/managers. |
| `packages/core` | no providers package | `@vybestack/llxprt-code-providers` | Prevents package cycle. |

## Required Checks

```bash
node -e "const p=require('./package.json'); if (!p.workspaces.includes('packages/providers')) process.exit(1)"
node -e "const p=require('./packages/providers/package.json'); if ((p.dependencies||{})['@vybestack/llxprt-code-core'] !== 'file:../core') process.exit(1)"
node -e "const p=require('./packages/cli/package.json'); const d=p.dependencies||{}; if (!d['@vybestack/llxprt-code-core'] || d['@vybestack/llxprt-code-providers'] !== 'file:../providers') process.exit(1)"
node -e "const p=require('./packages/core/package.json'); if ((p.dependencies||{})['@vybestack/llxprt-code-providers']) process.exit(1)"
node -e "const c=require('./packages/core/tsconfig.json'); if ((c.references||[]).some(r => String(r.path).includes('providers'))) process.exit(1)"
```

Run `npm install` after workspace/package dependency edits and commit `package-lock.json` changes produced by npm.


## Package Naming Decision

The new package name is `@vybestack/llxprt-code-providers`. This is intentional and follows the existing workspace naming convention (`@vybestack/llxprt-code-core`, `@vybestack/llxprt-code`, `@vybestack/llxprt-code-test-utils`). Any shorter name such as `@vybestack/llxprt-providers` in parent planning discussions is treated as illustrative, not the implementation name for this repository.


## TypeScript Resolution Strategy

The plan uses normal npm workspace package resolution after npm install, not root tsconfig path aliases, for @vybestack/llxprt-code-providers. Do not add providers to packages/core/tsconfig.json references because core must not depend on providers. Add packages/providers to root workspace/build references as needed, add ../providers reference/dependency only from packages that consume providers (for example CLI), and verify built runtime imports after npm run build.

Subpath imports from providers should be minimized. Prefer the providers package public index for external consumers. If package subpaths are required for migration, document each subpath in analysis/provider-move-map.md and verify both TypeScript and built runtime resolution.
