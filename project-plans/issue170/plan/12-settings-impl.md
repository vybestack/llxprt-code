# Phase 12: Settings & Configuration Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P12`

## Prerequisites

- Required: Phase 11 completed (settings tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P11" packages/core/src/`
- Expected files from previous phase:
  - Tests added to `settingsRegistry.test.ts` and `createAgentRuntimeContext.test.ts` (failing)

## Requirements Implemented

- **REQ-CS-007.1**: Strategy Setting — `/set compression.strategy <value>` accepted, registered in `SETTINGS_REGISTRY` with type `enum`, `enumValues` derived from `COMPRESSION_STRATEGIES` tuple
- **REQ-CS-007.2**: Profile Setting — `/set compression.profile <value>` accepted, registered as `string` type
- **REQ-CS-007.3**: Unset — `/set unset compression.strategy` and `/set unset compression.profile` clear ephemeral override, revert to persistent
- **REQ-CS-007.4**: Strategy Autocomplete — autocomplete suggestions for all registered strategy names
- **REQ-CS-007.5**: Profile Autocomplete — dynamic completer lists available profiles via `listSavedProfiles()`
- **REQ-CS-007.6**: Persist to Profile — both settings have `persistToProfile: true`
- **REQ-CS-008.1**: Settings Dialog Strategy — `compression.strategy` appears as dropdown in `/settings` dialog
- **REQ-CS-008.2**: Settings Dialog Profile — `compression.profile` appears as text input in `/settings` dialog
- **REQ-CS-008.3**: Schema Update — `settingsSchema.ts` updated with `showInDialog: true` and sub-properties
- **REQ-CS-009.1**: Ephemeral Strategy Resolution — `compressionStrategy()` accessor reads ephemeral first, then persistent
- **REQ-CS-009.2**: Ephemeral Profile Resolution — `compressionProfile()` accessor reads ephemeral first, then persistent, then `undefined`
- **REQ-CS-009.3**: No Scattered Defaults — `'middle-out'` appears only in `SETTINGS_REGISTRY`, not as `?? 'middle-out'` fallbacks
- **REQ-CS-009.4**: Fail-Fast Invariant — `compressionStrategy()` throws if value is undefined (settings system failure)
- **REQ-CS-010.1**: EphemeralSettings Type — `'compression.strategy'` and `'compression.profile'` added to `EphemeralSettings`
- **REQ-CS-010.2**: ChatCompressionSettings Type — `strategy` and `profile` fields added to `ChatCompressionSettings`
- **REQ-CS-011.1**: `/set` Strategy Autocomplete — `compression.strategy` autocompletes from `enumValues`
- **REQ-CS-011.2**: `/set` Profile Autocomplete — `compression.profile` special-case completer in `setCommand.ts`

## Implementation Tasks

### Files to Modify

1. **`packages/core/src/types/modelParams.ts`** — Add to `EphemeralSettings`:
   - `'compression.strategy'?: CompressionStrategyName`
   - `'compression.profile'?: string`
   - Import `CompressionStrategyName` from `../core/compression/types.js`
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-010.1`

2. **`packages/core/src/config/config.ts`** — Expand `ChatCompressionSettings`:
   - Add `strategy?: CompressionStrategyName`
   - Add `profile?: string`
   - Import `CompressionStrategyName` from `../core/compression/types.js`
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-010.2`

3. **`packages/core/src/settings/settingsRegistry.ts`** — Add to `SETTINGS_REGISTRY`:
   - `compression.strategy` spec: `{ key: 'compression.strategy', type: 'enum', default: 'middle-out', enumValues: [...COMPRESSION_STRATEGIES], category: 'cli-behavior', persistToProfile: true, description: '...' }`
   - `compression.profile` spec: `{ key: 'compression.profile', type: 'string', category: 'cli-behavior', persistToProfile: true, description: '...' }`
   - Import `COMPRESSION_STRATEGIES` from `../core/compression/types.js`
   - The `enumValues` MUST spread from `COMPRESSION_STRATEGIES`, not duplicate the strings
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-011.1, REQ-CS-011.2`

4. **`packages/core/src/runtime/AgentRuntimeContext.ts`** — Add to ephemerals interface:
   - `compressionStrategy(): CompressionStrategyName`
   - `compressionProfile(): string | undefined`
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`

5. **`packages/core/src/runtime/createAgentRuntimeContext.ts`** — Add accessor implementations:
   - `compressionStrategy()`: ephemeral → persistent → throw (invariant check)
   - `compressionProfile()`: ephemeral → persistent → undefined
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-009.1, REQ-CS-009.3, REQ-CS-009.4`

6. **`packages/cli/src/config/settingsSchema.ts`** — Update `chatCompression` to `showInDialog: true`, add sub-properties for strategy (dropdown) and profile (text input)
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-008.1, REQ-CS-008.2`

7. **`packages/cli/src/ui/commands/setCommand.ts`** — Add dynamic completer for `compression.profile`:
   - Follow the existing `custom-headers` special-case pattern
   - When key is `compression.profile`, list profiles via `getRuntimeApi().listSavedProfiles()` (or the available profile listing mechanism identified in P01)
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P12`, `@requirement REQ-CS-007.5`

### Required Code Markers

```typescript
// In settingsRegistry.ts:
/**
 * @plan PLAN-20260211-COMPRESSION.P12
 * @requirement REQ-CS-007.1, REQ-CS-011.1
 */
{ key: 'compression.strategy', type: 'enum', default: 'middle-out', enumValues: [...COMPRESSION_STRATEGIES], ... }

// In createAgentRuntimeContext.ts:
/**
 * @plan PLAN-20260211-COMPRESSION.P12
 * @requirement REQ-CS-009.1, REQ-CS-009.3, REQ-CS-009.4
 */
compressionStrategy(): CompressionStrategyName { ... }
```

### CRITICAL: No Scattered Defaults

The default value `'middle-out'` appears ONLY in the `SETTINGS_REGISTRY` spec's `default` field. It does NOT appear in:
- `createAgentRuntimeContext.ts` as a `?? 'middle-out'` fallback
- `EPHEMERAL_DEFAULTS` object
- Any other location

The runtime accessor for `compressionStrategy()` has an invariant check that throws if the value is undefined — it does NOT fall back to a hardcoded string.

## Verification Commands

```bash
# All Phase 11 tests pass
npx vitest run packages/core/src/settings/settingsRegistry.test.ts
npx vitest run packages/core/src/runtime/

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P12" packages/core/src/ packages/cli/src/ | wc -l
# Expected: 7+ occurrences

# No scattered defaults
grep -rn "'middle-out'" packages/core/src/runtime/ packages/core/src/core/geminiChat.ts
# Expected: 0 matches (default lives ONLY in settingsRegistry)

# Verify COMPRESSION_STRATEGIES is imported (not duplicated) in settingsRegistry
grep "COMPRESSION_STRATEGIES" packages/core/src/settings/settingsRegistry.ts
# Expected: import line + usage in enumValues

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/settings/settingsRegistry.ts packages/core/src/runtime/createAgentRuntimeContext.ts packages/core/src/types/modelParams.ts packages/core/src/config/config.ts packages/cli/src/config/settingsSchema.ts packages/cli/src/ui/commands/setCommand.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/settings/settingsRegistry.ts packages/core/src/runtime/createAgentRuntimeContext.ts packages/cli/src/config/settingsSchema.ts packages/cli/src/ui/commands/setCommand.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/runtime/createAgentRuntimeContext.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-007–011, 006A.1)
   - [ ] Read the implementation code across all modified files
   - [ ] Can explain HOW settings registration, runtime accessors, and autocomplete fulfill requirements

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual setting values (default, type, enumValues), not just existence
   - [ ] Tests would catch wrong default, missing accessor, or broken autocomplete

