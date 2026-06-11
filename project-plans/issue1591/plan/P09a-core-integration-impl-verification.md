# Phase P09a: Core Integration Implementation Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P09 (core integration GREEN)

## Purpose

Thoroughly verify the core integration. All imports resolve correctly, backward compatibility maintained, no circular dependencies, no stale old files, package boundaries enforced.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies integration quality)
- **Verifier**: deepthinker (confirms backward compat and boundary enforcement)

## Exact File Tasks

None (verification only).

## @plan / @requirement Marker Verification

```bash
# Verify @plan markers in modified TypeScript source files only
# (JSON files like package.json and tsconfig.json cannot contain comments)
rg "@plan.*PLAN-20260609-ISSUE1591\.P09" packages/core/src --type ts --count
# Expected: 30+ files (all import-updated TS files and re-export shims)
rg "@requirement:REQ-006" packages/core/src --type ts --count
# Expected: 30+ files
```

## Verification Commands

```bash
# 1. Full core test suite
npm run test --workspace @vybestack/llxprt-code-core -- --reporter=verbose
# Expected: ALL pass

# 2. Full workspace build
npm run build
npm run typecheck

# 3. Verify no circular dependencies — policy must not import core
rg "from.*@vybestack/llxprt-code-core|from.*\.\.\/.*core" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 4. Circular dependency check via package manifests (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-telemetry', '@google/genai'];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('CIRCULAR/FORBIDDEN deps in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: no circular or forbidden deps in policy package.json (checked prod + dev)');
"

# 5. Verify core package.json has policy dep
rg "@vybestack/llxprt-code-policy" packages/core/package.json
# Expected: present

# 6. Package boundary — policy must not import from tools via deep paths
rg "from.*\.\./tools|from.*packages/tools" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches

# 7. Package boundary — policy package.json does not depend on core, providers, tools, CLI (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-telemetry', '@google/genai'];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('BOUNDARY VIOLATION in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: policy package.json has no forbidden dependencies (checked prod + dev)');
"

# 8. Backward compatibility — verify runtime exports (classes and enums only)
node -e "
  import('@vybestack/llxprt-code-core').then(m => {
    const required = ['PolicyEngine', 'PolicyDecision', 'ApprovalMode', 'MessageBus', 'MessageBusType', 'createPolicyEngineConfig', 'createPolicyUpdater'];
    const missing = required.filter(k => !(k in m));
    if (missing.length > 0) { console.error('MISSING:', missing); process.exit(1); }
    console.log('All', required.length, 'required runtime exports present from core');
  });
"

# 9. Backward compat aliases — verify runtime identity
node -e "
  import('@vybestack/llxprt-code-core').then(m => {
    console.log('ToolConfirmationOutcome:', typeof m.ToolConfirmationOutcome);
    console.log('ConfirmationOutcome:', typeof m.ConfirmationOutcome);
    if (m.ToolConfirmationOutcome !== m.ConfirmationOutcome) {
      console.error('ALIAS MISMATCH');
      process.exit(1);
    }
    console.log('Backward compat aliases OK');
  });
"

# 10. Type exports — verify via typecheck (not runtime node -e)
# TypeScript types (PolicyRule, PolicyEngineConfig, PolicySettings, ConfirmationPayload,
# PolicyFunctionCall, PolicyToolCallState, etc.) are erased at runtime.
# Create a typecheck-only test that imports these types:
npm run typecheck --workspace @vybestack/llxprt-code-core
# If typecheck passes, all type exports resolve correctly.

# 11. Verify old source files replaced with re-export shims
head -5 packages/core/src/policy/index.ts
# Expected: re-export from @vybestack/llxprt-code-policy

head -5 packages/core/src/confirmation-bus/index.ts
# Expected: re-export from @vybestack/llxprt-code-policy

head -5 packages/core/src/tools/tool-confirmation-types.ts
# Expected: re-export from @vybestack/llxprt-code-policy

# 12. Verify policy-helpers.ts still in core
ls packages/core/src/policy/policy-helpers.ts
# Expected: file exists

# 13. Verify config orchestration still in core
rg "createPolicyEngineConfig|createPolicyUpdater|persistPolicyToToml" packages/core/src/policy/config.ts
# Expected: all three present

# 14. Verify no TODO/FIXME/HACK/STUB — use rg --glob
rg "TODO|FIXME|HACK|STUB" packages/core/src/policy --type ts -g '!*.test.ts'
rg "TODO|FIXME|HACK|STUB" packages/core/src/confirmation-bus --type ts -g '!*.test.ts'
```

## Success Criteria

- [ ] Full core test suite passes
- [ ] Full workspace build and typecheck pass
- [ ] Zero circular dependencies (verified by source scan AND package manifest check)
- [ ] Backward compatibility: all required runtime exports present from core
- [ ] ToolConfirmationOutcome alias matches ConfirmationOutcome
- [ ] Re-export shims in place (policy/index.ts, confirmation-bus/index.ts, tool-confirmation-types.ts)
- [ ] policy-helpers.ts still in core
- [ ] createPolicyEngineConfig, createPolicyUpdater, persistPolicyToToml still in core
- [ ] Policy package.json has zero forbidden dependencies (programmatic check)
- [ ] Policy source has zero deep tool imports
- [ ] No TODO/FIXME/HACK/STUB
- [ ] @plan markers present in all modified core files
- [ ] @requirement markers map to REQ-006

## Failure Recovery

1. If backward compat broken — check re-export shims, add missing exports
2. If circular dep found — move the offending import to an injected interface
3. If orchestration moved incorrectly — revert config.ts changes, keep functions in core
4. If package.json boundary violated — remove forbidden dep from policy package.json
