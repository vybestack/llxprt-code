# Phase P11a: Final Review

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Review
Prerequisites: P11 (full build and test suite passed)

## Purpose

Comprehensive final review of the entire extraction. Verify all acceptance criteria from the specification are met, all requirements are satisfied, and no issues remain.

## Worker / Verifier Assignment

- **Worker**: deepthinker (comprehensive final review)
- **Verifier**: deepthinker (self-review with documented assessment)

## Expanded Requirements

- Verify all REQ-001 through REQ-008 acceptance criteria from specification.md
- Verify zero policy dependency on core, providers, tools, CLI, @google/genai, telemetry
- Verify backward compatibility — all existing `@vybestack/llxprt-code-core` imports work
- Verify no circular dependencies (via package manifests AND source scans)
- Verify no TODO/FIXME/HACK/STUB in policy production code
- Verify public API surface matches specification
- Review execution-tracker.md — all phases marked complete

## Exact File Tasks

None (review only — all code changes complete).

## Verification Commands

```bash
# ============================================================
# REQ-008: No Circular Dependencies
# ============================================================
echo "=== REQ-008: No Circular Dependencies ==="

# Source-level check: policy must not import from core
rg "from.*@vybestack/llxprt-code-core" packages/policy/src --type ts -g '!*.test.ts' && echo "FAIL" || echo "PASS: no core imports in policy source"

# Source-level check: policy must not import from providers
rg "from.*@vybestack/llxprt-code-providers" packages/policy/src --type ts && echo "FAIL" || echo "PASS"

# Source-level check: policy must not import from CLI
rg "from.*@vybestack/llxprt-code-cli" packages/policy/src --type ts && echo "FAIL" || echo "PASS"

# Source-level check: policy must not import from @google/genai
rg "@google/genai" packages/policy/src --type ts && echo "FAIL" || echo "PASS"

# Source-level check: policy must not import from telemetry
rg "@vybestack/llxprt-code-telemetry" packages/policy/src --type ts && echo "FAIL" || echo "PASS"

# Source-level check: policy must not import from tools
rg "from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts && echo "FAIL" || echo "PASS"

# Package manifest check: policy package.json (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@google/genai', '@vybestack/llxprt-code-telemetry'];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('FORBIDDEN deps in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: package manifest clean (checked prod + dev)');
"

# Circular dependency check: workspace dependency graph (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const core = JSON.parse(require('fs').readFileSync('packages/core/package.json', 'utf8'));
  const cli = JSON.parse(require('fs').readFileSync('packages/cli/package.json', 'utf8'));
  const policyAllDeps = [...Object.keys(policy.dependencies || {}), ...Object.keys(policy.devDependencies || {})];
  const coreAllDeps = [...Object.keys(core.dependencies || {}), ...Object.keys(core.devDependencies || {})];
  // Policy must NOT depend on core, providers, tools, CLI, telemetry, genai (prod or dev)
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-telemetry', '@google/genai'];
  const violations = policyAllDeps.filter(d => forbidden.includes(d));
  if (violations.length > 0) { console.error('FORBIDDEN deps in policy (prod or dev):', [...new Set(violations)]); process.exit(1); }
  // Core SHOULD depend on policy
  if (!coreAllDeps.includes('@vybestack/llxprt-code-policy')) { console.error('MISSING: core → policy'); process.exit(1); }
  console.log('PASS: dependency graph correct (checked prod + dev, core → policy, no forbidden reverse)');
"

# ============================================================
# REQ-001: Package Creation
# ============================================================
echo "=== REQ-001: Package Creation ==="
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  console.log('Package name:', pkg.name);
  console.log('Has @iarna/toml:', '@iarna/toml' in pkg.dependencies);
  console.log('Has zod:', 'zod' in pkg.dependencies);
  console.log('Has @google/genai:', '@google/genai' in (pkg.dependencies || {}));
  console.log('Has @vybestack/llxprt-code-core:', '@vybestack/llxprt-code-core' in (pkg.dependencies || {}));
  console.log('Has @vybestack/llxprt-code-telemetry:', '@vybestack/llxprt-code-telemetry' in (pkg.dependencies || {}));
"
# Expected: only name, @iarna/toml, zod — no forbidden deps

# ============================================================
# Backward Compatibility — Runtime exports (classes, enums, functions only)
# ============================================================
echo "=== Backward Compatibility — Runtime ==="
node -e "
  import('@vybestack/llxprt-code-core').then(m => {
    // Only check RUNTIME values (classes, enums, functions).
    // TypeScript types (PolicyRule, PolicyEngineConfig, PolicySettings, etc.)
    // are erased at runtime — see typecheck test below.
    const runtime = [
      'PolicyEngine', 'PolicyDecision', 'ApprovalMode',
      'MessageBus', 'MessageBusType',
      'ToolConfirmationOutcome', 'ConfirmationOutcome',
      'createPolicyEngineConfig', 'createPolicyUpdater',
      'DEFAULT_CORE_POLICIES_DIR', 'DEFAULT_POLICY_TIER',
      'USER_POLICY_TIER', 'ADMIN_POLICY_TIER',
      'getPolicyDirectories', 'getPolicyTier', 'formatPolicyError',
      'migrateLegacyApprovalMode',
      'loadPoliciesFromToml', 'loadPolicyFromToml', 'loadDefaultPolicies',
      'stableStringify', 'stableParse', 'escapeRegex', 'buildArgsPatterns'
    ];
    const missing = runtime.filter(k => !(k in m));
    if (missing.length > 0) { console.error('MISSING runtime exports:', missing); process.exit(1); }
    console.log('All', runtime.length, 'required runtime exports present from core');
    console.log('ToolConfirmationOutcome === ConfirmationOutcome:', m.ToolConfirmationOutcome === m.ConfirmationOutcome);
  });
"

# ============================================================
# Type Exports — Verified via typecheck (NOT runtime node -e)
# ============================================================
echo "=== Type Exports — Verified via typecheck ==="
# TypeScript types (PolicyRule, PolicyEngineConfig, PolicySettings, ConfirmationPayload,
# PolicyFunctionCall, PolicyToolCallState, SerializableConfirmationDetails, PolicyConfigSource,
# PolicyPathResolver, PolicyLogger, MessageBusMessage, ToolConfirmationRequest, etc.)
# are compile-time only. They are ERASED at runtime, so `node -e "'PolicyRule' in m"` is FALSE NEGATIVE.
# The correct verification is that typecheck passes — if it does, all type exports resolve.
npm run typecheck
# Expected: zero type errors → all type exports resolve correctly

# ============================================================
# Source + Dist TOML Load Behavioral Tests
# ============================================================
echo "=== TOML Load Behavioral Test ==="
npm run build --workspace @vybestack/llxprt-code-policy
node -e "
  import('./packages/policy/dist/index.js').then(async m => {
    const rules = await m.loadDefaultPolicies();
    console.log('Rule count:', rules.length);
    console.log('Rules:', rules.map(r => ({ name: r.name, decision: r.decision, priority: r.priority })));
    if (rules.length === 0) { console.error('FAIL: no rules'); process.exit(1); }
    // Verify expected rule properties
    for (const r of rules) {
      if (!r.name) { console.error('FAIL: rule missing name'); process.exit(1); }
      if (r.priority === undefined) { console.error('FAIL: rule missing priority'); process.exit(1); }
    }
    console.log('PASS:', rules.length, 'rules loaded from dist with name and priority');
  }).catch(e => { console.error('FAIL:', e); process.exit(1); });
"

# ============================================================
# Deep Core Import Shim Verification
# ============================================================
echo "=== Re-Export Shims ==="
head -3 packages/core/src/policy/index.ts
# Expected: re-export from @vybestack/llxprt-code-policy
head -3 packages/core/src/confirmation-bus/index.ts
# Expected: re-export from @vybestack/llxprt-code-policy
head -3 packages/core/src/tools/tool-confirmation-types.ts
# Expected: re-export from @vybestack/llxprt-code-policy

# ============================================================
# Core Kept Files
# ============================================================
echo "=== Core Kept Files ==="
ls packages/core/src/policy/policy-helpers.ts && echo "PASS: policy-helpers in core" || echo "FAIL"
ls packages/core/src/policy/config.ts && echo "PASS: config in core" || echo "FAIL"
rg "createPolicyEngineConfig|createPolicyUpdater|persistPolicyToToml" packages/core/src/policy/config.ts && echo "PASS: orchestration in core" || echo "FAIL"

# ============================================================
# Production Code Quality
# ============================================================
echo "=== Production Code Quality ==="
rg "TODO|FIXME|HACK|STUB" packages/policy/src --type ts -g '!*.test.ts' && echo "FAIL: markers found" || echo "PASS: no markers"

# ============================================================
# @plan / @requirement Marker Audit
# ============================================================
echo "=== Marker Audit ==="
echo "Policy @plan markers:"
rg "@plan.*PLAN-20260609-ISSUE1591" packages/policy/src --type ts --count
echo "Core @plan markers:"
rg "@plan.*PLAN-20260609-ISSUE1591" packages/core/src --type ts --count
echo "CLI @plan markers:"
rg "@plan.*PLAN-20260609-ISSUE1591" packages/cli/src --type ts --count
echo "Policy @requirement markers:"
rg "@requirement:REQ-" packages/policy/src --type ts --count
echo "Core @requirement markers:"
rg "@requirement:REQ-" packages/core/src --type ts --count
echo "CLI @requirement markers:"
rg "@requirement:REQ-" packages/cli/src --type ts --count

# ============================================================
# Final Verification Gate (All 6 Commands — Mandatory)
# ============================================================
echo "=== Final Verification Gate ==="
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

## Success Criteria

### Explicit Final Acceptance Criteria

The extraction is complete ONLY when ALL of the following are verifiably true:

**Package Boundary & Location:**
- [ ] Relevant policy code lives in `packages/policy` (PolicyEngine, MessageBus, types, TOML loading, confirmation bus)
- [ ] Core keeps ONLY justified orchestration/re-export shims:
  - `packages/core/src/policy/policy-helpers.ts` (hard tool/scheduler deps)
  - `packages/core/src/policy/config.ts` (createPolicyEngineConfig, createPolicyUpdater, persistPolicyToToml)
  - `packages/core/src/policy/index.ts` (re-export shim)
  - `packages/core/src/confirmation-bus/index.ts` (re-export shim)
  - `packages/core/src/tools/tool-confirmation-types.ts` (re-export shim)
- [ ] `PolicyEngine` is the public entry point exported from `@vybestack/llxprt-code-policy`

**TOML Policy Loading (Behavioral):**
- [ ] File-loaded TOML policies work from source (`packages/policy/src/policies/`)
- [ ] File-loaded TOML policies work from dist (`packages/policy/dist/`)
- [ ] `loadDefaultPolicies()` from source and from dist return the same rule count and priority values

**Import Migration & Backward Compatibility:**
- [ ] Existing imports are either migrated to `@vybestack/llxprt-code-policy` or backward-compatible through core re-exports
- [ ] All `@vybestack/llxprt-code-core` deep imports continue to resolve (via re-export shims)
- [ ] `ToolConfirmationOutcome` is a runtime alias for `ConfirmationOutcome` (identity-equal)

**Forbidden Dependencies (Source + Manifest):**
- [ ] Policy has ZERO dependency on core, providers, tools, CLI, @google/genai, telemetry in source
- [ ] Policy `package.json` has ZERO forbidden deps in both `dependencies` AND `devDependencies`
- [ ] No circular dependencies (verified via package manifests AND source scans)

**Code Quality & Markers:**
- [ ] No TODO/FIXME/HACK/STUB in policy production code
- [ ] Public API surface matches specification exactly
- [ ] @plan markers present across all three packages
- [ ] @requirement markers present mapping to REQ-001 through REQ-008

**Verification Gate:**
- [ ] REQ-001 through REQ-008: ALL acceptance criteria met
- [ ] Type exports verified via typecheck (not runtime node -e)
- [ ] All 6 verification commands pass (test, lint, typecheck, format, build, smoke test)
- [ ] execution-tracker.md updated with all phases complete

## Failure Recovery

If any criterion fails:
1. Identify the specific failure
2. Determine which phase introduced the issue
3. Fix only the specific issue
4. Re-run the full verification gate (all 6 commands)
5. Re-run this review phase
