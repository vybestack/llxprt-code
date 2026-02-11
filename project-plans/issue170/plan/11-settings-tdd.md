# Phase 11: Settings & Configuration TDD

## Phase ID

`PLAN-20260211-COMPRESSION.P11`

## Prerequisites

- Required: Phase 10 completed (factory passes)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P10" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/compressionStrategyFactory.ts` (passing tests)

## Requirements Implemented (Expanded)

### REQ-CS-007.1: Strategy Setting

**Full Text**: The system shall accept `/set compression.strategy <value>` where value is one of the registered strategy names.
**Behavior**:
- GIVEN: A runtime settings service
- WHEN: User sets `compression.strategy` to `'top-down-truncation'`
- THEN: The value is stored and retrievable

### REQ-CS-007.4: Strategy Autocomplete

**Full Text**: When the user types `/set compression.strategy `, the system shall offer autocomplete suggestions for all registered strategy names.
**Behavior**:
- GIVEN: `getDirectSettingSpecs()` is called
- WHEN: The spec for `compression.strategy` is examined
- THEN: It has `enumValues` containing all names from `COMPRESSION_STRATEGIES`

### REQ-CS-007.5: Profile Autocomplete

**Full Text**: When the user types `/set compression.profile `, the system shall offer autocomplete suggestions from saved profiles.
**Behavior**:
- GIVEN: Saved profiles exist (`myflash`, `cheapmodel`)
- WHEN: User is completing `/set compression.profile `
- THEN: `myflash` and `cheapmodel` are offered as completions

### REQ-CS-007.6: Profile Persistence

**Full Text**: Both settings shall have `persistToProfile: true`.
**Behavior**:
- GIVEN: `getSettingSpec('compression.strategy')`
- WHEN: `persistToProfile` is checked
- THEN: It is `true`

### REQ-CS-008.3: Default Value

**Full Text**: The settings schema shall define `'middle-out'` as the default value for `compression.strategy`.
**Behavior**:
- GIVEN: `getSettingSpec('compression.strategy')`
- WHEN: `default` is checked
- THEN: It is `'middle-out'`

### REQ-CS-009.1–009.4: Settings Resolution

**Full Text**: Ephemeral overrides persistent; no scattered defaults; undefined throws.
**Behavior**:
- GIVEN: Ephemeral is `'top-down-truncation'`, persistent is `'middle-out'`
- WHEN: Runtime accessor is called
- THEN: Returns `'top-down-truncation'`
- GIVEN: Neither ephemeral nor persistent is set (both undefined)
- WHEN: Runtime accessor is called
- THEN: Throws (invariant check per REQ-CS-009.4)

### REQ-CS-010.1–010.2: Type Definitions

**Full Text**: `EphemeralSettings` includes `'compression.strategy'` and `'compression.profile'`. `ChatCompressionSettings` includes `strategy` and `profile`.
**Behavior**: Verified through TypeScript compilation — if types don't include these fields, assignment in tests will fail.

### REQ-CS-011.1–011.2: Settings Registry

**Full Text**: `SETTINGS_REGISTRY` includes specs for both settings.
**Behavior**:
- GIVEN: `SETTINGS_REGISTRY` is queried
- WHEN: Looking for `compression.strategy`
- THEN: Found with type `'enum'`, default `'middle-out'`, `persistToProfile: true`
- WHEN: Looking for `compression.profile`
- THEN: Found with type `'string'`, `persistToProfile: true`

### REQ-CS-007.2: Profile Setting

**Full Text**: The system shall accept `/set compression.profile <value>` where value is a saved profile name.
**Behavior**:
- GIVEN: A runtime settings service
- WHEN: User sets `compression.profile` to `'myflashprofile'` via ephemeral
- THEN: The value is stored and retrievable via `ephemerals.compressionProfile()`
**Why This Matters**: Users need to be able to direct compression to use a specific (cheaper/faster) model profile.

### REQ-CS-007.3: Unset

