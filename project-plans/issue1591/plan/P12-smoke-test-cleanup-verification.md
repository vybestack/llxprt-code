# Phase P12-V: Smoke Test & Cleanup Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P12 (smoke test & cleanup)


## Purpose

Final independent verification that the end-to-end workflow works correctly with the new package structure, all cleanup is complete, and the execution tracker is fully updated.

## Worker / Verifier Assignment

- **Worker**: deepthinker (confirms end-to-end correctness)
- **Verifier**: deepthinker (self-review with documented assessment)

## Expanded Requirements

- Verify smoke test completed successfully in P12
- Verify all stale files cleaned up
- Verify execution-tracker.md is fully updated with all 32 phases complete
- Final dependency boundary verification
- Final acceptance criteria review against explicit criteria from P11a

## Exact File Tasks

None (verification only — all code changes complete).

## Verification Commands

```bash
# 1. Verify execution tracker has all 32 phases
echo "=== Execution Tracker Completeness ==="
rg "^\\|.*\\|.*\\|" project-plans/issue1591/execution-tracker.md | wc -l
# Expected: 32+ phase rows (P00 through P12-V)

# 2. Verify execution tracker has all P10 sub-phases
echo "=== P10 Sub-Phase Completeness ==="
rg "P10b\\|P10c\\|P10d" project-plans/issue1591/execution-tracker.md
# Expected: P10b, P10b-V, P10c, P10c-V, P10d, P10d-V all present

# 3. Verify P12-V is present
echo "=== P12-V Present ==="
rg "P12-V" project-plans/issue1591/execution-tracker.md
# Expected: present

# 4. Final forbidden dependency check — source (all packages)
echo "=== Final Source Boundary ==="
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry|from.*@vybestack/llxprt-code-providers|from.*@vybestack/llxprt-code-cli|from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts -g '!*.test.ts' && echo "FAIL: forbidden imports" || echo "PASS: clean boundary"

# 5. Final forbidden dependency check — manifest (prod AND dev)
echo "=== Final Manifest Boundary ==="
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@google/genai', '@vybestack/llxprt-code-telemetry'];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('FAIL: forbidden deps in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: policy package.json clean (checked prod + dev)');
"

# 6. Verify no stale core files (re-export shims or deleted, not original code)
echo "=== Stale File Check ==="
for f in types.ts policy-engine.ts stable-stringify.ts utils.ts toml-loader.ts; do
  if [ -f "packages/core/src/policy/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/policy/$f"; then
      echo "PASS: packages/core/src/policy/$f is a re-export shim"
    else
      echo "FAIL: packages/core/src/policy/$f still contains original code"
    fi
  else
    echo "PASS: packages/core/src/policy/$f deleted (no remaining callers)"
  fi
done
for f in types.ts message-bus.ts; do
  if [ -f "packages/core/src/confirmation-bus/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/confirmation-bus/$f"; then
      echo "PASS: packages/core/src/confirmation-bus/$f is a re-export shim"
    else
      echo "FAIL: packages/core/src/confirmation-bus/$f still contains original code"
    fi
  else
    echo "PASS: packages/core/src/confirmation-bus/$f deleted (no remaining callers)"
  fi
done
echo "Stale file check complete"

# 7. Verify P11a acceptance criteria are met
echo "=== Explicit Acceptance Criteria ==="
echo "Policy package exists:"
ls packages/policy/package.json && echo "  PASS" || echo "  FAIL"
echo "PolicyEngine is public entry point:"
rg "PolicyEngine" packages/policy/src/index.ts && echo "  PASS" || echo "  FAIL"
echo "Core keeps policy-helpers.ts:"
ls packages/core/src/policy/policy-helpers.ts && echo "  PASS" || echo "  FAIL"
echo "Core keeps config.ts:"
ls packages/core/src/policy/config.ts && echo "  PASS" || echo "  FAIL"
echo "Re-export shim policy/index.ts:"
rg "@vybestack/llxprt-code-policy" packages/core/src/policy/index.ts && echo "  PASS" || echo "  FAIL"
echo "Re-export shim confirmation-bus/index.ts:"
rg "@vybestack/llxprt-code-policy" packages/core/src/confirmation-bus/index.ts && echo "  PASS" || echo "  FAIL"
echo "Re-export shim tool-confirmation-types.ts:"
rg "@vybestack/llxprt-code-policy" packages/core/src/tools/tool-confirmation-types.ts && echo "  PASS" || echo "  FAIL"

# 8. Final full verification gate (exactly the 6 required commands)
echo "=== Final Verification Gate (All 6 Commands) ==="
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"
```

## Success Criteria

- [ ] Execution tracker has all 32 phases listed (P00 through P12-V)
- [ ] P10b, P10b-V, P10c, P10c-V, P10d, P10d-V all present in execution tracker
- [ ] P12-V present in execution tracker
- [ ] Policy source boundary clean (zero forbidden imports)
- [ ] Policy manifest boundary clean (zero forbidden deps in prod AND dev)
- [ ] No stale core files (originals replaced with re-export shims or deleted if no callers)
- [ ] All explicit acceptance criteria from P11a verifiably met
- [ ] Full verification gate passes (all 6 commands: test, lint, typecheck, format, build, smoke test)

## Failure Recovery

If any criterion fails:
1. Identify the specific failure
2. Determine if code fix needed or plan update needed
3. Fix the specific issue
4. Re-run this verification phase
