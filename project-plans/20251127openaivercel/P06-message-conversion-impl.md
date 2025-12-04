# Phase 6: Message Conversion Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P06`

## Prerequisites

- Required: Phase 5 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts` fails with expected errors
- Expected files from previous phase: `messageConversion.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the message conversion logic and tool ID normalization to make all tests from Phases 4, 4a, and 5 pass.

## Pseudocode Reference

Implementation follows these pseudocode files:
- **Tool ID Normalization**: `analysis/pseudocode/001-tool-id-normalization.md` (already implemented in P04a)
- **Message Conversion**: `analysis/pseudocode/002-message-conversion.md`
  - `convertToVercelMessages`: Lines 001-012
  - `convertSingleMessage`: Lines 020-041
  - `convertUserMessage`: Lines 060-080
  - `convertAssistantMessage`: Lines 090-118 (tool ID normalization at line 103)
  - `convertToolResponseMessage`: Lines 130-155 (tool ID normalization at line 137)
  - `convertSystemMessage`: Lines 160-163
  - `extractTextContent`: Lines 170-180

## Requirements Implemented (Expanded)

### REQ-OAV-005: Message Format Conversion

**Implementation**:
- Add convertToVercelMessages method to OpenAIVercelProvider
- Handle all message types: user, assistant, system, tool
- Apply tool ID normalization

### REQ-OAV-006: Tool Calling Support (Partial)

**Implementation**:
- Create utils.ts with normalizeToOpenAIToolId and normalizeToHistoryToolId
- Apply normalization in message conversion

## Pseudocode Reference

Implementation follows `analysis/pseudocode/001-tool-id-normalization.md` and `analysis/pseudocode/002-message-conversion.md`:
- **normalizeToOpenAIToolId**: Per pseudocode 001 lines 001-021
- **normalizeToHistoryToolId**: Per pseudocode 001 lines 030-050
- **convertToVercelMessages**: Per pseudocode 002 lines 001-012
- **convertUserMessage**: Per pseudocode 002 lines 060-080
- **convertAssistantMessage**: Per pseudocode 002 lines 090-118

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/utils.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P06
// @requirement:REQ-OAV-004
// @pseudocode:001-tool-id-normalization.md lines 001-050

/**
 * Normalizes a tool ID to OpenAI format (call_ prefix)
 * Handles IDs from various sources: hist_tool_, toolu_, or unknown formats
 */
export function normalizeToOpenAIToolId(id: string): string {
  if (id.startsWith('call_')) {
    return id;
  }
  if (id.startsWith('hist_tool_')) {
    return 'call_' + id.slice('hist_tool_'.length);
  }
  if (id.startsWith('toolu_')) {
    return 'call_' + id.slice('toolu_'.length);
  }
  return 'call_' + id;
}

/**
 * Normalizes a tool ID to history format (hist_tool_ prefix)
 * Handles IDs from OpenAI API responses
 */
