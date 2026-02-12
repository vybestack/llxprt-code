# Phase 27: Migration

## Phase ID

`PLAN-20260211-HIGHDENSITY.P27`

## Prerequisites

- Required: Phase 26 completed
- Verification: All integration tests pass — `npm run test -- --run packages/core/src/core/compression/__tests__/integration-high-density.test.ts` → 0 failures
- Expected files from previous phase:
  - All integration issues resolved (P24–P26)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### Migration: Default Strategy Unchanged

**Behavior**:
- GIVEN: An existing user upgrades to the version containing high-density compression
- WHEN: They start a session without changing any settings
- THEN: The compression strategy is `middle-out` (unchanged from before)
**Why This Matters**: Existing users must not experience unexpected behavior changes.

### Migration: No Breaking Changes

**Behavior**:
- GIVEN: An existing user has a saved profile with compression settings
- WHEN: They load that profile after upgrading
- THEN: All existing settings continue to work; new density settings use their defaults
**Why This Matters**: Profile compatibility must be maintained across versions.

### Migration: Density Settings Have Sensible Defaults

**Behavior**:
- GIVEN: A user switches to `high-density` strategy
- WHEN: They haven't explicitly set any density settings
- THEN: `readWritePruning=true`, `fileDedupe=true`, `recencyPruning=false`, `recencyRetention=3`
**Why This Matters**: The default configuration should provide good out-of-box behavior without requiring configuration.

## Implementation Tasks

### Verification-Only Phase

This phase is primarily verification. The high-density feature is designed as an opt-in addition — no data migration, config migration, or breaking changes exist. The work is:

1. **Verify default strategy is unchanged**: `compression.strategy` default is still `'middle-out'`
2. **Verify profile backward compatibility**: Existing profiles without density settings load cleanly
3. **Verify density defaults are sensible**: New settings have reasonable defaults
4. **Verify existing strategy behavior unchanged**: middle-out, top-down-truncation, one-shot produce identical results to before

### Files to Verify (Read-Only — No Changes Expected)

- `packages/core/src/settings/settingsRegistry.ts`
  - Verify `compression.strategy` default is `'middle-out'`
  - Verify density settings have correct defaults

- `packages/core/src/core/compression/compressionStrategyFactory.ts`
  - Verify existing strategy cases unchanged
  - Verify `parseCompressionStrategyName()` still handles existing names

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - Verify `trigger` property exists and matches pre-HD behavior
  - Verify compress() method not broken by P23 todo injection (empty activeTodos → no change)

- `packages/core/src/core/compression/OneShotStrategy.ts`
  - Same verification as MiddleOutStrategy

- `packages/core/src/core/compression/TopDownTruncationStrategy.ts`
  - Verify unmodified by HD changes

### Files to Create

- `packages/core/src/core/compression/__tests__/migration-compatibility.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P27`
  - Test: Default strategy is `'middle-out'`, not `'high-density'`
  - Test: COMPRESSION_STRATEGIES tuple starts with `'middle-out'` as first entry
  - Test: Profile without density settings loads without error
  - Test: Profile with old compression settings (strategy, threshold) loads without error
  - Test: MiddleOutStrategy with empty activeTodos produces same result as without field
  - Test: OneShotStrategy with empty activeTodos produces same result as without field
  - Test: TopDownTruncationStrategy is unmodified (no optimize method, no activeTodos usage)
  - Test: Density settings defaults: readWritePruning=true, fileDedupe=true, recencyPruning=false, recencyRetention=3
  - Test: Existing strategies declare trigger.mode='threshold' (not 'continuous')

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P27
 */
describe('migration compatibility', () => { ... });
```

## Verification Commands

### Automated Checks

```bash
# 1. Migration tests pass
npm run test -- --run packages/core/src/core/compression/__tests__/migration-compatibility.test.ts
# Expected: All pass

# 2. Default strategy verification
grep "default.*middle-out\|defaultValue.*middle-out" packages/core/src/settings/settingsRegistry.ts
# Expected: ≥ 1 match showing middle-out is default

# 3. Existing strategy triggers
grep "mode.*threshold" packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/OneShotStrategy.ts packages/core/src/core/compression/TopDownTruncationStrategy.ts
# Expected: 3 matches (one per existing strategy)

# 4. Density settings defaults
grep -A2 "compression.density" packages/core/src/settings/settingsRegistry.ts | grep "default"
# Expected: true, true, false, 3

# 5. All HD tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/ 2>&1 | tail -10
# Expected: All pass

# 6. Full verification cycle
npm run test -- --run && npm run lint && npm run typecheck && npm run format && npm run build
# Expected: All pass
```

### Semantic Verification Checklist (MANDATORY)

1. **Is the upgrade path safe?**
   - [ ] Default strategy unchanged (middle-out)
   - [ ] Existing profiles load without error
   - [ ] New density settings have sensible defaults
   - [ ] Existing strategies behave identically to pre-HD versions

2. **Are there any breaking changes?**
   - [ ] No interfaces removed or changed (only extended with optional fields)
   - [ ] No function signatures changed (only new optional parameters)
   - [ ] No default behavior changed (existing strategies unmodified)
   - [ ] No config format changes (new settings are additive)

3. **Would existing users notice anything?**
   - [ ] No — unless they explicitly opt in to `high-density` strategy
   - [ ] Compression prompts have 4 new sections but LLM behavior is graceful (fills what's relevant)

## Success Criteria

- Migration compatibility tests pass
- Default strategy is `middle-out`
- Existing strategies produce identical results
- Density settings have correct defaults
- No breaking changes to interfaces, configs, or behavior
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/migration-compatibility.test.ts`
2. If a real migration issue is found, fix the relevant code and re-test
3. Cannot proceed to Phase 28 until all migration tests pass

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P27.md`
Contents:
```markdown
Phase: P27
Completed: [timestamp]
Files Created:
  - packages/core/src/core/compression/__tests__/migration-compatibility.test.ts [N tests]
Migration Issues Found: [list, or "none — feature is additive"]
Breaking Changes: none
Default Strategy: middle-out (unchanged)
Verification: [paste verification output]
```
