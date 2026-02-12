# Phase 12: HighDensityStrategy — Compress Stub

## Phase ID

`PLAN-20260211-HIGHDENSITY.P12`

## Prerequisites

- Required: Phase 11 completed
- Verification: `grep -r "@plan:PLAN-20260211-HIGHDENSITY.P11" packages/core/src/core/compression/HighDensityStrategy.ts | wc -l` → ≥ 3
- Expected files from previous phase:
  - `packages/core/src/core/compression/HighDensityStrategy.ts` (optimize fully implemented, compress still stubbed)
  - `packages/core/src/core/compression/__tests__/high-density-optimize.test.ts` (all passing)
- Preflight verification: Phase 01a completed

## Requirements Implemented (Expanded)

### REQ-HD-008.1: No LLM Call

**Full Text**: The `HighDensityStrategy.compress()` method shall not make any LLM calls.
**Behavior**:
- GIVEN: The HighDensityStrategy compress() method
- WHEN: It executes
- THEN: No LLM provider is invoked; compression is entirely deterministic
**Why This Matters**: The high-density strategy's value proposition is free, fast, deterministic compression. LLM calls would add cost, latency, and non-determinism.

### REQ-HD-008.2: Recent Tail Preservation

**Full Text**: The `compress()` method shall preserve the recent tail of history, determined by `preserveThreshold` from the runtime context.
**Behavior**:
- GIVEN: A history of 20 entries and preserveThreshold of 0.3
- WHEN: `compress()` runs
- THEN: The most recent 6 entries are preserved intact
**Why This Matters**: The model needs recent context to continue the conversation coherently.

### REQ-HD-008.3: Tool Response Summarization

**Full Text**: For tool responses outside the preserved tail, `compress()` shall replace the full response payload with a compact one-line summary containing: tool name, key parameters, and outcome.
**Behavior**:
- GIVEN: A tool response `{ toolName: 'read_file', result: '<200 lines of code>' }` outside the tail
- WHEN: `compress()` processes it
- THEN: Result becomes `'[read_file: 200 lines — success]'` (or similar compact summary)
**Why This Matters**: Tool responses are the largest token consumers. Summarizing them reclaims most of the space.

### REQ-HD-008.4: Non-Tool Content Preserved

**Full Text**: All tool call blocks, human messages, and AI text blocks shall be preserved intact by `compress()`.
**Behavior**:
- GIVEN: An AI entry with text blocks and tool_call blocks
- WHEN: `compress()` runs
- THEN: That AI entry appears unchanged in newHistory
**Why This Matters**: User messages and AI reasoning provide context that tool results don't.

### REQ-HD-008.5: CompressionResult Assembly

**Full Text**: Return a `CompressionResult` with `newHistory` and appropriate `metadata`.
**Behavior**:
- GIVEN: compress() completes
- WHEN: Result is returned
- THEN: `newHistory` is the modified array; `metadata` includes originalMessageCount, compressedMessageCount, strategyUsed='high-density', llmCallMade=false

### REQ-HD-008.6: Target Token Count

**Full Text**: Target post-compression token count of approximately `compressionThreshold × contextLimit × 0.6`, providing headroom before the next threshold trigger.
**Behavior**:
- GIVEN: threshold=0.85, contextLimit=128000
- WHEN: `compress()` calculates target
- THEN: targetTokens ≈ 65,280 (0.85 × 128000 × 0.6)
**Why This Matters**: The 0.6 multiplier provides headroom so compression doesn't re-trigger immediately.

## Implementation Tasks

### Files to Modify

- `packages/core/src/core/compression/HighDensityStrategy.ts`
  - UPDATE `compress()` stub to have proper method signature with intermediate sub-method stubs
  - ADD private method stubs: `summarizeToolResponseBlocks()`, `buildToolSummaryText()`, `truncateToTarget()`, `buildMetadata()`
  - UPDATE plan markers: `@plan:PLAN-20260211-HIGHDENSITY.P12`
  - ADD requirement markers: `@requirement:REQ-HD-008.1` through `REQ-HD-008.6`
  - ADD pseudocode references: `@pseudocode high-density-compress.md`

### Stub Outline

The compress() stub already throws NotYetImplemented from P09. In this phase, we refine it by adding the private helper method stubs that compress() will need:

