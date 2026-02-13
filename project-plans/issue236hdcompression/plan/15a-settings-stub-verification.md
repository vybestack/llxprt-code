# Phase 15a: Settings & Factory — Stub Verification

## Phase ID

`PLAN-20260211-HIGHDENSITY.P15a`

## Purpose

Verify the settings specs, factory stub, COMPRESSION_STRATEGIES tuple update, runtime accessor interface/wiring, and EphemeralSettings type additions from P15 compile correctly and do not regress existing functionality.

## Structural Checks

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers include P15
grep -rn "@plan.*HIGHDENSITY.P15" packages/core/src/settings/ packages/core/src/core/compression/ | wc -l
# Expected: ≥ 2

# 3. Requirement markers for REQ-HD-009
grep -rn "@requirement.*REQ-HD-009" packages/core/src/settings/settingsRegistry.ts | wc -l
# Expected: ≥ 1

# 4. Requirement markers for REQ-HD-004
grep -rn "@requirement.*REQ-HD-004" packages/core/src/core/compression/ | wc -l
# Expected: ≥ 1

# 5. No forbidden patterns in new code
grep -rn -E "(TODO|FIXME|HACK|XXX)" packages/core/src/settings/settingsRegistry.ts | grep -i density | grep -v "NotYetImplemented"
# Expected: No matches
```

## Behavioral Verification

### Settings Registry Verification

The verifier MUST read `settingsRegistry.ts` and confirm:

- [ ] Setting `'compression.density.readWritePruning'` exists with type `'boolean'`, default `true`, category `'cli-behavior'`, persistToProfile `true`
- [ ] Setting `'compression.density.fileDedupe'` exists with type `'boolean'`, default `true`, category `'cli-behavior'`, persistToProfile `true`
- [ ] Setting `'compression.density.recencyPruning'` exists with type `'boolean'`, default `false`, category `'cli-behavior'`, persistToProfile `true`
- [ ] Setting `'compression.density.recencyRetention'` exists with type `'number'`, default `3`, category `'cli-behavior'`, persistToProfile `true`
- [ ] All 4 settings are placed INSIDE the SETTINGS_REGISTRY array (before closing `];`)
- [ ] All 4 settings are placed after the existing `compression.profile` entry

### COMPRESSION_STRATEGIES Tuple Verification

- [ ] `'high-density'` is a member of the COMPRESSION_STRATEGIES tuple
- [ ] Existing members (`'middle-out'`, `'top-down-truncation'`, `'one-shot'`) are unchanged
- [ ] The `compression.strategy` setting's `enumValues: [...COMPRESSION_STRATEGIES]` automatically includes `'high-density'`

### Factory Stub Verification

- [ ] Factory has a `case 'high-density':` (or equivalent conditional)
- [ ] The case throws `Error('NotYetImplemented: high-density factory')` or similar
- [ ] Existing strategy cases are unchanged
- [ ] No import of HighDensityStrategy yet (import will be added in P17)

### Runtime Accessor Interface Verification

- [ ] `densityReadWritePruning(): boolean` declared in ephemerals interface
- [ ] `densityFileDedupe(): boolean` declared in ephemerals interface
- [ ] `densityRecencyPruning(): boolean` declared in ephemerals interface
- [ ] `densityRecencyRetention(): number` declared in ephemerals interface

### EphemeralSettings Type Verification

- [ ] `'compression.density.readWritePruning'?: boolean` in EphemeralSettings
- [ ] `'compression.density.fileDedupe'?: boolean` in EphemeralSettings
- [ ] `'compression.density.recencyPruning'?: boolean` in EphemeralSettings
- [ ] `'compression.density.recencyRetention'?: number` in EphemeralSettings

### Runtime Accessor Wiring Verification

- [ ] `densityReadWritePruning` accessor reads from settings service, falls back to `true`
- [ ] `densityFileDedupe` accessor reads from settings service, falls back to `true`
- [ ] `densityRecencyPruning` accessor reads from settings service, falls back to `false`
- [ ] `densityRecencyRetention` accessor reads from settings service, falls back to `3`
- [ ] Default values in wiring MATCH default values in settings specs

### Regression Verification

```bash
# Existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# Optimize tests unaffected
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass

# Compress tests unaffected
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: All pass

# Lint passes
npm run lint
# Expected: 0 errors

# Typecheck passes
npm run typecheck
# Expected: 0 errors
```

### Import Verification

- [ ] No circular imports introduced
- [ ] settingsRegistry.ts does NOT import strategy classes
- [ ] Factory does NOT yet import HighDensityStrategy (only in P17)
- [ ] Existing imports preserved in all modified files

## Success Criteria

- TypeScript compilation passes
- All 4 settings specs present with correct properties
- `'high-density'` in COMPRESSION_STRATEGIES
- Factory stub throws NotYetImplemented
- Runtime accessor interface has 4 new declarations
- EphemeralSettings has 4 new optional fields
- Accessor wiring defaults match settings spec defaults
- ALL existing tests pass (no regression)
- Plan and requirement markers present

## Failure Recovery

If verification fails:
1. Document which checks failed
2. Return to P15 to fix
3. Re-run P15a
