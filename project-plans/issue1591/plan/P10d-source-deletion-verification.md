# Phase P10d-V: Source Deletion Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P10d (source deletion complete)

## Purpose

Verify all source deletions are correct, no broken imports, full test suite passes, package boundaries enforced.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies deletion correctness)
- **Verifier**: deepthinker (confirms no broken references)

## Verification Commands

```bash
# 1. Full workspace test suite
npm run test
# Expected: ALL pass

# 2. Full workspace build and typecheck
npm run build
npm run typecheck
npm run lint
npm run format

# 3. Verify old files are either re-export shims or deleted (no original code remains)
for f in types.ts policy-engine.ts stable-stringify.ts utils.ts toml-loader.ts; do
  if [ -f "packages/core/src/policy/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/policy/$f"; then
      echo "PASS: $f is a re-export shim"
    else
      echo "FAIL: $f still contains original code (should be shim or deleted)"
    fi
  else
    echo "PASS: $f deleted (no remaining callers)"
  fi
done
for f in types.ts message-bus.ts; do
  if [ -f "packages/core/src/confirmation-bus/$f" ]; then
    if grep -q "@vybestack/llxprt-code-policy" "packages/core/src/confirmation-bus/$f"; then
      echo "PASS: $f is a re-export shim"
    else
      echo "FAIL: $f still contains original code (should be shim or deleted)"
    fi
  else
    echo "PASS: $f deleted (no remaining callers)"
  fi
done

# 4. Verify no stale references to deleted files — comprehensive scan
# Scan ALL old policy/confirmation-bus implementation imports (not just selected patterns)
echo "=== Checking for stale policy source imports ==="
find packages/core/src -name '*.ts' ! -path '*/node_modules/*' -exec rg -l "from.*\./types'|from.*\./policy-engine'|from.*\./stable-stringify'|from.*\./toml-loader'|from.*\./utils'|from.*\./message-bus'|from.*\./config'" {} \; 2>/dev/null | rg -v 'index\.ts|config\.ts|policy-helpers\.ts'
# Expected: zero direct imports to deleted files (only shims/kept files reference them)

# Also scan for any relative imports into policy/ or confirmation-bus/ subdirectories
echo "=== Checking for stale relative imports into policy/ ==="
rg "from.*['\"]\.\.?/policy/(types|policy-engine|stable-stringify|utils|toml-loader|config)" packages/core/src --type ts -g '!*.test.ts' | rg -v 'policy/index\.ts|policy/config\.ts|policy/policy-helpers\.ts'
# Expected: zero matches

echo "=== Checking for stale relative imports into confirmation-bus/ ==="
rg "from.*['\"]\.\.?/confirmation-bus/(types|message-bus)" packages/core/src --type ts -g '!*.test.ts' | rg -v 'confirmation-bus/index\.ts'
# Expected: zero matches

# 5. Package boundary enforcement (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = ['@vybestack/llxprt-code-core', '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-cli', '@google/genai', '@vybestack/llxprt-code-telemetry'];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('BOUNDARY VIOLATION in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: policy boundary enforced (checked prod + dev)');
"

# 6. Circular dependency check (prod AND dev)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  if (allDeps.includes('@vybestack/llxprt-code-core')) { console.error('CIRCULAR'); process.exit(1); }
  console.log('PASS: no circular deps (checked prod + dev)');
"
```

## Success Criteria

- [ ] Full workspace test suite passes
- [ ] Full workspace build, typecheck, lint, format all pass
- [ ] All moved source files replaced with thin re-export shims or deleted (no original code remains)
- [ ] Re-export shims forward to `@vybestack/llxprt-code-policy`
- [ ] Zero stale references to deleted/shimmed files
- [ ] Package boundary enforced (policy package.json clean)
- [ ] No circular dependencies

## Failure Recovery

1. If stale references found — update imports to use `@vybestack/llxprt-code-policy`
2. If missing shim — check that re-export barrel still exists
3. Targeted fix only — do not re-run previous phases
