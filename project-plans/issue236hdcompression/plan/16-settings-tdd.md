# Phase 16: Settings & Factory — TDD

## Phase ID

`PLAN-20260211-HIGHDENSITY.P16`

## Prerequisites

- Required: Phase 15 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P15" packages/core/src/settings/settingsRegistry.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/settings/settingsRegistry.ts` (4 density settings added)
  - `packages/core/src/core/compression/types.ts` (`'high-density'` in COMPRESSION_STRATEGIES)
  - `packages/core/src/core/compression/compressionStrategyFactory.ts` (stub case for `'high-density'`)
  - Runtime accessor interface and wiring files (4 new accessors)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.
**Behavior**:
- GIVEN: The COMPRESSION_STRATEGIES tuple
- WHEN: Inspected or spread into an array
- THEN: `'high-density'` is included as a member
**Why This Matters**: The tuple drives the type union and settings enum derivation.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.
**Behavior**:
- GIVEN: The strategy factory
- WHEN: `getCompressionStrategy('high-density')` is called
- THEN: Returns an instance of HighDensityStrategy
**Why This Matters**: The orchestrator resolves strategies by name — factory must return the correct instance.

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.
**Behavior**:
- GIVEN: A HighDensityStrategy instance from the factory
- WHEN: Properties inspected
- THEN: name, requiresLLM, trigger match the specified values
**Why This Matters**: These properties control orchestrator behavior.

### REQ-HD-004.4: Settings Auto-Registration

**Full Text**: When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the `compression.strategy` setting's `enumValues` shall automatically include it.
**Behavior**:
- GIVEN: `'high-density'` in COMPRESSION_STRATEGIES
- WHEN: The `compression.strategy` setting's enumValues is inspected
- THEN: `'high-density'` is in the array
**Why This Matters**: Users need `/set compression.strategy high-density` to work.

### REQ-HD-009.1: Read-Write Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.readWritePruning` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Finding the spec for `'compression.density.readWritePruning'`
- THEN: type is `'boolean'`, default is `true`
**Why This Matters**: Users can `/set compression.density.readWritePruning false` to disable.

### REQ-HD-009.2: File Dedupe Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.fileDedupe` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Finding the spec for `'compression.density.fileDedupe'`
- THEN: type is `'boolean'`, default is `true`
**Why This Matters**: Users can toggle file dedup independently.

### REQ-HD-009.3: Recency Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyPruning` with type `boolean`, default `false`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Finding the spec for `'compression.density.recencyPruning'`
- THEN: type is `'boolean'`, default is `false`
**Why This Matters**: Recency pruning is opt-in by default.

### REQ-HD-009.4: Recency Retention Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyRetention` with type `number`, default `3`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Finding the spec for `'compression.density.recencyRetention'`
- THEN: type is `'number'`, default is `3`
**Why This Matters**: Controls the recency window size.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: The `AgentRuntimeContext` ephemerals interface shall provide accessors: `densityReadWritePruning(): boolean`, `densityFileDedupe(): boolean`, `densityRecencyPruning(): boolean`, `densityRecencyRetention(): number`.
**Behavior**:
- GIVEN: A runtime context with configured settings
- WHEN: `ephemerals.densityReadWritePruning()` is called
- THEN: Returns the configured value (ephemeral → profile → default)
**Why This Matters**: The strategy and orchestration code call these to build DensityConfig.

### REQ-HD-009.6: Ephemeral Settings Types

