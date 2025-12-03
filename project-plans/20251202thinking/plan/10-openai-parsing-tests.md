# Phase 10: OpenAIProvider Parsing Tests (TDD)

## Phase ID

`PLAN-20251202-THINKING.P10`

## Prerequisites

- Required: Phase 09a completed
- Verification: `cat project-plans/20251202thinking/.completed/P09a.md`
- Expected: Stub methods exist and return null

## Requirements Implemented (Expanded)

### REQ-THINK-003.1: Streaming Handler

**Full Text**: Streaming handler MUST detect and parse reasoning_content delta
**Behavior**:

- GIVEN: Stream chunk with `delta.reasoning_content = "thinking..."`
- WHEN: Processing the chunk
- THEN: Yield IContent with ThinkingBlock

### REQ-THINK-003.2: Non-Streaming Handler

**Full Text**: Non-streaming handler MUST detect and parse reasoning_content field
**Behavior**:

- GIVEN: Message with `reasoning_content = "thinking..."`
- WHEN: Parsing the response
- THEN: Return ThinkingBlock in result

### REQ-THINK-003.3: sourceField Metadata

**Full Text**: Parser MUST emit ThinkingBlock with sourceField='reasoning_content'
**Behavior**:

- GIVEN: Parsed reasoning content
- WHEN: Creating ThinkingBlock
- THEN: Block has `sourceField: 'reasoning_content'`

### REQ-THINK-003.4: Graceful Absence

**Full Text**: Parser MUST NOT break when reasoning_content is absent
**Behavior**:

- GIVEN: API response WITHOUT reasoning_content
- WHEN: Parsing response
- THEN: No error, no ThinkingBlock, normal behavior

## Implementation Tasks

### Files to Create/Modify

#### `packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts`

```typescript
/**
 * Tests for OpenAI provider reasoning/thinking support.
 *
 * @plan PLAN-20251202-THINKING.P10
 * @requirement REQ-THINK-003
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from '../OpenAIProvider';
import type { IContent, ThinkingBlock } from '../../../services/history/IContent';

describe('OpenAIProvider reasoning parsing @plan:PLAN-20251202-THINKING.P10', () => {
  let provider: OpenAIProvider;

  beforeEach(() => {
    // Setup provider with mock configuration
    provider = new OpenAIProvider({
      apiKey: 'test-key',
      baseURL: 'https://api.example.com',
    });
  });

  describe('parseStreamingReasoningDelta @requirement:REQ-THINK-003.1', () => {
    it('returns IContent with ThinkingBlock when reasoning_content present', () => {
      const delta = {
        reasoning_content: 'Let me think about this...',
      };

      // Access private method for testing
      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect(result).not.toBeNull();
      expect(result.speaker).toBe('ai');
      expect(result.blocks).toHaveLength(1);
      expect(result.blocks[0].type).toBe('thinking');
      expect((result.blocks[0] as ThinkingBlock).thought).toBe('Let me think about this...');
    });

    it('returns null when reasoning_content is absent', () => {
      const delta = {
        content: 'Regular content',
      };

      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
    });

    it('returns null when reasoning_content is empty string', () => {
      const delta = {
        reasoning_content: '',
      };

      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
    });

    it('sets sourceField to reasoning_content @requirement:REQ-THINK-003.3', () => {
      const delta = {
        reasoning_content: 'Thinking...',
      };

      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect((result.blocks[0] as ThinkingBlock).sourceField).toBe('reasoning_content');
    });

    it('sets isHidden to false by default', () => {
      const delta = {
        reasoning_content: 'Thinking...',
      };

      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect((result.blocks[0] as ThinkingBlock).isHidden).toBe(false);
    });
  });

  describe('parseNonStreamingReasoning @requirement:REQ-THINK-003.2', () => {
    it('returns ThinkingBlock when reasoning_content present', () => {
      const message = {
        role: 'assistant' as const,
        content: 'Here is my answer',
        reasoning_content: 'I thought about multiple approaches...',
      };

      const result = (provider as any).parseNonStreamingReasoning(message);

      expect(result).not.toBeNull();
      expect(result.type).toBe('thinking');
      expect(result.thought).toBe('I thought about multiple approaches...');
    });

    it('returns null when reasoning_content is absent', () => {
      const message = {
        role: 'assistant' as const,
        content: 'Here is my answer',
      };

      const result = (provider as any).parseNonStreamingReasoning(message);

      expect(result).toBeNull();
    });

    it('returns null when reasoning_content is empty', () => {
      const message = {
        role: 'assistant' as const,
        content: 'Answer',
        reasoning_content: '',
      };

      const result = (provider as any).parseNonStreamingReasoning(message);

      expect(result).toBeNull();
    });

    it('sets sourceField to reasoning_content @requirement:REQ-THINK-003.3', () => {
      const message = {
        role: 'assistant' as const,
        content: 'Answer',
        reasoning_content: 'Thinking...',
      };

      const result = (provider as any).parseNonStreamingReasoning(message);

      expect(result.sourceField).toBe('reasoning_content');
    });
  });

  describe('graceful handling @requirement:REQ-THINK-003.4', () => {
    it('handles undefined delta gracefully', () => {
      const result = (provider as any).parseStreamingReasoningDelta(undefined);

      expect(result).toBeNull();
    });

    it('handles null message gracefully', () => {
      const result = (provider as any).parseNonStreamingReasoning(null);

      expect(result).toBeNull();
    });

    it('handles malformed reasoning_content gracefully', () => {
      const delta = {
        reasoning_content: null,
      };

      const result = (provider as any).parseStreamingReasoningDelta(delta);

      expect(result).toBeNull();
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Check test file exists
ls packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts

# Check plan markers
grep "@plan.*THINKING.P10" packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts

# Check requirement markers
grep -c "@requirement.*REQ-THINK-003" packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts
# Expected: 4+

# Run tests (should fail since stubs return null)
npm test -- --run packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts
```

