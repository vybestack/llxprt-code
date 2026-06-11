# Phase P11b: Package Build/Dist TOML Loading Verification

Plan ID: PLAN-20260609-ISSUE1591
Phase Type: Verification
Prerequisites: P11a (final review passed)

## Purpose

**Explicit package build/dist verification with concrete commands.** Prove that `packages/policy/dist` is built correctly and `loadDefaultPolicies()` loads bundled TOML files from the dist output with correct rule counts and priority values. This phase runs between the final review (P11a) and cleanup (P12) to ensure the built package is correct before any cleanup occurs.

## Worker / Verifier Assignment

- **Worker**: typescriptreviewer (runs build verification)
- **Verifier**: deepthinker (confirms dist output correctness)

## Expanded Requirements

- Build `packages/policy/dist` from scratch using the repository's build command
- Verify dist output contains the expected file structure
- Verify `loadDefaultPolicies()` loads from dist and returns correct rule count
- Verify source and dist TOML loading produce identical results
- Verify TOML files are bundled correctly in dist output
- Document exact rule counts and priority values from both source and dist

## Exact File Tasks

None (verification only).

## Verification Commands

### 1. Clean Build from Scratch

```bash
# Clean previous dist output and rebuild
rm -rf packages/policy/dist
npm run build --workspace @vybestack/llxprt-code-policy
# Expected: success, dist/ created
```

### 2. Verify Dist File Structure

```bash
# Verify dist output contains expected files
find packages/policy/dist -type f | sort
# Expected: index.js, index.d.ts, src/*.js, src/*.d.ts, src/policies/*.toml (or src/policies/ bundled)
```

### 3. TOML Loading from Dist — Rule Count

```bash
npm run build --workspace @vybestack/llxprt-code-policy
node -e "
  import('./packages/policy/dist/index.js').then(async m => {
    const rules = await m.loadDefaultPolicies();
    console.log('=== Dist TOML Loading Results ===');
    console.log('Rule count:', rules.length);
    console.log('Rules:');
    for (const r of rules) {
      console.log('  -', r.name, '| decision:', r.decision, '| priority:', r.priority);
    }
    if (rules.length === 0) {
      console.error('FAIL: loadDefaultPolicies() returned 0 rules from dist');
      process.exit(1);
    }
    for (const r of rules) {
      if (!r.name) { console.error('FAIL: rule missing name:', r); process.exit(1); }
      if (r.priority === undefined) { console.error('FAIL: rule missing priority:', r); process.exit(1); }
    }
    console.log('PASS:', rules.length, 'rules loaded from dist with valid name and priority');
  }).catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
# Expected: non-zero rule count matching the number of bundled TOML policy files
```

### 4. TOML Loading from Source — Rule Count (for Comparison)

```bash
# Run the source-based TOML loading test for comparison
npm run test --workspace @vybestack/llxprt-code-policy -- --testNamePattern="loadDefaultPolicies"
# Expected: ALL pass (source-based loading works)

# Also verify source loading directly:
node -e "
  import('./packages/policy/src/toml-loader.js').then(async m => {
    const rules = await m.loadDefaultPolicies();
    console.log('=== Source TOML Loading Results ===');
    console.log('Rule count:', rules.length);
    for (const r of rules) {
      console.log('  -', r.name, '| decision:', r.decision, '| priority:', r.priority);
    }
    console.log('Source rules loaded:', rules.length);
  }).catch(e => { console.error('Source load error:', e.message); });
"
```

### 5. Source vs Dist Identity Check

```bash
# Verify source and dist produce IDENTICAL rule counts and priority values
node -e "
  async function compare() {
    const srcMod = await import('./packages/policy/src/toml-loader.js');
    const distMod = await import('./packages/policy/dist/index.js');
    const srcRules = await srcMod.loadDefaultPolicies();
    const distRules = await distMod.loadDefaultPolicies();

    console.log('Source rule count:', srcRules.length);
    console.log('Dist rule count:', distRules.length);

    if (srcRules.length !== distRules.length) {
      console.error('FAIL: rule count mismatch (source:', srcRules.length, ', dist:', distRules.length, ')');
      process.exit(1);
    }

    for (let i = 0; i < srcRules.length; i++) {
      if (srcRules[i].name !== distRules[i].name) {
        console.error('FAIL: rule name mismatch at index', i, ':', srcRules[i].name, '!=', distRules[i].name);
        process.exit(1);
      }
      if (srcRules[i].priority !== distRules[i].priority) {
        console.error('FAIL: priority mismatch for', srcRules[i].name, ':', srcRules[i].priority, '!=', distRules[i].priority);
        process.exit(1);
      }
    }
    console.log('PASS: source and dist produce identical', srcRules.length, 'rules with matching names and priorities');
  }
  compare().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
"
```

### 6. Verify TOML Files Bundled in Dist

```bash
# Check that TOML files are present in dist output
find packages/policy/dist -name '*.toml' -type f
# Expected: all TOML policy files present (read-only.toml, write.toml, discovered.toml, yolo.toml)

# If TOML files are NOT in dist, the path resolution in toml-loader.ts may be incorrect
# for the built output. This must be fixed before proceeding.
```

## Success Criteria

- [ ] `packages/policy/dist` builds successfully from scratch (clean build)
- [ ] Dist output contains expected file structure (JS, .d.ts, TOML files)
- [ ] `loadDefaultPolicies()` from dist returns non-zero rule count
- [ ] All rules from dist have valid `name` and `priority` fields
- [ ] Source and dist produce **identical** rule counts
- [ ] Source and dist produce **identical** priority values for each rule
- [ ] TOML policy files are bundled in dist output (not just in src/)
- [ ] Exact rule counts and priority values documented in phase output

## Failure Recovery

1. If dist build fails — check build script (`node ../../scripts/build_package.js`), tsconfig.json
2. If TOML files not in dist — check tsconfig.json `include`/`exclude` and `copy` settings; ensure TOML files are included in build output
3. If rule count mismatch — check path resolution in `toml-loader.ts` (source uses `import.meta.url`, dist uses different relative paths)
4. If priority values differ — check that tier calculation uses correct directory detection from dist paths
5. Do NOT proceed to P12 until dist TOML loading works correctly
