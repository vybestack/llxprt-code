# Phase 17a: Settings & Factory — Implementation Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P17a`

## Purpose

Verify the factory implementation from P17 is complete, all P16 tests pass, settings/factory/accessors are fully wired, and no deferred work remains in the settings & factory layer.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers updated to P17
grep -c "@plan.*HIGHDENSITY.P17" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: ≥ 1

# 3. Pseudocode references for factory
grep -c "@pseudocode.*settings-factory" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: ≥ 1

# 4. ZERO NotYetImplemented for high-density in factory
grep "NotYetImplemented.*high-density" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches

# 5. HighDensityStrategy imported
grep "import.*HighDensityStrategy" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: 1 match

# 6. No deferred work in factory
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches related to high-density

# 7. No cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches
```

## Behavioral Verification

### All Tests Pass

```bash
# P16 settings/factory tests — primary verification
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: All pass, 0 failures

# P13 compress tests — regression check
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: All pass, 0 failures

# P10 optimize tests — regression check
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass, 0 failures
```

### Full Suite Regression

```bash
# Full test suite
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# Lint
npm run lint
# Expected: 0 errors

# Typecheck
npm run typecheck
# Expected: 0 errors
```

### Factory Verification

The verifier MUST read the factory file and confirm:

- [ ] `case 'high-density':` (or equivalent) returns `new HighDensityStrategy()`
- [ ] `import { HighDensityStrategy } from './HighDensityStrategy.js'` present at top
- [ ] Existing strategy cases unchanged (middle-out, top-down-truncation, one-shot)
- [ ] Default/exhaustive check still in place

### Settings Registry Verification (confirm P15 additions intact)

- [ ] `'compression.density.readWritePruning'` — boolean, default true
- [ ] `'compression.density.fileDedupe'` — boolean, default true
- [ ] `'compression.density.recencyPruning'` — boolean, default false
- [ ] `'compression.density.recencyRetention'` — number, default 3
- [ ] All 4 specs inside SETTINGS_REGISTRY array, after `compression.profile`

### COMPRESSION_STRATEGIES Verification (confirm P15 addition intact)

- [ ] `'high-density'` is in the tuple
- [ ] `'middle-out'`, `'top-down-truncation'`, `'one-shot'` still present
- [ ] `compression.strategy` setting's enumValues derived via `[...COMPRESSION_STRATEGIES]`

### Runtime Accessor Verification (confirm P15 additions intact)

- [ ] Interface has 4 density accessor declarations
- [ ] Wiring reads from settings service with correct key and fallback
- [ ] Default values match settings spec defaults exactly:
  - readWritePruning: `true`
  - fileDedupe: `true`
  - recencyPruning: `false`
  - recencyRetention: `3`

### Import Verification

- [ ] No circular imports introduced by HighDensityStrategy import in factory
- [ ] settingsRegistry.ts does NOT import any strategy classes
- [ ] All existing imports preserved

## Semantic Verification Checklist

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-004.1: 'high-density' in COMPRESSION_STRATEGIES — verified
   - [ ] REQ-HD-004.2: Factory returns HighDensityStrategy — verified by reading code
   - [ ] REQ-HD-004.3: Properties correct — verified on factory-created instance
   - [ ] REQ-HD-004.4: compression.strategy enumValues includes 'high-density' — verified
   - [ ] REQ-HD-009.1–009.4: 4 settings specs correct — verified
   - [ ] REQ-HD-009.5: 4 accessors wired — verified
   - [ ] REQ-HD-009.6: EphemeralSettings fields present — verified

2. **Is this REAL implementation, not placeholder?**
   - [ ] Factory returns `new HighDensityStrategy()`, not a stub
   - [ ] Settings specs are complete data objects
   - [ ] Accessors read real settings, not hardcoded values

3. **Would the test FAIL if implementation was broken?**
   - [ ] Removing factory case → tests fail (unknown strategy)
   - [ ] Wrong import → wrong class → property tests fail
   - [ ] Missing setting spec → registry search tests fail
   - [ ] Wrong accessor default → default tests fail

4. **Is the feature REACHABLE?**
   - [ ] `/set compression.strategy high-density` — accepted
   - [ ] Factory resolves to HighDensityStrategy — confirmed
   - [ ] `/set compression.density.readWritePruning false` — accepted
   - [ ] Accessors return configured values — confirmed

5. **End-to-End Path (manual check)**
   - [ ] User sets strategy → settings service stores value → accessor reads it → factory creates strategy → strategy has optimize + compress
   - [ ] User sets density setting → settings service stores value → accessor reads it → will flow to DensityConfig in orchestration (future phase)

## Success Criteria

- ALL P16 settings/factory tests pass
- ALL P10/P13 tests pass (no regression)
- Full test suite, lint, typecheck all pass
- Factory returns real HighDensityStrategy
- No NotYetImplemented remaining for high-density
- Settings, accessors, types all verified correct
- Pseudocode compliance verified for factory
- All semantic verification items checked

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P17 to fix
3. Re-run P17a
