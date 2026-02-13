# Phase 24a: Integration — Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P24a`

## Purpose

Verify the integration test stubs from P24 compile, cover the required integration points, and do not regress existing tests.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P24
grep -rn "@plan.*HIGHDENSITY.P24" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l
# Expected: ≥ 1

# 3. Requirement markers
grep -rn "@requirement.*REQ-HD-002\|@requirement.*REQ-HD-004\|@requirement.*REQ-HD-009" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l
# Expected: ≥ 1

# 4. No stale code in test file (outside of expected stub patterns)
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | grep -v "NotYetImplemented"
# Expected: No matches
```

## Behavioral Verification

### Integration Test Coverage

The verifier MUST read `packages/core/src/core/compression/__tests__/integration-high-density.test.ts` and confirm:

#### Factory Integration
- [ ] Test for `getCompressionStrategy('high-density')` returning HighDensityStrategy
- [ ] Test for returned instance having correct `name` property
- [ ] Test for returned instance having correct `requiresLLM` property
- [ ] Test for returned instance having correct `trigger` property
- [ ] Test for returned instance having `optimize` method

#### Settings Integration
- [ ] Test for `'high-density'` being a valid value for `compression.strategy`
- [ ] Test for `compression.density.readWritePruning` setting acceptance
- [ ] Test for `compression.density.fileDedupe` setting acceptance
- [ ] Test for `compression.density.recencyPruning` setting acceptance
- [ ] Test for `compression.density.recencyRetention` setting acceptance

#### Pipeline Integration
- [ ] Test for full pipeline sequence: optimize → shouldCompress → compress
- [ ] Test for density settings flowing to DensityConfig via ephemerals

#### Persistence Integration
- [ ] Test for density settings being persisted to profile
- [ ] Test for density config defaults matching settings registry defaults

### Regression Verification

```bash
# All existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass (P24 stubs may throw NotYetImplemented)

# Lint
npm run lint
# Expected: 0 errors

# Typecheck
npm run typecheck
# Expected: 0 errors
```

## Success Criteria

- Integration test file compiles
- Test coverage spans factory, settings, pipeline, persistence
- Plan and requirement markers present
- All pre-P24 tests pass

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P24 to fix
3. Re-run P24a
