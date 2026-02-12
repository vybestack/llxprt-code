# Phase 24: Integration — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P24`

## Prerequisites

- Required: Phase 23 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P23" packages/core/src/core/compression/MiddleOutStrategy.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - All high-density strategy files implemented (P03–P14)
  - Orchestration wired in geminiChat.ts (P18–P20)
  - Enriched prompts and todo-aware summarization (P21–P23)
- Preflight verification: Phase 01a completed

## Integration Analysis (MANDATORY per dev-docs/PLAN.md)

### What existing code will USE this feature?

- `packages/core/src/core/geminiChat.ts` — `ensureCompressionBeforeSend()` calls `ensureDensityOptimized()` and uses `getCompressionStrategy('high-density')` (wired in P18–P20)
- `packages/core/src/core/compression/compressionStrategyFactory.ts` — factory returns `HighDensityStrategy` for `'high-density'` name (wired in P17)
- `packages/core/src/settings/settingsRegistry.ts` — settings registered (P15)
- `packages/core/src/core/compression/MiddleOutStrategy.ts` + `OneShotStrategy.ts` — use `activeTodos` and `transcriptPath` from context (P23)

### What existing code needs to be REPLACED?

- No existing code is replaced. High-density is a new strategy alongside existing ones.
- Existing strategies (`middle-out`, `top-down-truncation`, `one-shot`) remain unchanged and are the default.

### How will users ACCESS this feature?

- `/set compression.strategy high-density` — sets the active compression strategy
- The strategy auto-activates on each send via `ensureCompressionBeforeSend()`
- Density settings configurable via `/set compression.density.*`

### What needs to be MIGRATED?

- Nothing. Existing users keep their current strategy. High-density is opt-in.
- Default strategy remains `middle-out`.

### Integration Test Requirements

- Verify `/set compression.strategy high-density` is accepted by the settings system
- Verify the factory resolves `'high-density'` to a `HighDensityStrategy` instance
- Verify the full pipeline: density optimize → shouldCompress → performCompression
- Verify density settings are persisted in profiles

## Requirements Implemented (Expanded)

### REQ-HD-002.1: Density Optimization Before Threshold Check (Integration Wiring)

**Full Text**: When `ensureCompressionBeforeSend()` runs, the system shall call a density optimization step after settling token updates and before calling `shouldCompress()`.
**Behavior**:
- GIVEN: Strategy is set to `high-density` and user sends a message
- WHEN: `ensureCompressionBeforeSend()` runs
- THEN: `ensureDensityOptimized()` runs before `shouldCompress()`
**Why This Matters**: The integration stub ensures the full pipeline is wired correctly end-to-end.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.
**Behavior**:
- GIVEN: `'high-density'` is a valid strategy name
- WHEN: `getCompressionStrategy('high-density')` is called
- THEN: Returns a `HighDensityStrategy` instance with correct properties
**Why This Matters**: If the factory doesn't resolve correctly, the strategy is unreachable.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: The `AgentRuntimeContext` ephemerals interface shall provide density setting accessors.
**Behavior**:
- GIVEN: Density settings have been set via `/set`
- WHEN: `ensureDensityOptimized()` reads settings via ephemerals
- THEN: The settings values are correctly propagated to `DensityConfig`
**Why This Matters**: Settings must flow from user input through ephemerals to strategy config.

## Implementation Tasks

### Integration Touch Points to Verify (Stub Phase)

This phase verifies that all connection points are wired. No new code is written — this phase creates integration test stubs that verify the existing wiring.

### Files to Create

- `packages/core/src/core/compression/__tests__/integration-high-density.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P24`
  - MUST include: `@requirement:REQ-HD-002.1, REQ-HD-004.2, REQ-HD-009.5`
   - Integration test stubs (describe blocks with test names, `it.skip()` placeholders — NOT `expect(fn).toThrow('NotYetImplemented')` reverse tests):
    - Strategy factory resolves `'high-density'` correctly
    - Factory returns instance with name='high-density', requiresLLM=false
    - Factory returns instance with trigger={mode:'continuous', defaultThreshold:0.85}
    - Factory returns instance with optimize method
    - Settings system accepts `compression.strategy` value `'high-density'`
    - Settings system accepts all 4 density settings
    - Density settings flow through ephemerals to DensityConfig
    - Full pipeline: optimize → shouldCompress → compress sequence
    - Density config defaults match settings registry defaults
    - Profile persistence for density settings

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P24
 * @requirement REQ-HD-002.1, REQ-HD-004.2, REQ-HD-009.5
 */
describe('high-density integration', () => { ... });
```

## Verification Commands

### Automated Checks

```bash
# 1. TypeScript compiles
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Plan markers for P24
grep -rn "@plan.*HIGHDENSITY.P24" packages/core/src/core/compression/__tests__/integration-high-density.test.ts | wc -l
# Expected: ≥ 1

# 3. Integration test file exists and compiles
npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts 2>&1 | grep -c "test\|FAIL\|PASS"
# Expected: ≥ 1

# 4. All previous tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass (P24 stubs may skip/fail naturally)
```

### Structural Verification Checklist

- [ ] Integration test file created
- [ ] Test describes cover factory, settings, pipeline, and persistence
- [ ] Plan and requirement markers present
- [ ] No import errors (all referenced types exist)

## Success Criteria

- Integration test file compiles
- Test structure covers factory resolution, settings flow, full pipeline
- All pre-P24 tests pass
- No regressions

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/integration-high-density.test.ts`
2. Cannot proceed to Phase 25 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P24.md`
Contents:
```markdown
Phase: P24
Completed: [timestamp]
Files Created:
  - packages/core/src/core/compression/__tests__/integration-high-density.test.ts [N test stubs]
Verification: [paste verification output]
```
