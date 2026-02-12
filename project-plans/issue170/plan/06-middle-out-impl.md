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

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/compression/MiddleOutStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/compression/MiddleOutStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/compression/MiddleOutStrategy.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Full suite still passes
npm run test
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-002.1–002.8, REQ-CS-005.1–005.4)
   - [ ] Read the implementation code in `MiddleOutStrategy.ts`
   - [ ] Can explain HOW the sandwich split, LLM call, and result assembly fulfill requirements

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual compressed history output, not just that code ran
   - [ ] Tests would catch a broken split, missing summary, or wrong metadata

4. **Is the feature REACHABLE by users?**
   - [ ] Code is called from existing code paths (or will be once dispatcher is wired in P14)
   - [ ] There is a path from runtime to this code (factory returns this strategy)

### Integration Points Verified

- [ ] `CompressionContext` fields used correctly by strategy (verified by reading both files)
- [ ] `CompressionResult` returned correctly (verified by checking dispatcher usage in P14)
- [ ] `PromptResolver.resolveFile()` called with correct arguments
- [ ] `resolveProvider()` called with profile name or undefined
- [ ] Error handling works at component boundaries (prompt not found, LLM failure)

### Edge Cases Verified

- [ ] Empty/null input handled (empty history)
- [ ] Invalid input rejected with clear error
- [ ] Boundary values work correctly (minimum compressible messages, tool-call boundaries at edges)

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

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P06.md`
Contents:
```
Phase: P06
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
