# Phase 27a: Migration — Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P27a`

## Purpose

Verify migration compatibility: default strategy unchanged, existing profiles load cleanly, density defaults are sensible, and no breaking changes exist.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P27
grep -rn "@plan.*HIGHDENSITY.P27" packages/core/src/core/compression/__tests__/migration-compatibility.test.ts | wc -l
# Expected: ≥ 1

# 3. No stale markers or deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/core/compression/__tests__/migration-compatibility.test.ts
# Expected: No matches
```

## Behavioral Verification

### Migration Tests Pass

```bash
npm run test -- --run packages/core/src/core/compression/__tests__/migration-compatibility.test.ts
# Expected: All pass, 0 failures
```

### Backward Compatibility Verification

The verifier MUST confirm:

#### Default Strategy
- [ ] `compression.strategy` default value in SETTINGS_REGISTRY is `'middle-out'`
- [ ] Test verifies this programmatically

#### Existing Strategy Behavior
- [ ] MiddleOutStrategy with empty/undefined activeTodos → identical output to pre-HD
- [ ] OneShotStrategy with empty/undefined activeTodos → identical output to pre-HD
- [ ] TopDownTruncationStrategy → no optimize method, no activeTodos reference
- [ ] All existing strategies declare `trigger: { mode: 'threshold', defaultThreshold: 0.85 }`

#### Density Defaults
- [ ] `compression.density.readWritePruning` default: `true`
- [ ] `compression.density.fileDedupe` default: `true`
- [ ] `compression.density.recencyPruning` default: `false`
- [ ] `compression.density.recencyRetention` default: `3`

#### Profile Loading
- [ ] Profile without density settings loads cleanly (new settings get defaults)
- [ ] Profile with existing compression settings loads cleanly
- [ ] No error thrown for missing density settings in old profiles

### Prompt Backward Compatibility

- [ ] Existing 5 sections in `getCompressionPrompt()` unchanged in content
- [ ] 4 new sections are additive (appended after existing)
- [ ] compression.md existing sections unchanged

### Full Regression

```bash
npm run test -- --run 2>&1 | tail -10
npm run lint
npm run typecheck
npm run format
npm run build
node scripts/start.js --profile-load syntheticglm47 "write me a haiku"
# Expected: All pass
```

## Success Criteria

- Migration tests pass
- Default strategy is `middle-out`
- All existing strategies behave identically to pre-HD
- Density defaults are correct
- Profile backward compatibility verified
- Full verification cycle passes

## Failure Recovery

If verification fails:
1. Document which migration issue was found
2. Return to P27 (or relevant earlier phase) to fix
3. Re-run P27a
