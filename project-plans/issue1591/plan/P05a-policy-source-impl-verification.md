# Phase P05a: Policy Source Implementation Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P05 (policy source GREEN)

## Purpose

Thoroughly verify the policy source implementation. All tests pass, no forbidden dependencies, correct public API surface, TOML loading works from source and dist.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies implementation quality)
- **Verifier**: deepthinker (confirms semantic correctness)

## Exact File Tasks

None (verification only).

## @plan / @requirement Marker Verification

```bash
# Verify @plan markers in all production files
rg "@plan.*PLAN-20260609-ISSUE1591\.P05" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 7+ files

# Verify @requirement markers
rg "@requirement:REQ-002" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 5+ files
rg "@requirement:REQ-004" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 1+ file (config.ts)
```

## Verification Commands

```bash
# 1. Full test suite for policy package
npm run test --workspace @vybestack/llxprt-code-policy -- --reporter=verbose
# Expected: ALL tests pass

# 2. Type checking
npm run typecheck --workspace @vybestack/llxprt-code-policy
# Expected: no errors

# 3. Build
npm run build --workspace @vybestack/llxprt-code-policy
# Expected: dist/ directory created successfully

# 4. Forbidden dependency scan (production code) — use rg --glob
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry|from.*@vybestack/llxprt-code-providers|from.*@vybestack/llxprt-code-cli|from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 5. Forbidden dependency scan (test code)
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry" packages/policy/src -g '*.test.ts'
# Expected: zero matches

# 6. TOML loading behavioral test — source path
npm run test --workspace @vybestack/llxprt-code-policy -- --testNamePattern="loadDefaultPolicies"
# Expected: loads bundled TOML files from source correctly

# 7. TOML loading behavioral test — dist path
npm run build --workspace @vybestack/llxprt-code-policy
node -e "
  import('./packages/policy/dist/index.js').then(async m => {
    const rules = await m.loadDefaultPolicies();
    console.log('Rule count from dist:', rules.length);
    console.log('Sample priorities:', rules.slice(0, 3).map(r => r.priority));
    if (rules.length === 0) { console.error('FAIL: no rules loaded from dist'); process.exit(1); }
    console.log('PASS: TOML loading works from dist');
  }).catch(e => { console.error('FAIL:', e); process.exit(1); });
"

# 8. Verify public API surface via typecheck (not runtime)
npm run typecheck --workspace @vybestack/llxprt-code-policy
# The typecheck itself verifies all exported types resolve correctly.
# PolicyRule, PolicyEngineConfig, PolicySettings, ConfirmationPayload, etc. are
# TypeScript types that are erased at runtime — verify via compilation, not node -e.

# 9. Verify no TODO/FIXME/HACK/STUB in production code
rg "TODO|FIXME|HACK|STUB" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 10. Verify @plan markers
rg "@plan.*PLAN-20260609-ISSUE1591" packages/policy/src --type ts -g '!*.test.ts' --count
# Expected: 7+ files
```

## Success Criteria

- [ ] All policy package tests pass (verbose output reviewed)
- [ ] Type checking passes with no errors
- [ ] Build succeeds, dist/ created
- [ ] Zero forbidden imports in production AND test code
- [ ] TOML loading works from both source and dist (behavioral test with rule count)
- [ ] loadDefaultPolicies() returns expected rule count from new location
- [ ] No TODO/FIXME/HACK/STUB in production code
- [ ] @plan markers present in all production files
- [ ] @requirement markers map to REQ-002, REQ-004, REQ-005

## Failure Recovery

1. If forbidden import found — fix immediately, do not proceed
2. If TOML loading fails from dist — check path resolution in config.ts
3. If public API surface incomplete — add missing exports to src/index.ts
4. If tests fail — fix source code, do NOT modify tests (they were verified in P04a)