### TDD Verification

Tests must:

- [ ] FAIL because stubs return null
- [ ] Not fail due to import/syntax errors
- [ ] Cover all REQ-THINK-003.x requirements
- [ ] Include edge cases (null, empty, undefined)

### Deferred Implementation Detection

**Purpose**: Ensure no stub/placeholder code remains after implementation

**Check**: Run tests and verify they FAIL with assertion errors (stubs return null), NOT with "Not implemented" errors

**Recovery**: If implementation already exists, this is good - tests should pass. If tests pass unexpectedly, verify stubs were properly created in P09.

### Semantic Verification Checklist (MANDATORY)

**Behavioral Verification Questions**:

1. **Do tests fail because stubs return null (expected TDD state)?**
   - Expected: Yes, tests fail with assertion errors like "expected object to not be null"

2. **Do tests cover streaming reasoning_content parsing?**
   - Expected: Yes, REQ-THINK-003.1 tests exist

3. **Do tests cover non-streaming reasoning_content parsing?**
   - Expected: Yes, REQ-THINK-003.2 tests exist

4. **Do tests verify sourceField='reasoning_content' is set?**
   - Expected: Yes, REQ-THINK-003.3 tests exist

5. **Do tests verify graceful handling when reasoning_content absent?**
   - Expected: Yes, REQ-THINK-003.4 tests exist with null/undefined cases

6. **Can I identify what needs to be implemented from reading the tests?**
   - Expected: Yes, tests clearly show expected behavior for P11 implementation

## Success Criteria

- All tests exist and are well-structured
- Tests fail with assertion errors (TDD state)
- Ready for implementation in P11

## Failure Recovery

If this phase fails:

1. `rm packages/core/src/providers/openai/__tests__/OpenAIProvider.reasoning.test.ts`
2. Review OpenAIProvider structure
3. Re-attempt

## Phase Completion Marker

Create: `project-plans/20251202thinking/.completed/P10.md`
