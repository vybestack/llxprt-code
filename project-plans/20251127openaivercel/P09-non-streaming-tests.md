# Phase 9: Non-Streaming Generation TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P09`

## Prerequisites

- Required: Phase 8 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts` passes
- Expected files from previous phase: Updated `OpenAIVercelProvider.ts` with authentication
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for non-streaming chat completion generation. This tests the core generation functionality with streaming disabled.

## Requirements Implemented (Expanded)

### REQ-OAV-007: Chat Completion Generation

**Full Text**: Must generate chat completions using Vercel AI SDK
**Behavior**:
- GIVEN: A configured provider with valid API key
- WHEN: generateChatCompletion is called with messages and streaming disabled
- THEN: Provider returns IContent blocks with the response

**Test Cases**:
1. Simple text generation
2. Generation with system prompt
3. Generation with temperature parameter
4. Generation with max tokens parameter
5. Generation with tool calls
6. Error handling for API errors
7. Usage metadata in response

## Pseudocode Reference

Tests verify behavior defined in `analysis/pseudocode/004-non-streaming-generation.md`:
- **generateNonStreaming**: Lines 001-048
- **createTextContent**: Lines 060-070
- **createToolCallsContent**: Lines 080-104 (includes tool ID normalization)
- **createUsageContent**: Lines 110-134

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P09
// @requirement:REQ-OAV-006
// @pseudocode:004-non-streaming-generation.md

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IMessage } from '../../../types';
import { generateText } from 'ai';

vi.mock('ai', () => ({
  generateText: vi.fn(),
}));

describe('OpenAIVercelProvider Non-Streaming Generation - Behavioral Tests', () => {
  /**
   * BEHAVIORAL TESTING APPROACH:
   * These tests verify INPUT -> OUTPUT transformations.
   * - INPUT: IMessage[] + GenerationOptions
   * - OUTPUT: AsyncIterable<IContent> (text, tool_use, usage blocks)
   * 
   * We mock the external API but verify our transformation logic is correct.
   */
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
    provider.setKey('sk-test-key');
    vi.resetAllMocks();
  });

  describe('Text Generation - INPUT -> OUTPUT', () => {
    // BEHAVIORAL: Given user message, when API returns text, yield text content block
    it('should transform API text response into IContent text block', async () => {
      // ARRANGE: API returns text response
      vi.mocked(generateText).mockResolvedValue({
        text: 'Hello! How can I help you?',
        usage: { promptTokens: 10, completionTokens: 8 },
        finishReason: 'stop',
      });

      // ACT: INPUT - user message
      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, { 
        model: 'gpt-4',
        streaming: false,
      })) {
        results.push(content);
      }

      // ASSERT: OUTPUT - contains text block with API response
      const textBlock = results.find((r: any) => r.type === 'text');
      expect(textBlock).toBeDefined();
      expect(textBlock).toMatchObject({
        type: 'text',
        text: 'Hello! How can I help you?',
      });
    });
  });

  describe('Tool Calls - INPUT -> OUTPUT with ID Normalization', () => {
    /**
     * Per pseudocode 004-non-streaming-generation.md lines 080-104:
     * Tool call IDs from API (call_*) MUST be normalized to history format (hist_tool_*)
     */
    
    // BEHAVIORAL: Given API tool call response, normalize ID to history format
    it('should normalize tool call ID from call_ to hist_tool_ format', async () => {
      // ARRANGE: API returns tool call with call_ prefix
      vi.mocked(generateText).mockResolvedValue({
        text: '',
        toolCalls: [
          {
            toolCallId: 'call_abc123',  // INPUT: OpenAI format
            toolName: 'search',
            args: { query: 'TypeScript' },
          },
        ],
        usage: { promptTokens: 15, completionTokens: 20 },
        finishReason: 'tool_calls',
      });

      // ACT
      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Search for TypeScript' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
        tools: [{ name: 'search', description: 'Search', parameters: {} }],
      })) {
        results.push(content);
      }

      // ASSERT: OUTPUT - tool_use block with hist_tool_ prefix
      const toolUseBlock = results.find((r: any) => r.type === 'tool_use');
      expect(toolUseBlock).toMatchObject({
        type: 'tool_use',
        id: 'hist_tool_abc123',  // OUTPUT: History format
        name: 'search',
        input: { query: 'TypeScript' },
      });
    });
  });

  describe('Usage Metadata - Per pseudocode lines 110-134', () => {
    // BEHAVIORAL: Always yield usage metadata for billing/analytics
    it('should yield usage metadata with token counts', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 100, completionTokens: 50 },
        finishReason: 'stop',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      })) {
        results.push(content);
      }

      // OUTPUT: Usage block with normalized field names
      const usageBlock = results.find((r: any) => r.type === 'usage');
      expect(usageBlock).toMatchObject({
        type: 'usage',
        inputTokens: 100,    // promptTokens -> inputTokens
        outputTokens: 50,    // completionTokens -> outputTokens
      });
    });
  });

  describe('Error Handling - Fail Fast Patterns', () => {
    // BEHAVIORAL: No API key -> throw before API call
    it('should throw immediately when API key is not configured', async () => {
      const providerNoKey = new OpenAIVercelProvider();
      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const iterator = providerNoKey.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      });

      // OUTPUT: Error thrown before any API call attempt
      await expect(iterator.next()).rejects.toThrow('API key is required');
    });

    // BEHAVIORAL: API error -> propagate with context
    it('should propagate API errors for caller handling', async () => {
      vi.mocked(generateText).mockRejectedValue(new Error('Rate limit exceeded'));

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const iterator = provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      });

      // OUTPUT: Original error message preserved for debugging
      await expect(iterator.next()).rejects.toThrow('Rate limit exceeded');
    });
  });

  describe('Parameter Passing - Options Flow Through', () => {
    // BEHAVIORAL: Generation options should affect API call
    it('should pass temperature to API for response variability control', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 5, completionTokens: 1 },
        finishReason: 'stop',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      // Consume the iterator to trigger the API call
      for await (const _ of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
        temperature: 0.7,
      })) {
        // Consume
      }

      // VERIFY: Temperature was passed to API
      const apiCall = vi.mocked(generateText).mock.calls[0][0];
      expect(apiCall.temperature).toBe(0.7);
    });

    // BEHAVIORAL: maxTokens should limit response length
    it('should pass maxTokens to API for response length control', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'Short',
        usage: { promptTokens: 5, completionTokens: 1 },
        finishReason: 'length',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      for await (const _ of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
        maxTokens: 100,
      })) {
        // Consume
      }

      // VERIFY: maxTokens was passed to API
      const apiCall = vi.mocked(generateText).mock.calls[0][0];
      expect(apiCall.maxTokens).toBe(100);
    });
  });

  describe('Property-Based Tests (30% coverage)', () => {
    // Property: Any text response yields text block
    test.prop([fc.string({ minLength: 1 })])('any API text response becomes text block', async (text) => {
      vi.mocked(generateText).mockResolvedValue({
        text,
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: 'stop',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      })) {
        results.push(content);
      }

      const textBlock = results.find((r: any) => r.type === 'text');
      expect(textBlock?.text).toBe(text);
    });

    // Property: Usage is ALWAYS yielded
    test.prop([
      fc.nat({ max: 10000 }),
      fc.nat({ max: 10000 })
    ])('usage metadata always yielded with any token counts', async (prompt, completion) => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: prompt, completionTokens: completion },
        finishReason: 'stop',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      })) {
        results.push(content);
      }

      const usage = results.find((r: any) => r.type === 'usage');
      expect(usage).toBeDefined();
      expect(usage.inputTokens).toBe(prompt);
      expect(usage.outputTokens).toBe(completion);
    });
    
    // Property: Tool call IDs always normalized to hist_tool_ format
    test.prop([fc.uuid()])('tool call ID normalization is deterministic', async (uuid) => {
      vi.mocked(generateText).mockResolvedValue({
        text: '',
        toolCalls: [{
          toolCallId: `call_${uuid}`,
          toolName: 'test_tool',
          args: {}
        }],
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: 'tool_calls',
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Test' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: false,
      })) {
        results.push(content);
      }

      const toolCall = results.find((r: any) => r.type === 'tool_use');
      expect(toolCall?.id).toBe(`hist_tool_${uuid}`);
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P09" packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-007" packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover simple text generation
- [ ] Tests cover system prompt handling
- [ ] Tests cover parameter passing
- [ ] Tests cover tool calls
- [ ] Tests cover usage metadata
- [ ] Tests cover error cases
- [ ] Tests FAIL (because non-streaming generation not implemented)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because generateChatCompletion with streaming=false isn't implemented
- All generation scenarios are covered
- Error handling is tested

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call generateChatCompletion which throws "Not yet implemented"
- [ ] Running tests produces FAILURE (throws error)
- [ ] Tests cover simple text generation
- [ ] Tests cover system prompt handling
- [ ] Tests cover parameter passing (temperature, maxTokens)
- [ ] Tests cover tool calls in response
- [ ] Tests cover usage metadata
- [ ] Tests cover error cases
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts 2>&1 | head -20
# Expected: "Not yet implemented" or similar error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts`
2. Review Vercel AI SDK generateText API
3. Re-create test file with correct mocking

## Related Files

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- Vercel AI SDK documentation for generateText
- `packages/core/src/providers/IProvider.ts` (GenerationOptions)

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P09.md`
Contents:

```markdown
Phase: P09
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/nonStreamingGeneration.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
