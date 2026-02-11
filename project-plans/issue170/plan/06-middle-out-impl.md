# Phase 06: Middle-Out Strategy Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P06`

## Prerequisites

- Required: Phase 05 completed (tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P05" packages/core/src/core/compression/`
- Expected files from previous phase:
  - `packages/core/src/core/compression/MiddleOutStrategy.test.ts` (failing tests)

## Requirements Implemented (Expanded)

REQ-CS-002.1–002.8 (making Phase 05 tests GREEN), plus:

### REQ-CS-005.1: Prompt File

**Full Text**: The `MiddleOutStrategy` shall load its compression prompt from a markdown file (`compression/middle-out.md`) via the existing `PromptResolver`.
**Behavior**:
- GIVEN: The strategy needs a compression prompt
- WHEN: It calls `context.promptResolver.resolveFile(baseDir, 'compression/middle-out.md', promptContext)`
- THEN: It receives the prompt text from the resolution hierarchy

### REQ-CS-005.2: Resolution Hierarchy

**Full Text**: The `PromptResolver` shall search: model-specific → provider-specific → base.
**Behavior**:
- GIVEN: User has `~/.llxprt/prompts/providers/openai/compression/middle-out.md`
- WHEN: Running with openai provider
- THEN: That file is used instead of the base default

### REQ-CS-005.3: Built-In Default

**Full Text**: The current prompt content shall be added to `ALL_DEFAULTS` as `compression/middle-out.md`.
**Behavior**:
- GIVEN: No user override exists
- WHEN: Strategy resolves the prompt
- THEN: The shipped default (identical to current `getCompressionPrompt()`) is used

NOTE: `compression.md` already exists in defaults. This phase will either:
- Rename it to `compression/middle-out.md` (if prompt resolver path supports subdirectories), OR
- Keep it as `compression.md` and have the strategy load `compression.md` (simpler, pragmatic)
The preflight phase (P01) will determine the correct path. The key requirement is that the prompt is loaded via PromptResolver, not hardcoded.

### REQ-CS-005.4: Prompt Content Equivalence

**Full Text**: The shipped default shall contain the same prompt text as the current `getCompressionPrompt()` in `prompts.ts`.
**Behavior**: Verify `compression.md` (or `compression/middle-out.md`) content matches. P01 already identified `compression.md` exists — compare.

### REQ-CS-005.5: Deprecation

**Full Text**: When the prompt is loaded via `PromptResolver`, the `getCompressionPrompt()` function shall no longer be called by production code.
**Behavior**: `getCompressionPrompt` import removed from `geminiChat.ts`. (This happens in P14 when the dispatcher is rewritten.)

## Implementation Tasks

### Files to Create

- `packages/core/src/core/compression/MiddleOutStrategy.ts`
  - MUST include: `@plan PLAN-20260211-COMPRESSION.P06`
  - MUST include: `@requirement REQ-CS-002.1, REQ-CS-002.2, REQ-CS-005.1`
  - Implements `CompressionStrategy` interface
  - `name: 'middle-out' as const`
  - `requiresLLM: true`
  - `compress(context: CompressionContext): Promise<CompressionResult>`
  - Internal methods (private or module-scoped):
    - Split logic: computes top/middle/bottom using `context.runtimeContext.ephemerals.preserveThreshold()` and `topPreserveThreshold()`
    - Uses `adjustForToolCallBoundary` from `./utils.js`
    - Loads prompt via `context.promptResolver.resolveFile(...)` — falls back to error if not found (REQ-CS-006A.3)
    - Calls provider via `context.resolveProvider(compressionProfile)` where profile is from `context.runtimeContext.ephemerals.compressionProfile()`
    - Assembles provider request: `[{human: prompt}, ...middleMessages, {human: triggerInstruction}]`
    - Collects streamed response into summary text
    - Returns `CompressionResult` with `newHistory: [...toKeepTop, summaryMsg, ackMsg, ...toKeepBottom]`

### Files to Modify

- `packages/core/src/core/compression/index.ts` — export `MiddleOutStrategy`
- `packages/core/src/prompt-config/defaults/core-defaults.ts` — if renaming `compression.md` to `compression/middle-out.md`, update the key here. If keeping as `compression.md`, no change needed. (Determined by P01.)

### CRITICAL: This Is an Extraction

Read the current `geminiChat.ts` methods carefully:
- `getCompressionSplit()` (lines ~2044–2093): the split logic
- `directCompressionCall()` (lines ~2206–2286): the LLM call
- `applyCompression()` (lines ~2291–2333): result assembly

The strategy's `compress()` must replicate this exact behavior. The key differences:
1. Uses `context.history` instead of `this.historyService.getCurated()`
2. Uses `context.promptResolver` instead of `getCompressionPrompt()`
3. Uses `context.resolveProvider()` instead of `this.resolveProviderForRuntime()`
4. Returns a `CompressionResult` instead of directly mutating history

## Verification Commands

```bash
# All Phase 05 tests pass
npx vitest run packages/core/src/core/compression/MiddleOutStrategy.test.ts
# Expected: all pass

# Plan markers
grep -r "@plan PLAN-20260211-COMPRESSION.P06" packages/core/src/core/compression/ | wc -l
# Expected: 3+ occurrences

# No deferred implementation
grep -rn -E "(TODO|FIXME|HACK|STUB)" packages/core/src/core/compression/MiddleOutStrategy.ts
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Success Criteria

- All Phase 05 tests pass
- Strategy is a standalone class implementing `CompressionStrategy`
- Uses shared utility functions from `utils.ts`
- Loads prompt via `PromptResolver`, not hardcoded
- Returns `CompressionResult` (does NOT mutate history)
- Full test suite passes (no regressions)

## Failure Recovery

```bash
git checkout -- packages/core/src/core/compression/MiddleOutStrategy.ts packages/core/src/core/compression/index.ts
```
