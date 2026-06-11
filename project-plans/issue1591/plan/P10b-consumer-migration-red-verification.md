# Phase P10b-V: Boundary Scan — Manifest & Source Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P10a-V (consumer verification passed)

## Purpose

**Explicit manifest and source boundary scans** verifying that `packages/policy` has zero imports/dependencies on forbidden packages: `packages/core`, `packages/providers`, `packages/tools`, `packages/cli`, `@google/genai`, and telemetry. This phase runs both package manifest scans (`package.json` dependencies) and source import scans (TypeScript `from` imports) to ensure no boundary violations exist before proceeding to source deletion.

## Worker / Verifier Assignment

- **Worker**: deepthinker (runs comprehensive boundary scans)
- **Verifier**: deepthinker (documents findings)

## Exact File Tasks

None (verification only).

## Verification Commands

### 1. Package Manifest Scan (prod AND dev dependencies)

```bash
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const forbidden = [
    '@vybestack/llxprt-code-core',
    '@vybestack/llxprt-code-providers',
    '@vybestack/llxprt-code-tools',
    '@vybestack/llxprt-code-cli',
    '@google/genai',
    '@vybestack/llxprt-code-telemetry'
  ];
  const prodDeps = Object.keys(policy.dependencies || {});
  const devDeps = Object.keys(policy.devDependencies || {});
  const allDeps = [...prodDeps, ...devDeps];
  const found = allDeps.filter(d => forbidden.includes(d));
  if (found.length > 0) {
    console.error('BOUNDARY VIOLATION in prod or dev:', [...new Set(found)]);
    process.exit(1);
  }
  console.log('PASS: no forbidden deps in policy package.json (checked prod + dev)');
  console.log('  Prod deps:', prodDeps.join(', '));
  console.log('  Dev deps:', devDeps.join(', '));
"
```

### 2. Source Import Scan — Production Code

```bash
# Scan for any forbidden imports in production TypeScript source
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry|from.*@vybestack/llxprt-code-providers|from.*@vybestack/llxprt-code-cli|from.*@vybestack/llxprt-code-tools" packages/policy/src --type ts -g '!*.test.ts'
# Expected: zero matches (exit code 1 from rg = no matches = PASS)
```

### 3. Source Import Scan — Test Code

```bash
# Tests also must not import from forbidden packages
rg "from.*@vybestack/llxprt-code-core|from.*@google/genai|from.*@vybestack/llxprt-code-telemetry" packages/policy/src -g '*.test.ts'
# Expected: zero matches
```

### 4. Deep Path Scan — Relative Imports to Core/Providers/Tools

```bash
# Check for any relative imports that escape the policy package
rg "from.*\.\./.*core|from.*\.\./.*providers|from.*\.\./.*tools|from.*\.\./.*cli" packages/policy/src --type ts
# Expected: zero matches

# Check for any absolute path imports into other packages
rg "from.*packages/core|from.*packages/providers|from.*packages/tools|from.*packages/cli" packages/policy/src --type ts
# Expected: zero matches
```

### 5. Circular Dependency Scan

```bash
# Verify policy does not create circular deps by importing core (which imports policy)
node -e "
  const policy = JSON.parse(require('fs').readFileSync('packages/policy/package.json', 'utf8'));
  const core = JSON.parse(require('fs').readFileSync('packages/core/package.json', 'utf8'));
  const policyAllDeps = [...Object.keys(policy.dependencies || {}), ...Object.keys(policy.devDependencies || {})];
  const coreAllDeps = [...Object.keys(core.dependencies || {}), ...Object.keys(core.devDependencies || {})];
  if (policyAllDeps.includes('@vybestack/llxprt-code-core')) {
    console.error('CIRCULAR: policy depends on core, and core depends on policy');
    process.exit(1);
  }
  if (!coreAllDeps.includes('@vybestack/llxprt-code-policy')) {
    console.error('MISSING: core does not depend on policy');
    process.exit(1);
  }
  console.log('PASS: dependency graph correct (core → policy, not policy → core)');
"
```

### 6. @google/genai Specific Scan

```bash
# Comprehensive check — no @google/genai anywhere in policy package
rg "@google/genai" packages/policy/ --type ts
# Expected: zero matches (not in prod, dev, test, or any file)
```

### 7. Telemetry Scan

```bash
# No telemetry imports in policy
rg "@vybestack/llxprt-code-telemetry" packages/policy/ --type ts
# Expected: zero matches
```

## Success Criteria

- [ ] Package manifest scan: zero forbidden deps in `dependencies` AND `devDependencies`
- [ ] Source import scan (production): zero forbidden imports
- [ ] Source import scan (tests): zero forbidden imports
- [ ] Deep path scan: no relative or absolute imports escaping policy package
- [ ] Circular dependency scan: no circular deps, core → policy direction confirmed
- [ ] @google/genai scan: zero references anywhere in policy package
- [ ] Telemetry scan: zero references anywhere in policy package
- [ ] All scan results documented (pass/fail for each)

## Failure Recovery

1. If manifest violation found — remove forbidden dep from package.json immediately
2. If source import violation found — replace with local type, injected interface, or copied utility
3. If circular dep found — break the cycle by moving the offending import to an injected interface
4. Do NOT proceed to P10d until all boundary scans pass