```typescript
/**
 * @plan PLAN-20260211-HIGHDENSITY.P12
 * @requirement REQ-HD-008.1, REQ-HD-008.2, REQ-HD-008.3, REQ-HD-008.5
 * @pseudocode high-density-compress.md lines 10-91
 */
async compress(context: CompressionContext): Promise<CompressionResult> {
  throw new Error('NotYetImplemented: compress');
}

/**
 * @pseudocode high-density-compress.md lines 100-112
 */
private summarizeToolResponseBlocks(blocks: ContentBlock[]): ContentBlock[] {
  throw new Error('NotYetImplemented: summarizeToolResponseBlocks');
}

/**
 * @pseudocode high-density-compress.md lines 120-149
 */
private buildToolSummaryText(response: ToolResponseBlock): string {
  throw new Error('NotYetImplemented: buildToolSummaryText');
}

/**
 * @pseudocode high-density-compress.md lines 155-175
 */
private truncateToTarget(
  history: IContent[],
  tailStartIndex: number,
  targetTokens: number,
  context: CompressionContext,
): IContent[] {
  throw new Error('NotYetImplemented: truncateToTarget');
}

/**
 * @pseudocode high-density-compress.md lines 180-193
 */
private buildMetadata(
  originalCount: number,
  compressedCount: number,
  llmCallMade: boolean,
): CompressionResultMetadata {
  throw new Error('NotYetImplemented: buildMetadata');
}
```

### Stub Rules

- `compress()` — keeps its existing NotYetImplemented throw from P09
- `summarizeToolResponseBlocks()` — throws NotYetImplemented. Maps response blocks to summaries.
- `buildToolSummaryText()` — throws NotYetImplemented. Builds a one-line summary string.
- `truncateToTarget()` — throws NotYetImplemented. Aggressive fallback trimming.
- `buildMetadata()` — throws NotYetImplemented. Builds CompressionResultMetadata.
- All methods get `@pseudocode` references to high-density-compress.md
- NO implementation logic — just method signatures and throws
- optimize() and its sub-methods MUST remain fully functional (no regression)

### Import Requirements (additions for compress)

```typescript
// May need (verify against existing imports):
import type { CompressionResultMetadata } from './types.js';
// ContentBlock may be needed for summarizeToolResponseBlocks signature
```

## Verification Commands

```bash
# 1. TypeScript compiles cleanly
cd packages/core && npx tsc --noEmit
# Expected: 0 errors

# 2. New method stubs exist
grep -c "summarizeToolResponseBlocks\|buildToolSummaryText\|truncateToTarget\|buildMetadata" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 4

# 3. Plan markers updated to P12
grep -c "@plan.*HIGHDENSITY.P12" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 1

# 4. Requirement markers for REQ-HD-008
grep -c "@requirement.*REQ-HD-008" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 1

# 5. Pseudocode references for compress
grep -c "@pseudocode.*high-density-compress" packages/core/src/core/compression/HighDensityStrategy.ts
# Expected: ≥ 4

# 6. compress still throws NotYetImplemented
grep -A3 "async compress" packages/core/src/core/compression/HighDensityStrategy.ts | grep "NotYetImplemented"
# Expected: 1 match

# 7. optimize tests still pass (no regression)
npm run test -- --run packages/core/src/core/compression/__tests__/high-density-optimize.test.ts
# Expected: All pass

# 8. Full test suite passes
npm run test -- --run 2>&1 | tail -10
# Expected: All pass
```

## Success Criteria

- `npx tsc --noEmit` passes with 0 errors
- All 4 new private method stubs exist and throw NotYetImplemented
- compress() still throws NotYetImplemented
- Plan markers include P12 references
- REQ-HD-008 requirement markers present
- Pseudocode references to high-density-compress.md present
- ALL optimize tests still pass (no regression from adding stubs)
- Full test suite passes

## Failure Recovery

If this phase fails:
1. `git checkout -- packages/core/src/core/compression/HighDensityStrategy.ts`
2. P11 implementation restored
3. Cannot proceed to Phase 13 until fixed

## Phase Completion Marker

Create: `project-plans/issue236hdcompression/.completed/P12.md`
Contents:
```markdown
Phase: P12
Completed: [timestamp]
Files Modified:
  - packages/core/src/core/compression/HighDensityStrategy.ts [+N lines]
Tests Added: 0 (stub phase)
Verification: [paste verification output]
```
