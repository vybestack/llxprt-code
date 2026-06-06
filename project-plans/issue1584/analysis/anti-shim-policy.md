# Anti-Shim Policy

Plan ID: PLAN-20260603-ISSUE1584

## Allowed True Contracts

A true contract is allowed in core only when all conditions hold:

1. It is required by core runtime/config/history/tool behavior.
2. It is named for core runtime semantics, not as a provider package compatibility type.
3. It does not import from `@vybestack/llxprt-code-providers`.
4. It does not re-export a provider package symbol.
5. It has behavioral tests or compile tests proving core uses it directly.

Examples: `RuntimeProvider`, `RuntimeProviderManager`, `RuntimeTokenizer`, runtime missing-provider error.

## Forbidden Shims

A shim is forbidden if it does any of the following:

- Re-exports provider APIs from `packages/core/src/index.ts` or any core deep path.
- Preserves old provider import paths under `packages/core/src/providers/**`.
- Wraps providers package symbols only to avoid updating callers.
- Adds `V2`, `New`, `Copy`, `Compat`, or parallel implementation files.
- Adds providers as a production dependency of core while providers depends on core.

## Required Scans

```bash
rg -n "@vybestack/llxprt-code-providers" packages/core --glob '*.ts' --glob '!**/*.test.ts' --glob '!**/*.spec.ts'
rg -n "export .*providers|from ['"].*/providers/|from ['"]@vybestack/llxprt-code-core/providers" packages/core/src/index.ts packages/core/src --glob '*.ts'
find packages/core/src/providers -type f 2>/dev/null | sort
find packages -type f | rg "(V2|New|Copy|Compat).*Provider|Provider.*(V2|New|Copy|Compat)"
node -e "const p=require('./packages/core/package.json'); if ((p.dependencies||{})['@vybestack/llxprt-code-providers']) process.exit(1)"
```

Expected final result: no production core provider package imports, no core provider re-exports, no core provider wrapper directory, no compatibility-named provider files, and no core package dependency on providers.


## Package Metadata Anti-Cycle Checks

Also apply `analysis/package-metadata-constraints.md`. Core package metadata and core tsconfig must not depend on or reference providers. CLI must depend on providers. Providers must depend on core and direct provider SDK dependencies.


## Final Core Providers Directory Rule

The preferred and expected final state is zero production files under `packages/core/src/providers`. Any reclassified core-owned contracts/utilities must be moved to non-provider core paths such as `packages/core/src/runtime/contracts/`, `packages/core/src/runtime/errors/`, or a core utility path. Leaving files under `packages/core/src/providers` is allowed only for explicitly justified non-production artifacts during migration and must be eliminated before final cleanup unless P15a records an approved exception.
