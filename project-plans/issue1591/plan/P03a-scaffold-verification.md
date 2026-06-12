# Phase P03a: Scaffold Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P03 (package scaffold created)

## Purpose

Independently verify the package scaffold meets all requirements before any source code is added.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (verifies scaffold)
- **Verifier**: deepthinker (confirms completeness)

## Expanded Requirements

- Verify package is correctly registered in workspace
- Verify dependency boundary is enforced (no forbidden deps in package.json)
- Verify TypeScript compilation succeeds
- Verify test runner works (with `passWithNoTests: true` in vitest config)
- Verify full workspace still builds and tests pass
- Verify directory structure matches specification
- Verify no circular dependencies introduced by new package
- Verify `packages/policy/package.json` does not depend on `@vybestack/llxprt-code-core`, `@vybestack/llxprt-code-providers`, `@vybestack/llxprt-code-tools`, `@vybestack/llxprt-code-cli`

## Exact File Tasks

None (verification only).

## Verification Commands

```bash
# 1. Package registration
npm ls @vybestack/llxprt-code-policy
# Expected: package listed with version

# 2. Forbidden dependency scan in package.json
rg "@vybestack/llxprt-code-core|@google/genai|@vybestack/llxprt-code-telemetry|@vybestack/llxprt-code-providers|@vybestack/llxprt-code-cli|@vybestack/llxprt-code-tools" packages/policy/package.json
# Expected: zero matches (exit code 1 from rg)

# 3. Directory structure
find packages/policy -type f | sort
# Expected: package.json, tsconfig.json, vitest.config.ts, test-setup.ts, index.ts, src/index.ts

# 4. TypeScript compilation
npm run build --workspace @vybestack/llxprt-code-policy
# Expected: success, dist/ directory created

# 5. Test runner
npm run test --workspace @vybestack/llxprt-code-policy
# Expected: passes (no tests yet)

# 6. Full workspace integrity
npm run build
npm run test
npm run lint
npm run typecheck

# 7. Circular dependency check — verify new package does not create cycles
npm ls @vybestack/llxprt-code-policy --workspace @vybestack/llxprt-code-policy
# Expected: no errors (self-dependency would indicate circular config)
# Also verify no workspace dep points back to core
rg '"@vybestack/llxprt-code-core"' packages/policy/package.json
# Expected: zero matches

# 8. Package boundary — verify policy package.json has only allowed deps (prod AND dev)
node -e "
  const pkg = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = [
    '@vybestack/llxprt-code-core', '@vybestack/llxprt-code-core',
    '@vybestack/llxprt-code-providers', '@vybestack/llxprt-code-providers',
    '@vybestack/llxprt-code-tools', '@vybestack/llxprt-code-tools',
    '@vybestack/llxprt-code-cli', '@vybestack/llxprt-code-cli',
    '@google/genai',
    '@vybestack/llxprt-code-telemetry', '@vybestack/llxprt-code-telemetry'
  ];
  const prodDeps = Object.keys(pkg.dependencies || {});
  const devDeps = Object.keys(pkg.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) { console.error('FORBIDDEN deps found in prod or dev:', [...new Set(found)]); process.exit(1); }
  console.log('PASS: no forbidden dependencies in package.json (checked prod + dev)');
"
```

## Success Criteria

- [ ] Package correctly registered and discoverable via `npm ls`
- [ ] Zero forbidden dependencies in `packages/policy/package.json` (verified by source scan AND programmatic check)
- [ ] Directory structure matches specification exactly
- [ ] TypeScript builds without errors
- [ ] Tests pass (with no tests, via `passWithNoTests: true`)
- [ ] Full workspace build/test/lint/typecheck all pass
- [ ] No circular dependencies introduced

## Failure Recovery

1. If registration fails — check root package.json workspaces array
2. If forbidden deps found — remove them from package.json
3. If build fails — check tsconfig extends path and include/exclude patterns
4. If full workspace breaks — targeted revert of only packages/policy and root package.json
