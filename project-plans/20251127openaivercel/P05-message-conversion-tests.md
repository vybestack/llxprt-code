# Phase 5: Message Conversion TDD Tests

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P05`

## Prerequisites

- Required: Phase 4 completed
- Verification: Tool ID normalization tests exist
- Expected files from previous phase: `toolIdNormalization.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing tests for message conversion between our internal IMessage format and the Vercel AI SDK's expected format. This is critical for proper communication with the OpenAI API.

## Requirements Implemented (Expanded)

### REQ-OAV-005: Message Format Conversion

**Full Text**: Must convert internal IMessage format to Vercel AI SDK format
**Behavior**:
- GIVEN: Messages in IMessage format from our history system
- WHEN: Preparing for API call via Vercel AI SDK
- THEN: Messages are converted to CoreMessage[] format with proper structure

**Test Cases**:
1. User text messages
2. User messages with images
3. Assistant text messages
4. Assistant messages with tool calls
5. Tool result messages
6. System messages
7. Mixed conversation flows

## Pseudocode Reference

Tests verify behavior defined in `analysis/pseudocode/002-message-conversion.md`:
- **convertToVercelMessages**: Lines 001-012
- **convertUserMessage**: Lines 060-080
- **convertAssistantMessage**: Lines 090-118
- **convertToolResponseMessage**: Lines 130-155
- **Type mappings**: Lines 190-200

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P05
// @requirement:REQ-OAV-005
// @pseudocode:002-message-conversion.md

import { describe, it, expect, beforeEach } from 'vitest';
import { fc, test } from '@fast-check/vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IMessage } from '../../../types';

