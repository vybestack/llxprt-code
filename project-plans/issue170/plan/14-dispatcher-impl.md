# Phase 14: Dispatcher Integration Implementation

## Phase ID

`PLAN-20260211-COMPRESSION.P14`

## Prerequisites

- Required: Phase 13 completed (dispatcher tests exist and fail)
- Verification: `grep -r "@plan PLAN-20260211-COMPRESSION.P13" packages/core/src/`
- Expected files from previous phase:
  - Dispatcher tests added to `client.test.ts` (failing)

## Requirements Implemented (Expanded)

REQ-CS-006.1–006.4, REQ-CS-002.9, REQ-CS-005.5, REQ-CS-006A.2–006A.4 (making Phase 13 tests GREEN).

### REQ-CS-002.9: Code Removal

**Full Text**: When the `MiddleOutStrategy` is extracted, the following shall be removed from `geminiChat.ts`: `getCompressionSplit()`, `directCompressionCall()`, `applyCompression()`, `adjustForToolCallBoundary()`, `findForwardValidSplitPoint()`, `findBackwardValidSplitPoint()`, and the `getCompressionPrompt` import.
**Behavior**:
- GIVEN: All strategies and factory are implemented
- WHEN: `performCompression()` is rewritten as a dispatcher
- THEN: The six extracted methods are deleted from `geminiChat.ts`
- AND: The `import { getCompressionPrompt } from './prompts.js'` is removed
**Why This Matters**: Dead code removal. The extracted logic now lives in `compression/`.

### REQ-CS-005.5: Deprecation

