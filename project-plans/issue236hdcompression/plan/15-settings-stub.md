# Phase 15: Settings & Factory — Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P15`

## Prerequisites

- Required: Phase 14 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P14" packages/core/src/core/compression/HighDensityStrategy.ts | wc -l` → ≥ 1
- Expected files from previous phase:
  - `packages/core/src/core/compression/HighDensityStrategy.ts` (fully implemented — optimize + compress)
  - `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts` (all passing)
  - `packages/core/src/core/compression/__tests__/high-density-compress.test.ts` (all passing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-004.1: Strategy Name

**Full Text**: The `COMPRESSION_STRATEGIES` tuple shall include `'high-density'`.
**Behavior**:
- GIVEN: The COMPRESSION_STRATEGIES tuple in compression types
- WHEN: Inspected
- THEN: `'high-density'` is a member of the tuple
**Why This Matters**: The tuple drives the union type and enum validation. Without this entry, the factory cannot accept `'high-density'` as a valid strategy name.

### REQ-HD-004.2: Factory Registration

**Full Text**: The compression strategy factory shall return a `HighDensityStrategy` instance when `getCompressionStrategy('high-density')` is called.
**Behavior**:
- GIVEN: The compression strategy factory function
- WHEN: `getCompressionStrategy('high-density')` is called
- THEN: A `HighDensityStrategy` instance is returned
**Why This Matters**: The orchestrator resolves strategies by name. Without factory registration, the strategy is unreachable.

### REQ-HD-004.3: Strategy Properties

**Full Text**: The `HighDensityStrategy` shall declare `name` as `'high-density'`, `requiresLLM` as `false`, and `trigger` as `{ mode: 'continuous', defaultThreshold: 0.85 }`.
**Behavior**:
- GIVEN: A HighDensityStrategy instance
- WHEN: Properties inspected
- THEN: `name === 'high-density'`, `requiresLLM === false`, `trigger.mode === 'continuous'`, `trigger.defaultThreshold === 0.85`
**Why This Matters**: These properties determine orchestrator behavior (when to optimize, when to compress, whether to call LLM).

### REQ-HD-004.4: Settings Auto-Registration

**Full Text**: When `'high-density'` is added to `COMPRESSION_STRATEGIES`, the `compression.strategy` setting's `enumValues` shall automatically include it (via the existing `[...COMPRESSION_STRATEGIES]` derivation).
**Behavior**:
- GIVEN: `'high-density'` in COMPRESSION_STRATEGIES tuple
- WHEN: The `compression.strategy` setting is inspected
- THEN: `enumValues` includes `'high-density'`
**Why This Matters**: Users use `/set compression.strategy high-density` to activate the strategy. The enum must include it.

### REQ-HD-009.1: Read-Write Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.readWritePruning` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Searched for key `'compression.density.readWritePruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`
**Why This Matters**: This setting allows users to toggle READ→WRITE pair pruning.

### REQ-HD-009.2: File Dedupe Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.fileDedupe` with type `boolean`, default `true`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Searched for key `'compression.density.fileDedupe'`
- THEN: A spec is found with `type: 'boolean'`, `default: true`, `category: 'cli-behavior'`, `persistToProfile: true`
**Why This Matters**: This setting allows users to toggle duplicate @ file inclusion deduplication.

### REQ-HD-009.3: Recency Pruning Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyPruning` with type `boolean`, default `false`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Searched for key `'compression.density.recencyPruning'`
- THEN: A spec is found with `type: 'boolean'`, `default: false`, `category: 'cli-behavior'`, `persistToProfile: true`
**Why This Matters**: Recency pruning is opt-in (default off) because it can be aggressive.

### REQ-HD-009.4: Recency Retention Setting

**Full Text**: The `SETTINGS_REGISTRY` shall include a spec for `compression.density.recencyRetention` with type `number`, default `3`, category `'cli-behavior'`, and `persistToProfile: true`.
**Behavior**:
- GIVEN: The SETTINGS_REGISTRY array
- WHEN: Searched for key `'compression.density.recencyRetention'`
- THEN: A spec is found with `type: 'number'`, `default: 3`, `category: 'cli-behavior'`, `persistToProfile: true`
**Why This Matters**: Controls how many recent results per tool type to retain when recency pruning is enabled.

### REQ-HD-009.5: Runtime Accessors

**Full Text**: The `AgentRuntimeContext` ephemerals interface shall provide accessors: `densityReadWritePruning(): boolean`, `densityFileDedupe(): boolean`, `densityRecencyPruning(): boolean`, `densityRecencyRetention(): number`.
**Behavior**:
- GIVEN: A runtimeContext with ephemerals
- WHEN: `ephemerals.densityReadWritePruning()` is called
- THEN: Returns the configured boolean value (or default `true`)
**Why This Matters**: The orchestration and strategy code access settings through these typed accessors.

### REQ-HD-009.6: Ephemeral Settings Types

**Full Text**: The `EphemeralSettings` interface shall include optional fields for `'compression.density.readWritePruning'` (boolean), `'compression.density.fileDedupe'` (boolean), `'compression.density.recencyPruning'` (boolean), and `'compression.density.recencyRetention'` (number).
**Behavior**:
- GIVEN: The EphemeralSettings interface
- WHEN: Inspected
- THEN: Optional fields for all 4 density settings are present with correct types
**Why This Matters**: EphemeralSettings enables profile persistence and /set command type safety.

## Implementation Tasks

### Files to Modify

- `packages/core/src/settings/settingsRegistry.ts`
  - ADD 4 new setting specs after the `compression.profile` entry (after line 976, before `];`)
  - Stubs: settings specs are fully declarative (no implementation logic to stub), so the actual specs are added in this phase
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4`

- `packages/core/src/core/compression/compressionStrategyFactory.ts` (or equivalent factory location)
  - ADD `'high-density'` case that throws `Error('NotYetImplemented: high-density factory')` for now
  - ADD import placeholder comment for HighDensityStrategy
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-004.2`

- `packages/core/src/core/compression/types.ts` (or wherever COMPRESSION_STRATEGIES is defined)
  - ADD `'high-density'` to the COMPRESSION_STRATEGIES tuple (if not already done in earlier phase)
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-004.1, REQ-HD-004.4`

- Runtime accessor interface file (AgentRuntimeContext.ts or equivalent)
  - ADD 4 stub accessor declarations to ephemerals interface
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-009.5`

- EphemeralSettings type file (modelParams.ts or equivalent)
  - ADD 4 optional fields to EphemeralSettings interface
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-009.6`

- Runtime accessor wiring file (createAgentRuntimeContext.ts or equivalent)
  - ADD 4 stub accessor implementations that return defaults (these are NOT stubs in the traditional sense — they return the default values directly)
  - ADD comment: `@plan:PLAN-20260211-HIGHDENSITY.P15`
  - Implements: `@requirement:REQ-HD-009.5`

### Stub Rules

- **Settings specs**: Fully declarative — added as complete objects (not stubs). The settings registry is data, not code.
- **Factory case**: Stub — throws `Error('NotYetImplemented: high-density factory')` for now
- **COMPRESSION_STRATEGIES tuple**: Data change — `'high-density'` added (not a stub)
- **Runtime accessor interface**: Type declarations only — no implementation logic
- **EphemeralSettings**: Type declarations only
- **Runtime accessor wiring**: Return default values directly from settings service — these are simple read-through accessors, not complex logic

### Required Code Markers

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P15
 * @requirement REQ-HD-009.1, REQ-HD-009.2, REQ-HD-009.3, REQ-HD-009.4
 * @pseudocode settings-factory.md lines 14-51
 */
```

## Verification Commands

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. Settings specs present
grep -c "compression.density" packages/core/src/settings/settingsRegistry.ts
# Expected: ≥ 4

# 3. COMPRESSION_STRATEGIES includes high-density
grep "high-density" packages/core/src/core/compression/types.ts
# Expected: 1 match

# 4. Factory has high-density case (stub)
grep -A2 "high-density" packages/core/src/core/compression/compressionStrategyFactory.ts | grep "NotYetImplemented"
# Expected: 1 match

# 5. Plan markers
grep -rn "@plan.*HIGHDENSITY.P15" packages/core/src/settings/settingsRegistry.ts packages/core/src/core/compression/ | wc -l
# Expected: ≥ 2

# 6. Existing tests still pass
npm run test -- --run 2>&1 | tail -10
# Expected: All pass

# 7. Full suite with type check
npm run typecheck
# Expected: 0 errors
```

## Success Criteria

- TypeScript compiles cleanly
- 4 density settings specs in SETTINGS_REGISTRY
- `'high-density'` in COMPRESSION_STRATEGIES tuple
- Factory has stub case for `'high-density'`
- Runtime accessor interface has 4 new accessor declarations
- EphemeralSettings has 4 new optional fields
- Runtime accessor wiring returns defaults
- Plan markers reference P15
- ALL existing tests pass (no regression)

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/settings/settingsRegistry.ts`
2. `git checkout -- packages/core/src/core/compression/types.ts`
3. `git checkout -- packages/core/src/core/compression/compressionStrategyFactory.ts`
4. Revert accessor changes
5. Cannot proceed to Phase 16 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P15.md`
Contents:
```markdown
Phase: P15
Completed: [timestamp]
Files Modified:
  - packages/core/src/settings/settingsRegistry.ts [+N lines]
  - packages/core/src/core/compression/types.ts [+N lines]
  - packages/core/src/core/compression/compressionStrategyFactory.ts [+N lines]
  - [runtime accessor files] [+N lines]
Tests Added: 0 (stub phase — settings are declarative data)
Verification: [paste verification output]
```
