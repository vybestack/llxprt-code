# Phase 08: reasoningUtils Implementation

## Phase ID

`PLAN-20251202-THINKING.P08`

## What This Phase Implements

### Concrete Implementation Goal

Implement 4 utility functions that manipulate ThinkingBlock instances within IContent arrays. These functions enable filtering, extracting, and converting reasoning content for API communication.

### Expected Code Structure

```typescript
// packages/core/src/providers/reasoning/reasoningUtils.ts

export type StripPolicy = 'all' | 'allButLast' | 'none';

// Function 1: Extract thinking blocks from a single IContent
export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  return content.blocks.filter(b => b.type === 'thinking') as ThinkingBlock[];
}

// Function 2: Filter thinking blocks from history based on policy
export function filterThinkingForContext(
  contents: IContent[],
  policy: StripPolicy
): IContent[] {
  // Returns modified IContent[] with thinking blocks removed per policy
}

// Function 3: Convert ThinkingBlocks to API reasoning_content field
export function thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined {
  // Joins thinking blocks into newline-separated string
}

// Function 4: Estimate token count for thinking content
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  // Returns estimated tokens (~4 chars per token)
}
```

### Integration Points

**Called by:**
- `OpenAIProvider.convertToOpenAIMessages()` - uses extractThinkingBlocks and thinkingToReasoningField when building messages
- `OpenAIProvider` (before message building) - uses filterThinkingForContext to apply strip policy
- Context limit calculation code - uses estimateThinkingTokens for accurate token counts

**Calls:**
- No external dependencies (pure utility functions)
- Operates on IContent and ThinkingBlock types from `../../services/history/IContent.js`

### Success Criteria

**What should happen when this code runs correctly:**
1. `extractThinkingBlocks` returns only thinking blocks from mixed block arrays
2. `filterThinkingForContext` with 'allButLast' removes thinking from all but the last entry that has thinking
3. `thinkingToReasoningField` produces a single string from multiple thinking blocks (newline-separated)
4. `estimateThinkingTokens` returns proportional estimates (longer thoughts = more tokens)
5. All P07 tests pass without modification

## Prerequisites

- Required: Phase 07a completed
- Verification: `cat project-plans/20251202thinking/.completed/P07a.md`
- Expected: Tests exist and fail with "Not implemented"

## Requirements Implemented (Expanded)

### REQ-THINK-002.1: extractThinkingBlocks
**Full Text**: extractThinkingBlocks MUST extract all ThinkingBlock instances from IContent
**Behavior**:
- GIVEN: IContent with mixed block types (thinking, text, tool_use)
- WHEN: extractThinkingBlocks(content) is called
- THEN: Returns array containing only ThinkingBlock instances, preserving order
**Why This Matters**: Enables providers to isolate reasoning content without manually filtering blocks

### REQ-THINK-002.2: filterThinkingForContext
**Full Text**: filterThinkingForContext MUST filter based on stripFromContext policy
**Behavior**:
- GIVEN: Array of IContent with ThinkingBlocks distributed across multiple entries
- WHEN: filterThinkingForContext(contents, 'allButLast') is called
- THEN: All ThinkingBlocks removed except those in the last IContent that contains thinking
**Why This Matters**: Token optimization - allows keeping recent reasoning while stripping old context

### REQ-THINK-002.3: thinkingToReasoningField
**Full Text**: thinkingToReasoningField MUST convert ThinkingBlocks to single reasoning_content string
**Behavior**:
- GIVEN: Array of ThinkingBlocks with multiple thoughts
- WHEN: thinkingToReasoningField(blocks) is called
- THEN: Returns single string with thoughts joined by newlines, or undefined if empty
**Why This Matters**: Enables serialization to OpenAI reasoning_content field for round-trip compatibility

### REQ-THINK-002.4: estimateThinkingTokens
**Full Text**: estimateThinkingTokens MUST return token estimate for thinking content
**Behavior**:
- GIVEN: Array of ThinkingBlocks with varying thought lengths
- WHEN: estimateThinkingTokens(blocks) is called
- THEN: Returns approximate token count using character-based estimation (~4 chars per token)
**Why This Matters**: Accurate context limit calculations when reasoning may/may not be sent to API

## Implementation Tasks

### Files to Modify