export function normalizeToHistoryToolId(id: string): string {
  if (id.startsWith('hist_tool_')) {
    return id;
  }
  if (id.startsWith('call_')) {
    return 'hist_tool_' + id.slice('call_'.length);
  }
  if (id.startsWith('toolu_')) {
    return 'hist_tool_' + id.slice('toolu_'.length);
  }
  return 'hist_tool_' + id;
}
```

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P06
// @requirement:REQ-OAV-001
// @requirement:REQ-OAV-005
// @pseudocode:002-message-conversion.md lines 001-180

import type { IProvider, GenerationOptions, ModelInfo } from '../IProvider';
import type { IMessage, IContent } from '../../types';
import type { CoreMessage } from 'ai';
import { normalizeToOpenAIToolId } from './utils';

export class OpenAIVercelProvider implements IProvider {
  private apiKey: string | undefined;
  private baseUrl: string | undefined;

  getId(): string {
    return 'openaivercel';
  }

  getName(): string {
    return 'OpenAI (Vercel AI SDK)';
  }

  setKey(key: string): void {
    this.apiKey = key;
  }

  async setKeyFile(path: string): Promise<void> {
    // Will be implemented in authentication phase
    throw new Error('Not yet implemented');
  }

  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  convertToVercelMessages(messages: IMessage[]): CoreMessage[] {
    const result: CoreMessage[] = [];

    for (const message of messages) {
      const converted = this.convertMessage(message);
      if (converted) {
        result.push(converted);
      }
    }

    return result;
  }

  private convertMessage(message: IMessage): CoreMessage | undefined {
    const { role, content } = message;

    // Handle tool results specially - they come as 'user' role but should be 'tool'
    if (this.isToolResultMessage(content)) {
      return this.convertToolResultMessage(content);
    }

    switch (role) {
      case 'system':
        return {
          role: 'system',
          content: this.extractTextContent(content),
        };

      case 'user':
        return this.convertUserMessage(content);

      case 'assistant':
        return this.convertAssistantMessage(content);

      default:
        return undefined;
    }
  }

  private isToolResultMessage(content: IContent[]): boolean {
    return content.some(c => c.type === 'tool_result');
  }

  private convertToolResultMessage(content: IContent[]): CoreMessage {
    const toolResults = content
      .filter(c => c.type === 'tool_result')
      .map(c => ({
        type: 'tool-result' as const,
        toolCallId: normalizeToOpenAIToolId(c.tool_use_id),
        result: c.content,
        ...(c.is_error && { isError: true }),
      }));

    return {
      role: 'tool',
      content: toolResults,
    };
  }

  private convertUserMessage(content: IContent[]): CoreMessage {
    const hasImages = content.some(c => c.type === 'image');

    if (hasImages) {
      const parts = content.map(c => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text };
        }
        if (c.type === 'image') {
          return { type: 'image' as const, image: c.url };
        }
        return null;
      }).filter(Boolean);

      return {
        role: 'user',
        content: parts,
      };
    }

    return {
      role: 'user',
      content: this.extractTextContent(content),
    };
  }

  private convertAssistantMessage(content: IContent[]): CoreMessage {
    const hasToolCalls = content.some(c => c.type === 'tool_use');

    if (hasToolCalls) {
      const parts = content.map(c => {
        if (c.type === 'text') {
          return { type: 'text' as const, text: c.text };
        }
        if (c.type === 'tool_use') {
          return {
            type: 'tool-call' as const,
            toolCallId: normalizeToOpenAIToolId(c.id),
            toolName: c.name,
            args: c.input,
          };
        }
        return null;
      }).filter(Boolean);

      return {
        role: 'assistant',
        content: parts,
      };
    }

    return {
      role: 'assistant',
      content: this.extractTextContent(content),
    };
  }

  private extractTextContent(content: IContent[]): string {
    return content
      .filter(c => c.type === 'text')
      .map(c => c.text)
      .join('\n');
  }

  async *generateChatCompletion(
    messages: IMessage[],
    options: GenerationOptions
  ): AsyncIterable<IContent> {
    // Will be implemented in generation phases
    throw new Error('Not yet implemented');
  }

  async listModels(): Promise<ModelInfo[]> {
    // Will be implemented in model listing phase
    throw new Error('Not yet implemented');
  }
}
```

## Verification Commands

### Automated Checks

```bash
# Check plan markers exist
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P06" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts

# Run tool ID tests
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist

- [ ] convertToVercelMessages method exists
- [ ] All P05 tests pass
- [ ] Tool call IDs are normalized using normalizeToOpenAIToolId
- [ ] Tool response callIds are normalized
- [ ] utils.ts exports both normalization functions
- [ ] All P04 tests pass

## Success Criteria

- All message conversion tests from P05 PASS
- All tool ID normalization tests from P04 PASS
- No deferred implementation markers
- Type checking passes

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P04 tests now PASS (tool ID normalization)
- [ ] All P05 tests now PASS (message conversion)
- [ ] No implementation code was written BEFORE tests
- [ ] No logic that isn't covered by a test
- [ ] Type checking passes

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/utils.ts
# Expected: No matches

grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v "Not yet implemented"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/
# Expected: No matches

# Verify all tests pass
npm run test -- packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check CoreMessage type from Vercel AI SDK
3. Verify normalization logic
4. Update implementation to match expected output

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/messageConversion.test.ts`
- `packages/core/src/providers/openai-vercel/__tests__/toolIdNormalization.test.ts`
- `packages/core/src/providers/openai-vercel/utils.ts`

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P04 & P05 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P06.md`
Contents:

```markdown
Phase: P06
Completed: YYYY-MM-DD HH:MM
Files Created:
- packages/core/src/providers/openai-vercel/utils.ts
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
Tests Passing: [count from P04 + P05]
Test Run Output: [paste showing all P04 & P05 tests PASS]
Fraud Prevention Checklist: [all items checked]
```
