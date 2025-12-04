# Phase 07: reasoningUtils Tests (TDD)

## Phase ID

`PLAN-20251202-THINKING.P07`

## Prerequisites

- Required: Phase 06a completed
- Verification: `cat project-plans/20251202thinking/.completed/P06a.md`
- Expected: Stub functions exist and throw "Not implemented"

## Requirements Implemented (Expanded)

### REQ-THINK-002.1: extractThinkingBlocks

**Full Text**: extractThinkingBlocks MUST extract all ThinkingBlock instances from IContent
**Behavior**:

- GIVEN: IContent with mixed block types
- WHEN: extractThinkingBlocks(content) called
- THEN: Returns array of only ThinkingBlock instances

**Why This Matters**: Enables providers to work with thinking blocks without parsing

### REQ-THINK-002.2: filterThinkingForContext

**Full Text**: filterThinkingForContext MUST filter based on stripFromContext policy
**Behavior**:

- GIVEN: Array of IContent, some with ThinkingBlocks
- WHEN: filterThinkingForContext(contents, 'allButLast') called
- THEN: Only the last IContent retains its ThinkingBlocks

**Why This Matters**: Controls token usage by stripping old reasoning

### REQ-THINK-002.3: thinkingToReasoningField

**Full Text**: thinkingToReasoningField MUST convert ThinkingBlocks to single reasoning_content string
**Behavior**:

- GIVEN: Array of ThinkingBlocks
- WHEN: thinkingToReasoningField(blocks) called
- THEN: Returns concatenated string (or undefined if empty)

**Why This Matters**: Enables building OpenAI-compatible messages with reasoning

### REQ-THINK-002.4: estimateThinkingTokens

**Full Text**: estimateThinkingTokens MUST return token estimate for thinking content
**Behavior**:

- GIVEN: Array of ThinkingBlocks
- WHEN: estimateThinkingTokens(blocks) called
- THEN: Returns approximate token count

**Why This Matters**: Accurate context limit calculations

## Implementation Tasks

### Files to Create

#### `packages/core/src/providers/reasoning/reasoningUtils.test.ts`

