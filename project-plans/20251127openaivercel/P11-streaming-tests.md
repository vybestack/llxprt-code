# Phase 11: Streaming Generation TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P11`

## Prerequisites

- Required: Phase 10 completed
- Verification: Non-streaming tests pass
- Expected files from previous phase: Updated `OpenAIVercelProvider.ts` with non-streaming generation
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for streaming chat completion generation. Streaming is the default mode for the provider.

## Requirements Implemented (Expanded)

### REQ-OAV-008: Streaming Support

**Full Text**: Must support streaming text generation responses
**Behavior**:
- GIVEN: A request with streaming enabled (default)
- WHEN: Calling generateChatCompletion
- THEN: Provider yields incremental IContent blocks as text arrives

**Test Cases**:
1. Streaming text chunks
2. Streaming tool calls
3. Multiple sequential chunks
4. Finish reason handling
5. Error during stream
6. Usage metadata at end of stream

## Pseudocode Reference

Tests verify behavior defined in `analysis/pseudocode/003-streaming-generation.md`:
- **generateStreaming**: Lines 001-042
- **streamTextChunks**: Lines 050-071
- **convertToolCalls**: Lines 080-110
- **createUsageContent**: Lines 120-144
- **Streaming lifecycle**: Lines 170-185

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P11
// @requirement:REQ-OAV-007
// @pseudocode:003-streaming-generation.md

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IMessage } from '../../../types';
import { streamText } from 'ai';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

function createMockStream(chunks: unknown[]) {
  return {
    textStream: (async function* () {
      for (const chunk of chunks) {
        yield chunk;
      }
    })(),
    toolCalls: Promise.resolve([]),
    usage: Promise.resolve({ promptTokens: 10, completionTokens: 20 }),
    finishReason: Promise.resolve('stop'),
  };
}

function createMockStreamWithToolCalls(toolCalls: unknown[]) {
  return {
    textStream: (async function* () {
      yield '';
    })(),
    toolCalls: Promise.resolve(toolCalls),
    usage: Promise.resolve({ promptTokens: 15, completionTokens: 25 }),
    finishReason: Promise.resolve('tool_calls'),
  };
}

describe('OpenAIVercelProvider Streaming Generation', () => {
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
    provider.setKey('sk-test-key');
    vi.resetAllMocks();
  });

  describe('generateChatCompletion (streaming)', () => {
    it('should stream text chunks', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStream(['Hello', ' world', '!'])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Say hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
      })) {
        results.push(content);
      }

      const textChunks = results.filter(r => r.type === 'text');
      expect(textChunks).toHaveLength(3);
      expect(textChunks.map(t => t.text)).toEqual(['Hello', ' world', '!']);
    });

    it('should default to streaming when not specified', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStream(['Response'])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      for await (const _ of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
      })) {
        // Consume iterator
      }

      expect(streamText).toHaveBeenCalled();
    });

    it('should stream tool calls', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStreamWithToolCalls([
          {
            toolCallId: 'call_xyz789',
            toolName: 'read_file',
            args: { path: '/test.txt' },
          },
        ])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Read test.txt' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
        tools: [{ name: 'read_file', description: 'Read file', parameters: {} }],
      })) {
        results.push(content);
      }

      expect(results).toContainEqual(
        expect.objectContaining({
          type: 'tool_use',
          id: 'hist_tool_xyz789',
          name: 'read_file',
          input: { path: '/test.txt' },
        })
      );
    });

    it('should include usage metadata at end of stream', async () => {
      vi.mocked(streamText).mockReturnValue({
        textStream: (async function* () {
          yield 'Done';
        })(),
        toolCalls: Promise.resolve([]),
        usage: Promise.resolve({ promptTokens: 50, completionTokens: 100 }),
        finishReason: Promise.resolve('stop'),
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
      })) {
        results.push(content);
      }

      expect(results).toContainEqual(
        expect.objectContaining({
          type: 'usage',
          inputTokens: 50,
          outputTokens: 100,
        })
      );
    });

    it('should handle empty stream gracefully', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStream([])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const results: unknown[] = [];
      for await (const content of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
      })) {
        results.push(content);
      }

      // Should still get usage metadata
      expect(results).toContainEqual(
        expect.objectContaining({ type: 'usage' })
      );
    });

    it('should propagate stream errors', async () => {
      vi.mocked(streamText).mockReturnValue({
        textStream: (async function* () {
          yield 'Start';
          throw new Error('Connection lost');
        })(),
        toolCalls: Promise.resolve([]),
        usage: Promise.resolve({ promptTokens: 5, completionTokens: 1 }),
        finishReason: Promise.resolve('error'),
      });

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      const iterator = provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
      });

      // First chunk should succeed
      const first = await iterator.next();
      expect(first.value).toMatchObject({ type: 'text', text: 'Start' });

      // Second should throw
      await expect(iterator.next()).rejects.toThrow('Connection lost');
    });

    it('should pass temperature parameter for streaming', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStream(['Response'])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      for await (const _ of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
        temperature: 0.5,
      })) {
        // Consume iterator
      }

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({ temperature: 0.5 })
      );
    });

    it('should pass maxTokens parameter for streaming', async () => {
      vi.mocked(streamText).mockReturnValue(
        createMockStream(['Short'])
      );

      const messages: IMessage[] = [
        { role: 'user', content: [{ type: 'text', text: 'Hello' }] },
      ];

      for await (const _ of provider.generateChatCompletion(messages, {
        model: 'gpt-4',
        streaming: true,
        maxTokens: 50,
      })) {
        // Consume iterator
      }

      expect(streamText).toHaveBeenCalledWith(
        expect.objectContaining({ maxTokens: 50 })
      );
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P11" packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-008" packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover text streaming
- [ ] Tests cover tool call streaming
- [ ] Tests cover usage metadata
- [ ] Tests cover error handling
- [ ] Tests cover parameter passing
- [ ] Tests FAIL (because streaming not implemented)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because generateStreaming isn't implemented
- All streaming scenarios are covered

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call streaming mode which throws "Streaming not yet implemented"
- [ ] Running tests produces FAILURE (throws error)
- [ ] Tests cover streaming text chunks
- [ ] Tests verify streaming is default mode
- [ ] Tests cover streaming tool calls
- [ ] Tests cover usage metadata at end of stream
- [ ] Tests cover empty stream handling
- [ ] Tests cover stream errors
- [ ] Tests cover parameter passing
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts 2>&1 | head -20
# Expected: "Streaming not yet implemented" or similar error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts`
2. Review Vercel AI SDK streamText API
3. Re-create test file with correct mocking

## Related Files

- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- Vercel AI SDK documentation for streamText

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P11.md`
Contents:

```markdown
Phase: P11
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/streamingGeneration.test.ts
Tests Added: [count]
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
