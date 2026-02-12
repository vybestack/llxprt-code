# Phase 17: Settings & Factory — Implementation

## Phase ID

`PLAN-20260211-HIGHDENSITY.P17`

## Prerequisites

- Required: Phase 16 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P16" packages/core/src/core/compression/__tests__/high-density-settings.test.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/high-density-settings.test.ts` (tests written, factory tests failing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.
**Behavior**:
- GIVEN: The COMPRESSION_STRATEGIES tuple
- WHEN: Inspected
- THEN: `'high-density'` is a member
**Why This Matters**: Drives union type and settings enum.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.
**Behavior**:
- GIVEN: `getCompressionStrategy('high-density')`
- WHEN: Called
- THEN: Returns a HighDensityStrategy instance with `name === 'high-density'`
**Why This Matters**: The orchestrator resolves strategies by name.

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.
**Why This Matters**: Drives continuous optimization behavior.

### REQ-HD-004.4: Settings Auto-Registration

**Full Text**: When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the `compression.strategy` setting's `enumValues` shall automatically include it.
**Why This Matters**: Already achieved by the tuple derivation pattern.

### REQ-HD-009.1–009.4: Settings Specs

**Full Text**: 4 density settings in SETTINGS_REGISTRY (readWritePruning, fileDedupe, recencyPruning, recencyRetention).
**Why This Matters**: Already added in P15 as declarative data.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: 4 density accessors on ephemerals interface.
**Why This Matters**: Already added in P15 as wiring.

### REQ-HD-009.6: Ephemeral Settings Types

**Full Text**: 4 optional fields in EphemeralSettings interface.
**Why This Matters**: Already added in P15.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/compressionStrategyFactory.ts`
  - REPLACE the `'high-density'` stub case (throwing NotYetImplemented) with real implementation
  - ADD import: `import { HighDensityStrategy } from './HighDensityStrategy.js';`
  - The case should return `new HighDensityStrategy()`
  - UPDATE plan marker: `@plan:PLAN-20260211-HIGHDENSITY.P17`
  - ADD requirement marker: `@requirement:REQ-HD-004.2`
  - ADD pseudocode reference: `@pseudocode settings-factory.md lines 140-157`

### Implementation Mapping (Pseudocode → Code)

#### Factory case — pseudocode settings-factory.md lines 140–157

```
Lines 143-155: getCompressionStrategy switch statement
  Line 151: case 'high-density': return new HighDensityStrategy()
Lines 156-157: Import statement at top of file
```

#### Settings specs — pseudocode settings-factory.md lines 14–51

Already implemented in P15 (settings are declarative data, not code logic).

#### Runtime accessors — pseudocode settings-factory.md lines 90–121

Already implemented in P15 (simple read-through wiring).

#### Threshold precedence — pseudocode settings-factory.md lines 160–186

No code change needed. The existing `compressionThreshold` accessor already handles
ephemeral → profile → default precedence correctly, and all strategies use 0.85.

### What This Phase Actually Does

The bulk of settings/factory work was done in P15 (stub phase) because:
- Settings specs are declarative data, not implementation logic
- Runtime accessors are simple read-through wiring
- EphemeralSettings types are type declarations

The only remaining "implementation" is replacing the factory stub:
1. Add the `HighDensityStrategy` import to the factory file
2. Replace the NotYetImplemented throw with `return new HighDensityStrategy()`

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P17
 * @requirement REQ-HD-004.2
 * @pseudocode settings-factory.md lines 140-157
 */
case 'high-density':
  return new HighDensityStrategy();
```

### Anti-Patterns to Avoid (from pseudocode)

- **DO NOT** import HighDensityStrategy in settingsRegistry.ts — only in the factory
- **DO NOT** hardcode `'high-density'` in the settings enum — it's derived from the tuple
- **DO NOT** use different default values in accessor wiring vs settings specs
- **DO NOT** add validation to boolean settings that rejects non-boolean values — existing pattern uses `type: 'boolean'` only
- **DO NOT** add recencyRetention clamping to the settings validator — the Math.max(1, ...) clamp is in the strategy code

## Verification Commands

### Automated Checks

```bash
# 1. ALL P16 tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: All pass, 0 failures

# 2. ALL previous phase tests still pass (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
# Expected: All pass, 0 failures

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Full test suite passes
npm run test -- --run
# Expected: All pass

# 5. Plan markers updated to P17
grep -c "@plan.*HIGHDENSITY.P17" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: ≥ 1

# 6. Pseudocode references for factory
grep -c "@pseudocode.*settings-factory" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: ≥ 1

# 7. Factory no longer throws NotYetImplemented for high-density
grep "NotYetImplemented.*high-density" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches

# 8. HighDensityStrategy imported in factory
grep "import.*HighDensityStrategy" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: 1 match
```