describe('OpenAIVercelProvider Message Conversion', () => {
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider();
    provider.setKey('test-api-key');
  });

  describe('convertToVercelMessages', () => {
    describe('User Messages', () => {
      it('should convert simple user text message', () => {
        const messages: IMessage[] = [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          role: 'user',
          content: 'Hello',
        });
      });

      it('should convert user message with image', () => {
        const messages: IMessage[] = [
          {
            role: 'user',
            content: [
              { type: 'text', text: 'What is in this image?' },
              { type: 'image', url: 'data:image/png;base64,abc123' },
            ],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('user');
        expect(result[0].content).toEqual([
          { type: 'text', text: 'What is in this image?' },
          { type: 'image', image: 'data:image/png;base64,abc123' },
        ]);
      });
    });

    describe('Assistant Messages', () => {
      it('should convert assistant text message', () => {
        const messages: IMessage[] = [
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Hello! How can I help?' }],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          role: 'assistant',
          content: 'Hello! How can I help?',
        });
      });

      it('should convert assistant message with tool call', () => {
        const messages: IMessage[] = [
          {
            role: 'assistant',
            content: [
              { type: 'text', text: 'Let me search for that.' },
              {
                type: 'tool_use',
                id: 'hist_tool_abc123',
                name: 'search',
                input: { query: 'test' },
              },
            ],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0].role).toBe('assistant');
        expect(result[0].content).toContainEqual({
          type: 'text',
          text: 'Let me search for that.',
        });
        expect(result[0].content).toContainEqual({
          type: 'tool-call',
          toolCallId: 'call_abc123', // Normalized ID
          toolName: 'search',
          args: { query: 'test' },
        });
      });
    });

    describe('Tool Result Messages', () => {
      it('should convert tool result message', () => {
        const messages: IMessage[] = [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'hist_tool_abc123',
                content: 'Search results: ...',
              },
            ],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          role: 'tool',
          content: [
            {
              type: 'tool-result',
              toolCallId: 'call_abc123', // Normalized ID
              result: 'Search results: ...',
            },
          ],
        });
      });

      it('should convert tool result with error', () => {
        const messages: IMessage[] = [
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'hist_tool_xyz789',
                content: 'Error: File not found',
                is_error: true,
              },
            ],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0].content[0]).toMatchObject({
          type: 'tool-result',
          toolCallId: 'call_xyz789',
          result: 'Error: File not found',
          isError: true,
        });
      });
    });

    describe('System Messages', () => {
      it('should convert system message', () => {
        const messages: IMessage[] = [
          {
            role: 'system',
            content: [{ type: 'text', text: 'You are a helpful assistant.' }],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
          role: 'system',
          content: 'You are a helpful assistant.',
        });
      });
    });

    describe('Mixed Conversations', () => {
      // Per pseudocode lines 001-012: Full conversion flow
      it('should convert full conversation with tool usage', () => {
        const messages: IMessage[] = [
          {
            role: 'system',
            content: [{ type: 'text', text: 'You are helpful.' }],
          },
          {
            role: 'user',
            content: [{ type: 'text', text: 'Search for TypeScript' }],
          },
          {
            role: 'assistant',
            content: [
              {
                type: 'tool_use',
                id: 'hist_tool_search1',
                name: 'search',
                input: { query: 'TypeScript' },
              },
            ],
          },
          {
            role: 'user',
            content: [
              {
                type: 'tool_result',
                tool_use_id: 'hist_tool_search1',
                content: 'Found: TypeScript is a language...',
              },
            ],
          },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'TypeScript is a language...' }],
          },
        ];

        const result = provider.convertToVercelMessages(messages);
        
        expect(result).toHaveLength(5);
        expect(result[0].role).toBe('system');
        expect(result[1].role).toBe('user');
        expect(result[2].role).toBe('assistant');
        expect(result[3].role).toBe('tool');
        expect(result[4].role).toBe('assistant');
      });
    });
    
    describe('Property-based tests', () => {
      // Property: Every converted message has a valid role
      test.prop([
        fc.array(fc.record({
          role: fc.constantFrom('user', 'assistant', 'system'),
          content: fc.array(fc.record({
            type: fc.constant('text'),
            text: fc.string()
          }))
        }), { minLength: 1, maxLength: 5 })
      ])('all converted messages have valid Vercel roles', (messages) => {
        const result = provider.convertToVercelMessages(messages);
        const validRoles = ['user', 'assistant', 'system', 'tool'];
        result.forEach(msg => {
          expect(validRoles).toContain(msg.role);
        });
      });
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test file exists
ls -la packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P05" packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts

# Check for requirement markers
grep "@req:REQ-OAV-005" packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts

# Run tests (expect FAIL - TDD RED phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
```

### Structural Verification Checklist

- [ ] Test file created
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests cover all message types
- [ ] Tests cover tool ID normalization
- [ ] Tests FAIL (because convertToVercelMessages doesn't exist yet)

## Success Criteria

- Tests exist and are properly structured
- Tests FAIL because convertToVercelMessages method doesn't exist
- All message types are covered
- Tool ID normalization is tested

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE implementation (TDD Red)
- [ ] Tests call `provider.convertToVercelMessages` which DOESN'T EXIST YET
- [ ] Running tests produces FAILURE (method not found)
- [ ] Tests cover ALL message types: user, assistant, system, tool
- [ ] Tests verify tool ID normalization in converted messages
- [ ] Tests verify image message handling
- [ ] Tests cover mixed conversation flows
- [ ] No "always pass" tests

### Anti-Pattern Detection

```bash
# Check for stub tests that always pass
grep -n "expect(true)" packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
# Expected: No matches

# Check for tests without assertions
grep -c "expect(" packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
# Expected: Multiple matches (at least one per test)

# Verify tests fail as expected
npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts 2>&1 | head -20
# Expected: Method not found or similar error
```

## Failure Recovery

If this phase fails:
1. `rm packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts`
2. Review IMessage type definitions
3. Review Vercel AI SDK CoreMessage type
4. Re-create test file with correct types

## Related Files

- `packages/core/src/types.ts` (IMessage definition)
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- Vercel AI SDK documentation for CoreMessage

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When test file creation begins
- [ ] IN_PROGRESS → BLOCKED: If test infrastructure issues found
- [ ] IN_PROGRESS → COMPLETED: When tests exist and FAIL correctly (TDD Red)
- [ ] BLOCKED → IN_PROGRESS: After infrastructure issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P05.md`
Contents:

```markdown
Phase: P05
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
Tests Added: [count]
Message Types Covered: user, assistant, system, tool, images
Test Run Output: [paste showing tests FAIL as expected]
Fraud Prevention Checklist: [all items checked]
```