**Full Text**: The `EphemeralSettings` interface shall include optional fields for all 4 density settings.
**Behavior**:
- GIVEN: EphemeralSettings type
- WHEN: Setting a density field
- THEN: TypeScript accepts the correct type, rejects wrong types
**Why This Matters**: Type safety for profile persistence and /set commands.

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/__tests__/high-density-settings.test.ts`
  - MUST include: `@plan:PLAN-20260211-HIGHDENSITY.P16`
  - MUST include: `@requirement:REQ-HD-004.1` through `REQ-HD-004.4`, `REQ-HD-009.1` through `REQ-HD-009.6`

### Test Cases (Behavioral — NOT mock theater)

All tests operate on REAL objects (the actual SETTINGS_REGISTRY array, real COMPRESSION_STRATEGIES tuple, real factory function, real runtime context builder). No mocking of settings internals.

#### COMPRESSION_STRATEGIES Tuple Tests

1. **`COMPRESSION_STRATEGIES includes 'high-density'`** `@requirement:REQ-HD-004.1`
   - GIVEN: The COMPRESSION_STRATEGIES tuple
   - WHEN: Checked for membership
   - THEN: `COMPRESSION_STRATEGIES.includes('high-density')` is true

2. **`COMPRESSION_STRATEGIES preserves existing strategies`** `@requirement:REQ-HD-004.1`
   - GIVEN: The COMPRESSION_STRATEGIES tuple
   - WHEN: Checked for existing members
   - THEN: `'middle-out'`, `'top-down-truncation'`, `'one-shot'` are all still present

#### Factory Tests

3. **`getCompressionStrategy('high-density') returns HighDensityStrategy`** `@requirement:REQ-HD-004.2`
   - GIVEN: The factory function
   - WHEN: `getCompressionStrategy('high-density')` is called
   - THEN: Returns an object with `name === 'high-density'`

4. **`HighDensityStrategy from factory has correct properties`** `@requirement:REQ-HD-004.3`
   - GIVEN: `const strategy = getCompressionStrategy('high-density')`
   - WHEN: Properties inspected
   - THEN: `strategy.name === 'high-density'`, `strategy.requiresLLM === false`, `strategy.trigger.mode === 'continuous'`, `strategy.trigger.defaultThreshold === 0.85`

5. **`HighDensityStrategy from factory has optimize method`** `@requirement:REQ-HD-004.2`
   - GIVEN: `const strategy = getCompressionStrategy('high-density')`
   - WHEN: Checking for optimize
   - THEN: `typeof strategy.optimize === 'function'`

6. **`HighDensityStrategy from factory has compress method`** `@requirement:REQ-HD-004.2`
   - GIVEN: `const strategy = getCompressionStrategy('high-density')`
   - WHEN: Checking for compress
   - THEN: `typeof strategy.compress === 'function'`

#### Settings Enum Auto-Registration Tests

7. **`compression.strategy setting includes 'high-density' in enumValues`** `@requirement:REQ-HD-004.4`
   - GIVEN: The SETTINGS_REGISTRY array
   - WHEN: Finding the `compression.strategy` entry
   - THEN: Its `enumValues` array includes `'high-density'`

8. **`compression.strategy setting's enumValues derives from COMPRESSION_STRATEGIES`** `@requirement:REQ-HD-004.4`
   - GIVEN: COMPRESSION_STRATEGIES tuple and the setting's enumValues
   - WHEN: Compared
   - THEN: Every member of COMPRESSION_STRATEGIES is in enumValues

#### Settings Registry Spec Tests

9. **`compression.density.readWritePruning setting exists with correct spec`** `@requirement:REQ-HD-009.1`
   - GIVEN: The SETTINGS_REGISTRY array
   - WHEN: Finding by key `'compression.density.readWritePruning'`
   - THEN: type is `'boolean'`, default is `true`, category is `'cli-behavior'`, persistToProfile is `true`

10. **`compression.density.fileDedupe setting exists with correct spec`** `@requirement:REQ-HD-009.2`
    - GIVEN: The SETTINGS_REGISTRY array
    - WHEN: Finding by key `'compression.density.fileDedupe'`
    - THEN: type is `'boolean'`, default is `true`, category is `'cli-behavior'`, persistToProfile is `true`

11. **`compression.density.recencyPruning setting exists with correct spec`** `@requirement:REQ-HD-009.3`
    - GIVEN: The SETTINGS_REGISTRY array
    - WHEN: Finding by key `'compression.density.recencyPruning'`
    - THEN: type is `'boolean'`, default is `false`, category is `'cli-behavior'`, persistToProfile is `true`

