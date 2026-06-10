# Phase P12: Smoke Test & Cleanup

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P11b (dist TOML loading verified)

## Purpose

Final smoke test and any remaining cleanup. Verify the end-to-end workflow works correctly with the new package structure.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (runs final smoke test and cleanup checks)
- **Verifier**: deepthinker (confirms end-to-end correctness)

## Expanded Requirements

- Run final smoke test to confirm end-to-end functionality
- Verify no stale files remain in core that should have been deleted
- Verify no stray test files were left behind
- Verify execution-tracker.md is fully updated
- Final dependency scan to confirm boundary enforcement

## Exact File Tasks

| File | Action | Description |
|------|--------|-------------|
| `project-plans/issue1591/execution-tracker.md` | UPDATE | Mark all phases as completed |

## Verification Commands

```bash
# 1. Final smoke test
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"

# 2. Final dependency boundary enforcement — use rg --glob
echo "=== Policy Package Boundary ==="
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry|from.*@vybestack/llxprt-code-providers|from.*@vybestack/llxprt-code-cli|from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts -g '!*.test.ts' && echo "FAIL: forbidden imports" || echo "PASS: clean boundary"

# 3. Final test count verification
npm run test --workspace @vybestack/llxprt-code-policy -- --reporter=verbose 2>&1 | rg "Tests" | tail -1
npm run test --workspace @vybestack/llxprt-code-core -- --reporter=verbose 2>&1 | rg "Tests" | tail -1

# 4. Verify no stale files (re-export shims OK, original code not OK)
echo "=== Stale File Check ==="
for f in types.ts policy-engine.ts stable-stringify.ts utils.ts toml-loader.ts; do
  if [ -f "packages/core/src/policy/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/policy/$f"; then
      echo "OK: $f is a re-export shim in core/src/policy/"
    else
      echo "WARN: $f still has original code in core/src/policy/ (should be shim)"
    fi
  fi
done
for f in types.ts message-bus.ts; do
  if [ -f "packages/core/src/confirmation-bus/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/confirmation-bus/$f"; then
      echo "OK: $f is a re-export shim in core/src/confirmation-bus/"
    else
      echo "WARN: $f still has original code in core/src/confirmation-bus/ (should be shim)"
    fi
  fi
done

# 5. Verify workspace structure
echo "=== Workspace Structure ==="
ls packages/policy/package.json
ls packages/policy/tsconfig.json
ls packages/policy/vitest.config.ts
ls packages/policy/src/index.ts
ls packages/policy/src/types.ts
ls packages/policy/src/policy-engine.ts
ls packages/policy/src/confirmation-bus/types.ts
ls packages/policy/src/confirmation-bus/message-bus.ts
ls packages/policy/src/policies/read-only.toml

# 6. Package manifest boundary — final check (prod AND dev)
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

# 7. Final full verification gate (exactly the 6 required commands)
npm run test
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load ollamakimi "write me a haiku and nothing else"

# 8. Final @plan marker audit
echo "=== Final Marker Count ==="
rg "@plan.*PLAN-20260609-ISSUE1591" packages/ --type ts -c | tail -5
rg "@requirement:REQ-" packages/ --type ts -c | tail -5
```

## Success Criteria

- [ ] Smoke test completes successfully
- [ ] Policy package boundary is clean (zero forbidden imports in source AND manifest)
- [ ] No stale source files in core (only re-export shims and kept files)
- [ ] Workspace structure complete and correct
- [ ] All tests pass in both policy and core packages
- [ ] Full suite (test, lint, typecheck, format, build) all pass
- [ ] execution-tracker.md updated with all phases completed
- [ ] @plan and @requirement markers present across all packages

## Failure Recovery

If smoke test fails:
1. Check error output carefully — it may be unrelated to policy extraction
2. Verify it's not a pre-existing issue by checking if the same command works on main
3. If policy-related — trace the error to the specific integration point
4. Fix and re-run from P11 (full verification gate)