**Full Text**: The system shall accept `/set unset compression.strategy` and `/set unset compression.profile` to clear the ephemeral override and revert to the persistent setting.
**Behavior**:
- GIVEN: Ephemeral `compression.strategy` is set to `'top-down-truncation'`
- WHEN: User executes `/set unset compression.strategy`
- THEN: The ephemeral override is cleared and the persistent value is used
**Why This Matters**: Users need to be able to revert to their default settings after temporarily overriding.

### REQ-CS-006A.1: Unknown Compression Profile

**Full Text**: If `compression.profile` names a profile that does not exist, the system shall throw.
**Behavior**:
- GIVEN: `compression.profile` is set to `'nonexistent-profile'`
- WHEN: The compression profile is resolved
- THEN: Error thrown identifying the missing profile name

## Implementation Tasks

### Files to Create/Modify

- `packages/core/src/settings/settingsRegistry.test.ts` (MODIFY — add tests)
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P11`
  - Tests:
    - `getSettingSpec('compression.strategy')` returns a spec with type `'enum'`, default `'middle-out'`, `enumValues` matching `COMPRESSION_STRATEGIES`, `persistToProfile: true`
    - `getSettingSpec('compression.profile')` returns a spec with type `'string'`, `persistToProfile: true`
    - `getDirectSettingSpecs()` includes both `compression.strategy` and `compression.profile`
    - `compression.strategy` spec's `enumValues` derive from the `COMPRESSION_STRATEGIES` constant (import and compare)
    - `compression.strategy` can be unset (ephemeral cleared, falls back to persistent value) `@requirement REQ-CS-007.3`
    - `compression.profile` can be unset (ephemeral cleared, falls back to persistent or undefined) `@requirement REQ-CS-007.3`

- `packages/core/src/runtime/createAgentRuntimeContext.test.ts` (MODIFY or CREATE — add tests for new accessors)
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P11`
  - Tests:
    - `ephemerals.compressionStrategy()` returns ephemeral value when set
    - `ephemerals.compressionStrategy()` returns persistent value when ephemeral is unset
    - `ephemerals.compressionStrategy()` throws when both are undefined (invariant)
    - `ephemerals.compressionProfile()` returns ephemeral value when set
    - `ephemerals.compressionProfile()` returns ephemeral value `'myflashprofile'` when set to that value (verify exact retrieval) `@requirement REQ-CS-007.2`
    - `ephemerals.compressionProfile()` returns persistent value when ephemeral is unset
    - `ephemerals.compressionProfile()` returns undefined when neither is set (no profile is valid — means use active model)
    - `ephemerals.compressionStrategy()` falls back to persistent after ephemeral is unset `@requirement REQ-CS-007.3`
    - `ephemerals.compressionProfile()` falls back to persistent (or undefined) after ephemeral is unset `@requirement REQ-CS-007.3`

### Required Code Markers

```typescript
describe('compression settings @plan PLAN-20260211-COMPRESSION.P11', () => {
  it('compression.strategy spec has correct default @requirement REQ-CS-008.3', () => {
    // ...
  });
  it('compressionStrategy() throws when undefined @requirement REQ-CS-009.4', () => {
    // ...
  });
});
```

## Verification Commands

```bash
# Tests exist
grep -r "@plan PLAN-20260211-COMPRESSION.P11" packages/core/src/ | wc -l
# Expected: 8+ occurrences

# Tests fail (settings not added yet)
npx vitest run packages/core/src/settings/settingsRegistry.test.ts 2>&1 | tail -20
npx vitest run packages/core/src/runtime/ 2>&1 | tail -20
```

## Success Criteria

- 8+ behavioral tests covering settings registry, runtime accessors, and autocomplete
- Tests verify actual values (default, type, enumValues), not just that spec exists
- Tests fail because settings/accessors don't exist yet

## Failure Recovery

```bash
git stash  # preserve test additions
# or
git checkout -- packages/core/src/settings/settingsRegistry.test.ts packages/core/src/runtime/
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P11.md`
Contents:
```
Phase: P11
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