4. **Is the feature REACHABLE by users?**
   - [ ] `/set compression.strategy` autocompletes and persists
   - [ ] `/set compression.profile` autocompletes from saved profiles
   - [ ] `/settings` dialog shows compression options
   - [ ] Settings are reachable via ephemeral accessors at runtime

### Integration Points Verified

- [ ] `COMPRESSION_STRATEGIES` imported (not duplicated) in settingsRegistry (verified by reading both files)
- [ ] Runtime accessors correctly read ephemeral → persistent → throw/undefined (verified by checking usage)
- [ ] `EphemeralSettings` type accepts correct value types
- [ ] `ChatCompressionSettings` type accepts correct value types
- [ ] Error handling works at component boundaries (undefined strategy throws)

### Edge Cases Verified

- [ ] Empty/null input handled (undefined ephemeral and persistent)
- [ ] Invalid input rejected with clear error (invalid strategy name caught by enum type)
- [ ] Boundary values work correctly (unset profile → undefined, not error)

## Success Criteria

- All Phase 11 tests pass
- Settings appear in `SETTINGS_REGISTRY` with correct types, defaults, and enumValues
- Runtime accessors work: ephemeral → persistent → throw
- `EphemeralSettings` and `ChatCompressionSettings` types updated
- `/set compression.strategy` autocompletes from `COMPRESSION_STRATEGIES`
- `/set compression.profile` autocompletes from saved profiles
- Default `'middle-out'` appears in exactly ONE place: `SETTINGS_REGISTRY`
- Full test suite passes

## Failure Recovery

```bash
git checkout -- packages/core/src/types/modelParams.ts packages/core/src/config/config.ts packages/core/src/settings/settingsRegistry.ts packages/core/src/runtime/ packages/cli/src/
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P12.md`
Contents:
```
Phase: P12
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