12. **`compression.density.recencyRetention setting exists with correct spec`** `@requirement:REQ-HD-009.4`
    - GIVEN: The SETTINGS_REGISTRY array
    - WHEN: Finding by key `'compression.density.recencyRetention'`
    - THEN: type is `'number'`, default is `3`, category is `'cli-behavior'`, persistToProfile is `true`

#### Runtime Accessor Tests

13. **`densityReadWritePruning returns configured value`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context where `compression.density.readWritePruning` is set to `false`
    - WHEN: `ephemerals.densityReadWritePruning()` is called
    - THEN: Returns `false`

14. **`densityReadWritePruning returns default when unset`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context with no density settings configured
    - WHEN: `ephemerals.densityReadWritePruning()` is called
    - THEN: Returns `true` (the default)

15. **`densityFileDedupe returns configured value`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context where `compression.density.fileDedupe` is set to `false`
    - WHEN: `ephemerals.densityFileDedupe()` is called
    - THEN: Returns `false`

16. **`densityRecencyPruning returns configured value`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context where `compression.density.recencyPruning` is set to `true`
    - WHEN: `ephemerals.densityRecencyPruning()` is called
    - THEN: Returns `true`

17. **`densityRecencyPruning returns default false when unset`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context with no density settings configured
    - WHEN: `ephemerals.densityRecencyPruning()` is called
    - THEN: Returns `false`

18. **`densityRecencyRetention returns configured value`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context where `compression.density.recencyRetention` is set to `5`
    - WHEN: `ephemerals.densityRecencyRetention()` is called
    - THEN: Returns `5`

19. **`densityRecencyRetention returns default 3 when unset`** `@requirement:REQ-HD-009.5`
    - GIVEN: A runtime context with no density settings configured
    - WHEN: `ephemerals.densityRecencyRetention()` is called
    - THEN: Returns `3`

#### Threshold Precedence Tests

20. **`ephemeral setting overrides profile setting`** `@requirement:REQ-HD-009.5`
    - GIVEN: Profile sets `compression.density.readWritePruning` to `true`, ephemeral overrides to `false`
    - WHEN: Accessor called
    - THEN: Returns `false` (ephemeral wins)

21. **`profile setting overrides strategy default`** `@requirement:REQ-HD-009.5`
    - GIVEN: Profile sets `compression.density.recencyPruning` to `true` (default is `false`)
    - WHEN: Accessor called
    - THEN: Returns `true` (profile wins over default)

#### REQ-HD-001.10: Compression Threshold Precedence Tests

