# Phase 12: Settings & Configuration Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P12`

## Prerequisites

- Required: Phase 11 completed (settings tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P11" packages/core/src/`
- Expected files from previous phase:
  - Tests added to `settingsRegistry.test.ts` and `createAgentRuntimeContext.test.ts` (failing)

## Requirements Implemented (Expanded)

REQ-CS-007.1–007.6, REQ-CS-008.1–008.3, REQ-CS-009.1–009.4, REQ-CS-010.1–010.2, REQ-CS-011.1–011.2 (making Phase 11 tests GREEN).

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

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

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