#### `packages/core/src/providers/reasoning/reasoningUtils.ts`

Replace stubs with real implementations following the pseudocode:

```typescript
/**
 * Utility functions for handling reasoning/thinking content across providers.
 *
 * @plan PLAN-20251202-THINKING.P06
 * @requirement REQ-THINK-002
 */

import type { IContent, ThinkingBlock, ContentBlock } from '../../services/history/IContent';

/** Policy for stripping thinking blocks from context */
export type StripPolicy = 'all' | 'allButLast' | 'none';

/**
 * Extract all ThinkingBlock instances from an IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.1
 * @pseudocode lines 10-18
 */
export function extractThinkingBlocks(content: IContent): ThinkingBlock[] {
  const result: ThinkingBlock[] = [];
  for (const block of content.blocks) {
    if (block.type === 'thinking') {
      result.push(block as ThinkingBlock);
    }
  }
  return result;
}

/**
 * Helper: Remove thinking blocks from a single IContent.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @pseudocode lines 60-65
 */
export function removeThinkingFromContent(content: IContent): IContent {
  return {
    ...content,
    blocks: content.blocks.filter((block) => block.type !== 'thinking'),
  };
}

/**
 * Filter thinking blocks from contents based on strip policy.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.2
 * @pseudocode lines 30-50
 */
export function filterThinkingForContext(
  contents: IContent[],
  policy: StripPolicy
): IContent[] {
  if (policy === 'none') {
    return contents;
  }

  if (policy === 'all') {
    return contents.map(removeThinkingFromContent);
  }

  // policy === 'allButLast'
  // Find the last content that has thinking blocks
  let lastWithThinkingIndex = -1;
  for (let i = contents.length - 1; i >= 0; i--) {
    if (contents[i].blocks.some((b) => b.type === 'thinking')) {
      lastWithThinkingIndex = i;
      break;
    }
  }

  if (lastWithThinkingIndex === -1) {
    // No content has thinking blocks
    return contents;
  }

  return contents.map((content, index) => {
    if (index === lastWithThinkingIndex) {
      return content; // Keep thinking in the last one
    }
    return removeThinkingFromContent(content);
  });
}

/**
 * Convert ThinkingBlocks to a single reasoning_content string.
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.3
 * @pseudocode lines 70-77
 */
export function thinkingToReasoningField(blocks: ThinkingBlock[]): string | undefined {
  if (blocks.length === 0) {
    return undefined;
  }
  return blocks.map((b) => b.thought).join('\n');
}

/**
 * Estimate token count for thinking blocks.
 * Uses simple character-based estimation (4 chars ≈ 1 token).
 *
 * @plan PLAN-20251202-THINKING.P08
 * @requirement REQ-THINK-002.4
 * @pseudocode lines 80-86
 */
export function estimateThinkingTokens(blocks: ThinkingBlock[]): number {
  let total = 0;
  for (const block of blocks) {
    // Simple estimation: ~4 characters per token
    total += Math.ceil(block.thought.length / 4);
  }
  return total;
}
```

## Verification Commands

### Automated Checks

```bash
# Run tests - they should NOW PASS
npm test -- --run packages/core/src/providers/reasoning/reasoningUtils.test.ts

# Check no stubs remain
grep "throw new Error.*Not implemented" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: No matches

# TypeScript compiles
npm run typecheck

# Lint passes
npm run lint -- packages/core/src/providers/reasoning/
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME
grep -E "(TODO|FIXME|STUB)" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: No matches

# Check for placeholder returns
grep -E "return \[\]|return \{\}|return null" packages/core/src/providers/reasoning/reasoningUtils.ts
# Expected: No matches in non-trivial functions
```

### Semantic Verification Checklist

- [ ] extractThinkingBlocks returns actual blocks, not empty array
- [ ] filterThinkingForContext respects all three policies
- [ ] filterThinkingForContext does not mutate input
- [ ] thinkingToReasoningField concatenates correctly
- [ ] estimateThinkingTokens returns proportional estimates

## Success Criteria

- All P07 tests pass
- No stubs remain
- TypeScript and lint pass
- Implementation matches pseudocode

## Failure Recovery

If tests fail:

1. Compare implementation to pseudocode
2. Check test expectations match spec
3. Fix implementation (not tests)

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P08.md`