**Full Text**: `getCompressionPrompt()` in `prompts.ts` shall no longer be called by production code.
**Behavior**: The import is removed from `geminiChat.ts`. The function itself can remain in `prompts.ts` for now (it's not exported from the package barrel).

## Implementation Tasks

### Files to Modify

1. **`packages/core/src/core/geminiChat.ts`** — THE BIG CHANGE:
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P14`
   - MUST include: `@requirement REQ-CS-006.1, REQ-CS-002.9`

   **Rewrite `performCompression()`** from:
   ```
   async performCompression(prompt_id) {
     startCompression();
     const { toKeepTop, toCompress, toKeepBottom } = getCompressionSplit();
     const summary = await directCompressionCall(toCompress, prompt_id);
     applyCompression(summary, toKeepTop, toKeepBottom);
     endCompression();
   }
   ```
   To:
   ```
   async performCompression(prompt_id) {
     startCompression();
     try {
       const strategyName = this.runtimeContext.ephemerals.compressionStrategy();
       const strategy = getCompressionStrategy(strategyName);
       const context = this.buildCompressionContext(prompt_id);
       const result = await strategy.compress(context);
       // Apply result: clear history, add each entry from newHistory
       this.historyService.clear();
       for (const content of result.newHistory) {
         this.historyService.add(content, this.runtimeState.model);
       }
       this.logger.debug('Compression completed', result.metadata);
     } catch (error) {
       this.logger.error('Compression failed:', error);
       throw error;
     } finally {
       this.historyService.endCompression();
     }
   }
   ```

   **Add `buildCompressionContext()`** private method:
   - Assembles `CompressionContext` from available runtime data
   - `history`: `this.historyService.getCurated()`
   - `runtimeContext`: `this.runtimeContext`
   - `runtimeState`: `this.runtimeState`
   - `estimateTokens`: `(contents) => this.historyService.estimateTokensForContents(contents)`
   - `currentTokenCount`: `this.historyService.getTotalTokens()`
   - `logger`: `this.logger`
   - `resolveProvider`: `(profileName?) => this.resolveProviderForRuntime(profileName)` — when `profileName` is `undefined`, the provider uses the active model/provider; when it's a non-empty string, it resolves the named profile
   - `promptResolver`: Needs `PromptResolver` access — thread through constructor or AgentRuntimeContext
   - `promptContext`: `{ provider: this.runtimeState.provider, model: this.runtimeState.model }`
   - `promptId`: from the parameter
   - Does NOT include `historyService`

   **Thread `PromptResolver` access**: The `PromptResolver` instance needs to reach `geminiChat.ts`. Options:
   - Add it to `AgentRuntimeContext` (cleanest — it's a runtime service)
   - Pass through constructor
   - P01 preflight will determine the best approach based on how `PromptResolver` is currently instantiated

   **DELETE these methods** from `geminiChat.ts`:
   - `getCompressionSplit()` (~lines 2044–2093)
   - `adjustForToolCallBoundary()` (~lines 2102–2123)
   - `findForwardValidSplitPoint()` (~lines 2125–2159)
   - `findBackwardValidSplitPoint()` (~lines 2162–2201)
   - `directCompressionCall()` (~lines 2206–2286)
   - `applyCompression()` (~lines 2291–2333)

   **Remove import**: `import { getCompressionPrompt } from './prompts.js'`

   **Add imports**: `getCompressionStrategy` from `./compression/index.js`, `CompressionContext` from `./compression/types.js`

2. **`packages/core/src/runtime/AgentRuntimeContext.ts`** (if threading PromptResolver):
   - Add `promptResolver?: PromptResolver` to the context interface
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P14`

3. **`packages/core/src/runtime/createAgentRuntimeContext.ts`** (if threading PromptResolver):
   - Wire `promptResolver` into the context construction
   - MUST include: `@plan PLAN-20260211-COMPRESSION.P14`

### Required Code Markers

```typescript
// In geminiChat.ts:
/**
 * @plan PLAN-20260211-COMPRESSION.P14
 * @requirement REQ-CS-006.1, REQ-CS-002.9
 */
async performCompression(prompt_id: string): Promise<void> {
  // ...
}

/**
 * @plan PLAN-20260211-COMPRESSION.P14
 * @requirement REQ-CS-006.1
 */
private buildCompressionContext(prompt_id: string): CompressionContext {
  // ...
}
```

## Verification Commands

```bash
# All Phase 13 dispatcher tests pass
npx vitest run packages/core/src/core/client.test.ts
# Expected: all pass

# All compression module tests still pass
npx vitest run packages/core/src/core/compression/
# Expected: all pass

# Extracted methods removed from geminiChat.ts
grep -n "getCompressionSplit\|directCompressionCall\b\|applyCompression\b\|adjustForToolCallBoundary\|findForwardValidSplitPoint\|findBackwardValidSplitPoint" packages/core/src/core/geminiChat.ts
# Expected: only the NEW import/usage of getCompressionStrategy, not the old method definitions

# getCompressionPrompt import removed
grep "getCompressionPrompt" packages/core/src/core/geminiChat.ts
# Expected: 0 matches

# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|WIP)" packages/core/src/core/geminiChat.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder|not yet|will be|should be)" packages/core/src/core/geminiChat.ts | grep -v ".test.ts"
# Expected: 0 matches

# Check for empty/trivial implementations
grep -rn -E "return \[\]|return \{\}|return null|return undefined" packages/core/src/core/geminiChat.ts | grep -v ".test.ts"
# Expected: 0 matches

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint

# Full suite passes
npm run test

# Build succeeds
npm run build
```

## Semantic Verification Checklist

### Behavioral Verification Questions

1. **Does the code DO what the requirement says?**
   - [ ] Read the requirement text (REQ-CS-006.1–006.4, REQ-CS-002.9, REQ-CS-005.5)
   - [ ] Read the implementation code in `geminiChat.ts`
   - [ ] Can explain HOW the dispatcher delegates, applies results, and handles errors

2. **Is this REAL implementation, not placeholder?**
   - [ ] Deferred implementation detection passed
   - [ ] No empty returns in implementation
   - [ ] No "will be implemented" comments

3. **Would the test FAIL if implementation was removed?**
   - [ ] Tests verify actual strategy delegation, history rebuild, and error propagation
   - [ ] Tests would catch a dispatcher that doesn't delegate or doesn't apply results

4. **Is the feature REACHABLE by users?**
   - [ ] `performCompression()` is called during normal chat when context exceeds threshold
   - [ ] Strategy selection is driven by `/set compression.strategy` setting
   - [ ] Code path is fully wired: setting → factory → strategy → result → history rebuild

### Integration Points Verified

- [ ] `buildCompressionContext()` assembles correct fields from runtime (verified by reading both files)
- [ ] `CompressionContext` does NOT include `historyService` (REQ-CS-001.6)
- [ ] Strategy `compress()` return value applied correctly (clear + add each entry)
- [ ] `PromptResolver` correctly threaded to `CompressionContext`
- [ ] `endCompression()` always called (even on error — finally block)
- [ ] Error handling works at component boundaries (strategy throw → propagate after unlock)

### Edge Cases Verified

- [ ] Empty/null input handled
- [ ] Invalid input rejected with clear error (unknown strategy → factory throws)
- [ ] Boundary values work correctly

## Success Criteria

- All tests pass (Phase 13 dispatcher tests + all existing tests + all compression module tests)
- `performCompression()` is a thin dispatcher (~30 lines)
- Six extracted methods are GONE from `geminiChat.ts`
- `getCompressionPrompt` import is GONE from `geminiChat.ts`
- `PromptResolver` access is wired in
- Full verification suite passes: test, lint, typecheck, format, build

## Failure Recovery

```bash
git checkout -- packages/core/src/core/geminiChat.ts packages/core/src/runtime/
```

## Phase Completion Marker

Create: `project-plans/issue170/.completed/P14.md`
Contents:
```
Phase: P14
Completed: [timestamp]
Files Created: [list]
Files Modified: [list]
Tests Added: [count]
Verification: [paste verification command outputs]
```