22. **`no ephemeral, no profile → compression-threshold returns strategy.trigger.defaultThreshold`** `@requirement:REQ-HD-001.10`
    - GIVEN: No ephemeral `compression-threshold` set, no profile `compression-threshold` set, active strategy is `'high-density'` with `trigger.defaultThreshold === 0.85`
    - WHEN: The compression threshold accessor is called
    - THEN: Returns `0.85` (strategy's default threshold)

23. **`profile compression-threshold set → profile value wins over strategy default`** `@requirement:REQ-HD-001.10`
    - GIVEN: No ephemeral `compression-threshold` set, profile sets `compression-threshold` to `0.70`, active strategy default is `0.85`
    - WHEN: The compression threshold accessor is called
    - THEN: Returns `0.70` (profile wins over strategy default)

24. **`ephemeral compression-threshold set → ephemeral wins over profile and strategy default`** `@requirement:REQ-HD-001.10`
    - GIVEN: Ephemeral `compression-threshold` set to `0.60`, profile sets `compression-threshold` to `0.70`, strategy default is `0.85`
    - WHEN: The compression threshold accessor is called
    - THEN: Returns `0.60` (ephemeral wins over both profile and strategy default)

#### Property-Based Tests (≥ 30% of total)

25. **`all density settings have 'cli-behavior' category`**
    - Property: Every setting with key starting `'compression.density.'` has category `'cli-behavior'`

26. **`all density settings have persistToProfile true`**
    - Property: Every setting with key starting `'compression.density.'` has persistToProfile `true`

27. **`boolean density settings return boolean from accessor`**
    - Property: For any boolean value set, the accessor returns a boolean

28. **`recencyRetention accessor returns a number`**
    - Property: For any number value set, `densityRecencyRetention()` returns a number

29. **`COMPRESSION_STRATEGIES is a superset of original strategies`**
    - Property: `['middle-out', 'top-down-truncation', 'one-shot']` are all still in COMPRESSION_STRATEGIES

30. **`factory returns strategy with correct name for all strategy names`**
    - Property: For each name in COMPRESSION_STRATEGIES, `getCompressionStrategy(name).name === name`

31. **`every COMPRESSION_STRATEGIES member appears in compression.strategy enumValues`**
    - Property: For each member of COMPRESSION_STRATEGIES, it appears in the setting's enumValues

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P16
 * @requirement REQ-HD-004.1
 */
it('COMPRESSION_STRATEGIES includes high-density', () => { ... });
```

### Test Infrastructure Notes

- For settings registry tests: import SETTINGS_REGISTRY directly and search the array
- For factory tests: import `getCompressionStrategy` and call with `'high-density'`
- For runtime accessor tests: build a real (or minimal-real) runtime context using the project's existing test helpers (e.g., `createAgentRuntimeContext` or equivalent)
- For threshold precedence tests: configure both ephemeral and profile values, verify resolution order
- NO mocking of the settings service, factory, or strategy internals

## Verification Commands

```bash
# 1. Test file exists
test -f packages/core/src/core/compression/__tests__/high-density-settings.test.ts && echo "PASS" || echo "FAIL"

# 2. Sufficient test count
count=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
[ "$count" -ge 23 ] && echo "PASS: $count tests" || echo "FAIL: only $count tests"

# 3. Plan markers present
grep -c "@plan.*HIGHDENSITY.P16" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: ≥ 1

# 4. Requirement markers present
grep -c "@requirement.*REQ-HD-004\|@requirement.*REQ-HD-009" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: ≥ 6

# 5. No mock theater
grep -c "toHaveBeenCalled\b" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 6. No reverse testing
grep -c "NotYetImplemented" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 7. No spying on internals
grep -c "vi\.spyOn\|jest\.spyOn" packages/core/src/core/compression/__tests__/high-density-settings.test.ts
# Expected: 0

# 8. Property-based test ratio
prop_count=$(grep -c "fc\.\|test\.prop\|fc\.assert\|fc\.property" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
total=$(grep -c "it(" packages/core/src/core/compression/__tests__/high-density-settings.test.ts)
echo "Property tests: $prop_count / $total total"
# Expected: ratio ≥ 0.30

# 9. Tests run — some may pass (settings specs are data, not stubs), factory tests will fail (stub)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-settings.test.ts 2>&1 | tail -15

# 10. Optimize/compress tests still pass
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts 2>&1 | tail -5
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-compress.test.ts 2>&1 | tail -5
# Expected: All pass
```

## Success Criteria

- Test file created with ≥ 23 behavioral test cases
- ≥ 30% property-based tests
- No mock theater, no reverse testing, no spying
- Tests compile and run (factory tests fail due to stub; settings/accessor tests may pass since specs are data)
- All REQ-HD-004 and REQ-HD-009 sub-requirements covered
- Plan, requirement markers present
- No modifications to production code (tests only)
- Existing optimize/compress tests still pass

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/__tests__/high-density-settings.test.ts`
2. Re-run Phase 16 with corrected test cases

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P16.md`
Contents:
```markdown
Phase: P16
Completed: [timestamp]
Files Created: packages/core/src/core/compression/__tests__/high-density-settings.test.ts [N lines]
Tests Added: [count]
Tests Passing: [count] (settings/accessor tests may pass; factory tests fail due to stub)
Tests Failing: [count]
Verification: [paste verification output]
```