### Structural Verification Checklist

- [ ] Previous phase markers present (P16)
- [ ] No skipped phases (P16 exists)
- [ ] All listed files created/modified
- [ ] Plan markers added to all changes
- [ ] Tests pass for this phase
- [ ] No "TODO" or "NotImplemented" in phase code

### Deferred Implementation Detection (MANDATORY)

```bash
# Check for NotYetImplemented in factory
grep -c "NotYetImplemented" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: 0 (for high-density; other strategies may have their own stubs)

# Check for TODO/FIXME/HACK in factory
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches related to high-density

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/compressionStrategyFactory.ts
# Expected: No matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/compressionStrategyFactory.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist (MANDATORY)

#### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] REQ-HD-004.1: `'high-density'` in COMPRESSION_STRATEGIES — verified
   - [ ] REQ-HD-004.2: `getCompressionStrategy('high-density')` returns HighDensityStrategy — verified by reading factory
   - [ ] REQ-HD-004.3: Properties correct (name, requiresLLM, trigger) — verified on instance
   - [ ] REQ-HD-004.4: `compression.strategy` enumValues includes `'high-density'` — verified by derivation

2. **Is this REAL implementation, not placeholder?**
   - [ ] Factory case returns `new HighDensityStrategy()`, not a stub or mock
   - [ ] HighDensityStrategy import is present
   - [ ] No NotYetImplemented for high-density in factory

3. **Would the test FAIL if implementation was removed?**
   - [ ] Removing factory case → factory throws unknown strategy → tests fail
   - [ ] Wrong import → wrong class returned → property tests fail
   - [ ] Missing tuple entry → TypeScript error and enum test fails

4. **Is the feature REACHABLE by users?**
   - [ ] `/set compression.strategy high-density` — will be accepted by settings service
   - [ ] Orchestrator calls `getCompressionStrategy(strategyName)` — factory returns correct instance
   - [ ] Strategy has both `optimize` and `compress` methods — fully functional

5. **What's MISSING?**
   - [ ] Orchestrator density integration — future phase (P18-P20)
   - [ ] All settings/factory work is complete after this phase

#### Feature Actually Works

```bash
# Run settings-specific tests
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1
# Expected: ALL tests pass with 0 failures
# Actual: [paste output]

# Run all HD tests (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1
# Expected: ALL pass
# Actual: [paste output]
```

#### Integration Points Verified

- [ ] Factory imports HighDensityStrategy from correct relative path
- [ ] Factory switch/conditional includes the `'high-density'` case before default/exhaustive check
- [ ] `CompressionStrategyName` union type includes `'high-density'` (derived from tuple)
- [ ] `parseCompressionStrategyName('high-density')` succeeds (validation function accepts)
- [ ] Settings service can `get('compression.density.readWritePruning')` — returns default `true`
- [ ] Runtime accessor `densityReadWritePruning()` correctly reads from settings service

#### Edge Cases Verified

- [ ] Factory still handles all existing strategies correctly (middle-out, top-down-truncation, one-shot)
- [ ] Factory rejects invalid strategy names
- [ ] Settings service handles unset density settings (returns `undefined`, accessor provides default)
- [ ] Multiple calls to factory return new instances each time (no singleton pollution)

## Success Criteria

- ALL P16 settings/factory tests pass
- ALL P10/P13 tests pass (no regression)
- TypeScript compiles cleanly
- Full test suite passes
- Factory returns real HighDensityStrategy for `'high-density'`
- No NotYetImplemented remaining for high-density in factory
- Settings, accessors, and types all wired correctly
- Pseudocode line references present

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/compressionStrategyFactory.ts`
2. P15 stub restored (factory throws)
3. Cannot proceed to Phase 18 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P17.md`
Contents:
```markdown
Phase: P17
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/compressionStrategyFactory.ts [+N lines, -M lines]
Tests Passing:
  - high-density-settings.test.ts: [count]
  - high-density-optimize.test.ts: [count]
  - high-density-compress.test.ts: [count]
Verification: [paste verification output]

## Implementation Trace
- Factory case: pseudocode settings-factory.md lines 140-157 → [actual line range]
- Import: pseudocode settings-factory.md lines 156-157 → [actual line]

## Settings & Factory Status
- 4 settings specs: COMPLETE (P15)
- COMPRESSION_STRATEGIES tuple: COMPLETE (P15)
- Runtime accessors: COMPLETE (P15)
- EphemeralSettings types: COMPLETE (P15)
- Factory registration: COMPLETE (P17)
- All NotYetImplemented stubs: REPLACED
- Remaining work: orchestration integration (P18-P20)
```
