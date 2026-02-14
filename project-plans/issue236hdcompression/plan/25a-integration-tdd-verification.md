# Phase 25a: Integration — TDD Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P25a`

## Purpose

Verify the integration tests from P25 are fully implemented (no remaining stubs), cover all integration points, and pass or fail naturally.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P25
grep -rn "@plan.*HIGHDENSITY.P25" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l
# Expected: ≥ 1

# 3. No remaining stubs
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: 0

# 4. No deferred work
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: No matches
```

## Behavioral Verification

### Integration Test Coverage

The verifier MUST read `packages/core/src/core/compression/__tests__/integration-high-density.test.ts` and confirm:

#### Factory Resolution
- [ ] Test calls `getCompressionStrategy('high-density')` with the real factory
- [ ] Test verifies returned instance properties (name, requiresLLM, trigger, optimize, compress)
- [ ] Test does NOT mock the factory — it uses the real implementation

#### Settings System
- [ ] Test verifies `'high-density'` is in COMPRESSION_STRATEGIES tuple
- [ ] Test verifies all 4 density settings exist in SETTINGS_REGISTRY
- [ ] Test verifies settings have correct type, default, category
- [ ] Test does NOT mock the settings registry — uses real specs

#### Pipeline Integration
- [ ] Test sets up realistic scenario with strategy + history + tokens
- [ ] Test verifies optimize runs before compress
- [ ] Test verifies optimize-only scenario (prune enough to skip compress)
- [ ] Test verifies existing strategies skip optimize step

#### Ephemeral Flow
- [ ] Test verifies settings → ephemeral accessor → DensityConfig mapping
- [ ] Test verifies default values propagate correctly

### All Tests Run

```bash
# Integration tests
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts 2>&1 | tail -20
# Expected: Tests run (pass or fail naturally for items needing P26)

# All HD tests — regression check
npm run test -- --run packages/core/src/core/compression/__tests__/ 2>&1 | tail -20
# Expected: All pass

# Full suite
npm run test -- --run 2>&1 | tail -10
npm run lint
npm run typecheck
# Expected: All pass
```

### Test Quality

- [ ] Tests use behavioral assertions (checking outputs and effects), not structural assertions (checking internal calls)
- [ ] Tests are self-contained — each test sets up its own state
- [ ] Tests clean up after themselves (no global state leakage)
- [ ] Tests would fail if the integration was broken

## Success Criteria

- All integration tests implemented (no stubs)
- Tests cover factory, settings, pipeline, ephemeral flow
- Tests use real implementations, not mocks
- All previous tests pass
- TypeScript compiles and lints

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P25 to fix
3. Re-run P25a
