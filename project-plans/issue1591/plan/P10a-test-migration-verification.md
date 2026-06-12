# Phase P10a: Test Migration Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P10 (test migration complete)

## Purpose

Verify that all test migration is correct, old test files properly moved, and the full test suite passes. No orphaned imports, no forbidden dependencies.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies migration quality)
- **Verifier**: deepthinker (confirms completeness)

## Exact File Tasks

None (verification only).

## Verification Commands

```bash
# 1. Policy package full test suite
npm run test --workspace @vybestack/llxprt-code-policy -- --reporter=verbose
# Expected: ALL pass

# 2. Core full test suite
npm run test --workspace @vybestack/llxprt-code-core -- --reporter=verbose
# Expected: ALL pass

# 3. Full workspace build and typecheck
npm run build
npm run typecheck

# 4. Verify no orphaned imports (old paths) — comprehensive scan of ALL policy/confirmation-bus relative imports
find packages/core/src -name '*.ts' ! -path '*/node_modules/*' -exec rg -l "from.*\.\./policy/(types|policy-engine|stable-stringify|utils|toml-loader|config)\.js" {} \;
# Expected: zero matches

find packages/core/src -name '*.ts' ! -path '*/node_modules/*' ! -name 'index.ts' -exec rg -l "from.*\.\./confirmation-bus/(types|message-bus)\.js" {} \;
# Expected: zero matches (only re-export shims should reference old paths)

# 5. Verify no @google/genai in policy package
rg "@google/genai" packages/policy/src --type ts
# Expected: zero matches (not in prod, dev, or test)

# 6. Verify no @vybestack/llxprt-code-core in policy package
rg "@vybestack/llxprt-code-core" packages/policy/src --type ts
# Expected: zero matches

# 7. Package boundary enforcement — policy package.json (prod AND dev)
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@google/genai', '@vybestack/llxprt-code-telemetry'];
  const prodDeps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('BOUNDARY VIOLATION in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: no forbidden deps (checked prod + dev)');
"

# 8. Circular dependency check via package manifests (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const core = JSON.parse(require('fs').readFileSync('packages/core/package.json', 'utf8'));
  const policyProdDeps = Object.keys(policy.dependencies || {});
  const policyDevDeps = Object.keys(policy.devDependencies || {});
  const policyAllDeps = [...policyProdDeps, ...policyDevDeps];
  const coreProdDeps = Object.keys(core.dependencies || {});
  const coreDevDeps = Object.keys(core.devDependencies || {});
  const coreAllDeps = [...coreProdDeps, ...coreDevDeps];
  // Check policy does not depend on core (prod or dev)
  if (policyAllDeps.includes('@vybestack/llxprt-code-core')) { console.error('CIRCULAR: policy depends on core'); process.exit(1); }
  // Check core does depend on policy (prod or dev)
  if (!coreAllDeps.includes('@vybestack/llxprt-code-policy')) { console.error('MISSING: core does not depend on policy'); process.exit(1); }
  console.log('PASS: dependency graph correct (checked prod + dev)');
"

# 9. Verify CLI tests still pass
npm run test --workspace @vybestack/llxprt-code-cli
# Expected: ALL pass

# 10. Verify lint passes
npm run lint

# 11. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591\.P10" packages/policy/src -g '*.test.ts' --count
rg "@plan.*PLAN-20260609-ISSUE1591\.P10" packages/core/src/policy -g '*.test.ts' --count
```

## Success Criteria

- [ ] All policy package tests pass (verbose)
- [ ] All core tests pass (verbose)
- [ ] Full workspace build and typecheck pass
- [ ] Zero orphaned old-path imports in core
- [ ] Zero @google/genai references in policy package
- [ ] Zero @vybestack/llxprt-code-core references in policy package
- [ ] Package boundary enforced (policy package.json has no forbidden deps)
- [ ] No circular dependencies (verified via package manifests)
- [ ] CLI tests pass
- [ ] Lint passes
- [ ] @plan markers present in all modified test files

## Failure Recovery

1. If orphaned imports found — update to use `@vybestack/llxprt-code-policy`
2. If policy has forbidden imports — fix immediately
3. If CLI tests fail — check CLI import updates (deferred to P10c)
4. Targeted fix only — do not re-run previous phases