```typescript
/**
 * @plan PLAN-20251202-THINKING.P07
 * @requirement REQ-THINK-002
 */
import { describe, it, expect } from 'vitest';
import {
  extractThinkingBlocks,
  filterThinkingForContext,
  thinkingToReasoningField,
  estimateThinkingTokens,
  removeThinkingFromContent,
  type StripPolicy,
} from './reasoningUtils';
import type { IContent, ThinkingBlock, TextBlock } from '../../services/history/IContent';

// Test fixtures
const createThinkingBlock = (thought: string, sourceField?: ThinkingBlock['sourceField']): ThinkingBlock => ({
  type: 'thinking',
  thought,
  sourceField,
});

const createTextBlock = (text: string): TextBlock => ({
  type: 'text',
  text,
});

const createAiContent = (blocks: (ThinkingBlock | TextBlock)[]): IContent => ({
  speaker: 'ai',
  blocks,
});

describe('reasoningUtils @plan:PLAN-20251202-THINKING.P07', () => {
  describe('extractThinkingBlocks @requirement:REQ-THINK-002.1', () => {
    it('extracts ThinkingBlocks from content with mixed blocks', () => {
      const content = createAiContent([
        createThinkingBlock('first thought'),
        createTextBlock('response text'),
        createThinkingBlock('second thought'),
      ]);

      const result = extractThinkingBlocks(content);

      expect(result).toHaveLength(2);
      expect(result[0].thought).toBe('first thought');
      expect(result[1].thought).toBe('second thought');
    });

    it('returns empty array when no ThinkingBlocks', () => {
      const content = createAiContent([createTextBlock('just text')]);

      const result = extractThinkingBlocks(content);

      expect(result).toEqual([]);
    });

    it('returns empty array for empty blocks', () => {
      const content = createAiContent([]);

      const result = extractThinkingBlocks(content);

      expect(result).toEqual([]);
    });

    it('preserves sourceField in extracted blocks', () => {
      const content = createAiContent([
        createThinkingBlock('thought', 'reasoning_content'),
      ]);

      const result = extractThinkingBlocks(content);

      expect(result[0].sourceField).toBe('reasoning_content');
    });
  });

  describe('filterThinkingForContext @requirement:REQ-THINK-002.2', () => {
    const contents: IContent[] = [
      createAiContent([createThinkingBlock('thought 1'), createTextBlock('text 1')]),
      createAiContent([createTextBlock('text 2')]),
      createAiContent([createThinkingBlock('thought 3'), createTextBlock('text 3')]),
    ];

    describe('policy: none', () => {
      it('returns contents unchanged', () => {
        const result = filterThinkingForContext(contents, 'none');

        expect(result).toEqual(contents);
      });
    });

    describe('policy: all', () => {
      it('removes all ThinkingBlocks from all contents', () => {
        const result = filterThinkingForContext(contents, 'all');

        result.forEach((content) => {
          const thinkingBlocks = content.blocks.filter((b) => b.type === 'thinking');
          expect(thinkingBlocks).toHaveLength(0);
        });
      });

      it('preserves non-thinking blocks', () => {
        const result = filterThinkingForContext(contents, 'all');

        const textBlocks = result.flatMap((c) => c.blocks.filter((b) => b.type === 'text'));
        expect(textBlocks).toHaveLength(3);
      });
    });

    describe('policy: allButLast', () => {
      it('removes ThinkingBlocks from all but last content with thinking', () => {
        const result = filterThinkingForContext(contents, 'allButLast');

        // First content should have thinking removed
        const first = result[0];
        expect(first.blocks.filter((b) => b.type === 'thinking')).toHaveLength(0);

        // Last content with thinking (index 2) should keep it
        const last = result[2];
        expect(last.blocks.filter((b) => b.type === 'thinking')).toHaveLength(1);
      });

      it('handles case where no content has thinking', () => {
        const noThinking = [createAiContent([createTextBlock('text')])];

        const result = filterThinkingForContext(noThinking, 'allButLast');

        expect(result).toEqual(noThinking);
      });

      // GAP 11 FIX: Edge case where last IContent has no thinking but earlier ones do
      it('removes all thinking when last content has no thinking blocks', () => {
        const contentsWithThinkingNotInLast: IContent[] = [
          createAiContent([createThinkingBlock('thought 1'), createTextBlock('text 1')]),
          createAiContent([createThinkingBlock('thought 2'), createTextBlock('text 2')]),
          createAiContent([createTextBlock('text 3')]), // Last one has NO thinking
        ];

        const result = filterThinkingForContext(contentsWithThinkingNotInLast, 'allButLast');

        // All thinking should be removed since last content has no thinking
        result.forEach((content, index) => {
          const thinkingBlocks = content.blocks.filter((b) => b.type === 'thinking');
          expect(thinkingBlocks).toHaveLength(0);
        });

        // But text should be preserved
        const textBlocks = result.flatMap((c) => c.blocks.filter((b) => b.type === 'text'));
        expect(textBlocks).toHaveLength(3);
      });

      it('preserves thinking in actual last content with thinking even if followed by non-thinking content', () => {
        const mixedContents: IContent[] = [
          createAiContent([createThinkingBlock('thought 1'), createTextBlock('text 1')]),
          createAiContent([createThinkingBlock('thought 2'), createTextBlock('text 2')]), // Last with thinking
          createAiContent([createTextBlock('text 3')]), // After last thinking
          createAiContent([createTextBlock('text 4')]), // More non-thinking
        ];

        const result = filterThinkingForContext(mixedContents, 'allButLast');

        // First content: thinking removed
        expect(result[0].blocks.filter((b) => b.type === 'thinking')).toHaveLength(0);

        // Second content (last with thinking): thinking preserved
        expect(result[1].blocks.filter((b) => b.type === 'thinking')).toHaveLength(1);
        expect((result[1].blocks.find((b) => b.type === 'thinking') as ThinkingBlock).thought).toBe('thought 2');

        // Third and fourth: no thinking (never had it)
        expect(result[2].blocks.filter((b) => b.type === 'thinking')).toHaveLength(0);
        expect(result[3].blocks.filter((b) => b.type === 'thinking')).toHaveLength(0);
      });
    });

    it('does not mutate input array', () => {
      const original = [createAiContent([createThinkingBlock('thought')])];
      const originalCopy = JSON.parse(JSON.stringify(original));

      filterThinkingForContext(original, 'all');

      expect(original).toEqual(originalCopy);
    });
  });

  describe('thinkingToReasoningField @requirement:REQ-THINK-002.3', () => {
    it('returns undefined for empty array', () => {
      const result = thinkingToReasoningField([]);

      expect(result).toBeUndefined();
    });

    it('returns single thought as-is', () => {
      const blocks = [createThinkingBlock('single thought')];

      const result = thinkingToReasoningField(blocks);

      expect(result).toBe('single thought');
    });

    it('concatenates multiple thoughts with newlines', () => {
      const blocks = [
        createThinkingBlock('first thought'),
        createThinkingBlock('second thought'),
      ];

      const result = thinkingToReasoningField(blocks);

      expect(result).toBe('first thought\nsecond thought');
    });
  });

  describe('estimateThinkingTokens @requirement:REQ-THINK-002.4', () => {
    it('returns 0 for empty array', () => {
      const result = estimateThinkingTokens([]);

      expect(result).toBe(0);
    });

    it('returns non-zero estimate for blocks with content', () => {
      const blocks = [createThinkingBlock('This is a test thought with some words')];

      const result = estimateThinkingTokens(blocks);

      expect(result).toBeGreaterThan(0);
    });

    it('returns higher estimate for more content', () => {
      const shortBlocks = [createThinkingBlock('short')];
      const longBlocks = [createThinkingBlock('this is a much longer thought with many more words')];

      const shortEstimate = estimateThinkingTokens(shortBlocks);
      const longEstimate = estimateThinkingTokens(longBlocks);

      expect(longEstimate).toBeGreaterThan(shortEstimate);
    });
  });

  describe('removeThinkingFromContent (helper)', () => {
    it('removes all thinking blocks from content', () => {
      const content = createAiContent([
        createThinkingBlock('thought'),
        createTextBlock('text'),
      ]);

      const result = removeThinkingFromContent(content);

      expect(result.blocks.filter((b) => b.type === 'thinking')).toHaveLength(0);
      expect(result.blocks.filter((b) => b.type === 'text')).toHaveLength(1);
    });

    it('preserves speaker and other metadata', () => {
      const content: IContent = {
        speaker: 'ai',
        blocks: [createThinkingBlock('thought')],
      };

      const result = removeThinkingFromContent(content);

      expect(result.speaker).toBe('ai');
    });

    it('does not mutate input', () => {
      const content = createAiContent([createThinkingBlock('thought')]);
      const originalBlockCount = content.blocks.length;

      removeThinkingFromContent(content);

      expect(content.blocks.length).toBe(originalBlockCount);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls packages/core/src/providers/reasoning/reasoningUtils.test.ts

# Check plan markers
grep -c "@plan.*THINKING.P07" packages/core/src/providers/reasoning/reasoningUtils.test.ts
# Expected: 1+

# Check requirement markers
grep -c "@requirement.*REQ-THINK-002" packages/core/src/providers/reasoning/reasoningUtils.test.ts
# Expected: 4+

# Run tests (they should FAIL since stubs throw)
npm test -- --run packages/core/src/providers/reasoning/reasoningUtils.test.ts
# Expected: Tests run but fail with "Not implemented"
```

### TDD Verification

Tests must:

- [ ] FAIL with "Not implemented" error (not import/syntax errors)
- [ ] Cover all 5 functions
- [ ] Have meaningful assertions
- [ ] Include edge cases

## Success Criteria

- All tests exist and are well-structured
- Tests fail with "Not implemented" (correct TDD state)
- Ready for implementation in P08

## Failure Recovery

If this phase fails:

1. `rm packages/core/src/providers/reasoning/reasoningUtils.test.ts`
2. Review stub signatures
3. Re-attempt

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P07.md`
