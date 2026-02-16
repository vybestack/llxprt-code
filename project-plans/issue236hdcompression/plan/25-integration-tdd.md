# Phase 25: Integration — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P25`

## Prerequisites

- Required: Phase 24 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P24" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/__tests__/integration-high-density.test.ts` (stub test file)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

This phase implements full integration tests that verify the high-density compression feature works IN CONTEXT with the existing system — not just in isolation.

### Cross-Cutting Integration: Strategy Resolution Chain

**Behavior**:
- GIVEN: User runs `/set compression.strategy high-density`
- WHEN: Next message triggers compression check
- THEN: The settings service stores `'high-density'` → ephemeral accessor returns it → `parseCompressionStrategyName()` validates → `getCompressionStrategy()` returns `HighDensityStrategy` → `ensureDensityOptimized()` calls `optimize()`
**Why This Matters**: Each link in this chain was built in separate phases. Integration tests verify they work together.

### Cross-Cutting Integration: Density + Compression Pipeline

**Behavior**:
- GIVEN: Strategy is `high-density`, history has prunable content, and tokens are over threshold
- WHEN: `ensureCompressionBeforeSend()` runs
- THEN: `optimize()` prunes first → token count drops → if still over threshold, `compress()` runs → token count drops further
**Why This Matters**: Density optimization and compression are separate phases that must cooperate.

### Cross-Cutting Integration: Settings Persistence

**Behavior**:
- GIVEN: User sets `compression.density.readWritePruning` to `false` and saves profile
- WHEN: Profile is reloaded in new session
- THEN: `densityReadWritePruning()` returns `false`
**Why This Matters**: Settings must survive session boundaries.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/__tests__/integration-high-density.test.ts`
  - REPLACE stub test bodies with full integration test implementations
  - UPDATE marker: `@plan:PLAN-20260211-HIGHDENSITY.P25`
  - RETAIN P24 requirement markers

### Tests to Implement

#### Factory Resolution Tests
```typescript
// Test: factory returns correct instance
// Call getCompressionStrategy('high-density') and verify:
//   - result instanceof HighDensityStrategy
//   - result.name === 'high-density'
//   - result.requiresLLM === false
//   - result.trigger.mode === 'continuous'
//   - result.trigger.defaultThreshold === 0.85
//   - typeof result.optimize === 'function'
//   - typeof result.compress === 'function'
```

#### Settings System Tests
```typescript
// Test: strategy enum includes high-density
// Read COMPRESSION_STRATEGIES and verify 'high-density' is a member
// Read the compression.strategy setting spec and verify enumValues includes 'high-density'

// Test: density settings accepted by registry
// For each of the 4 density settings:
//   - Find spec in SETTINGS_REGISTRY
//   - Verify type, default, category, persistToProfile

// Test: density config defaults match settings defaults
// Build DensityConfig from default settings values
// Verify: readWritePruning=true, fileDedupe=true, recencyPruning=false, recencyRetention=3
```

#### Pipeline Integration Tests
```typescript
// Test: optimize runs before compress in full pipeline
// Set up a scenario with:
//   - Strategy: high-density
//   - History with prunable content (stale reads)
//   - Token count above threshold
// Verify that optimize() runs first and prunes stale content,
// then if still over threshold, compress() runs

// Test: optimize reduces token count sufficiently to skip compress
// Set up scenario where pruning removes enough tokens
// Verify compress() is NOT called after optimize

// Test: existing strategies skip optimize
// Set strategy to 'middle-out'
// Verify optimize is not called (strategy has no optimize method)
```

#### Ephemeral Flow Tests
```typescript
// Test: settings flow to DensityConfig
// Set each density setting via settings service
// Call the ephemeral accessors and verify values match
// Build DensityConfig and verify all fields populated correctly
```

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P25
 * @requirement REQ-HD-002.1, REQ-HD-004.2, REQ-HD-009.5
 */
describe('high-density integration', () => { ... });
```

## Verification Commands

### Automated Checks

```bash
# 1. Integration tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: All pass (or fail naturally for tests needing P26 wiring)

# 2. All previous HD tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts
npm run test -- --run packages/core/src/core/__tests__/geminiChat-density.test.ts
npm run test -- --run packages/core/src/core/__tests__/compression-prompts.test.ts
npm run test -- --run packages/core/src/core/compression/__tests__/compression-todos.test.ts
# Expected: All pass

# 3. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 4. Plan markers updated to P25
grep -c "@plan.*HIGHDENSITY.P25" packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: ≥ 1

# 5. No stale stubs (NotYetImplemented should be replaced)
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/integration-high-density.test.ts
# Expected: 0 (all stubs from P24 replaced with real tests)
```

### Semantic Verification Checklist (MANDATORY)

1. **Does the code DO what the requirement says?**
   - [ ] Factory resolution chain tested end-to-end
   - [ ] Settings → ephemerals → DensityConfig flow tested
   - [ ] Optimize → shouldCompress → compress pipeline tested
   - [ ] Existing strategies verified unaffected by new optimize path

2. **Is this REAL implementation, not placeholder?**
   - [ ] Tests call real factory, real settings registry, real strategies
   - [ ] Tests verify real return values and behaviors
   - [ ] No mocked-out integration points

3. **Would the test FAIL if integration was broken?**
   - [ ] Removing factory case → factory test fails
   - [ ] Removing density settings → settings test fails
   - [ ] Breaking optimize wiring → pipeline test fails

## Success Criteria

- Integration tests implemented with real assertions
- Factory, settings, pipeline, and ephemeral flow all tested
- All previous HD tests pass
- TypeScript compiles
- No remaining stubs from P24

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/integration-high-density.test.ts`
2. Cannot proceed to Phase 26 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P25.md`
Contents:
```markdown
Phase: P25
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/__tests__/integration-high-density.test.ts [stubs → real tests]
Tests Added: [count]
Tests Passing: [count]
Verification: [paste verification output]
```
