# Phase 8: Authentication Implementation (TDD GREEN)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P08`

## Prerequisites

- Required: Phase 7 completed
- Verification: `npm run test -- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts` fails with expected errors
- Expected files from previous phase: `authentication.test.ts`
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase implements the authentication functionality to make all tests from Phase 7 pass. This includes API key management, key file reading, base URL configuration, and OpenAI client creation using the Vercel AI SDK.

The provider supports all 4 standard authentication methods:
- `/key` command (interactive mode)
- `/keyfile` command (interactive mode)
- `--key` CLI argument
- `--keyfile` CLI argument

**Testing Note**: Automated tests use CLI arguments only (`--key`, `--keyfile`) because slash commands require interactive mode.

## Requirements Implemented (Expanded)

### REQ-OAV-002: Standard Authentication

**Implementation**:
- setKey method stores API key (called by `/key` command or `--key` CLI arg)
- setKeyFile method reads key from file (called by `/keyfile` command or `--keyfile` CLI arg)
- hasApiKey method checks if key is set
- validateConfiguration method ensures key is present

### REQ-OAV-003: BaseURL Configuration

**Implementation**:
- setBaseUrl method stores custom URL
- hasCustomBaseUrl method checks if URL is set
- getBaseUrl method returns configured URL
- URL is used in createOpenAIClient

## Implementation Code

### File: `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` (updated)

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P08
// @req:REQ-OAV-001
// @req:REQ-OAV-002
// @req:REQ-OAV-003
// @req:REQ-OAV-005
// @req:REQ-OAV-006

import type { IProvider, GenerationOptions, ModelInfo } from '../IProvider';
import type { IMessage, IContent } from '../../types';
import type { CoreMessage } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import * as fs from 'node:fs/promises';
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
    this.apiKey = key || undefined;
  }

  async setKeyFile(path: string): Promise<void> {
    const content = await fs.readFile(path, 'utf-8');
    const key = content.trim();
    
    if (!key) {
      throw new Error('Key file is empty');
    }
    
    this.apiKey = key;
  }

  setBaseUrl(url: string): void {
    // Normalize by removing trailing slash
    this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
  }

  hasApiKey(): boolean {
    return !!this.apiKey;
  }

  hasCustomBaseUrl(): boolean {
    return !!this.baseUrl;
  }

  getBaseUrl(): string | undefined {
    return this.baseUrl;
  }

  validateConfiguration(): void {
    if (!this.apiKey) {
      throw new Error('API key is required');
    }
  }

  createOpenAIClient() {
    this.validateConfiguration();
    
    return createOpenAI({
      apiKey: this.apiKey,
      ...(this.baseUrl && { baseURL: this.baseUrl }),
    });
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
grep -c "@plan:PLAN-20251127-OPENAIVERCEL.P08" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts

# Run authentication tests (expect PASS - TDD GREEN phase)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts

# Run all provider tests to ensure no regressions
npm run test -- packages/core/src/providers/openai-vercel/
```

### Deferred Implementation Detection

```bash
# Check for TODO/FIXME/HACK markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v ".test.ts"
# Expected: No matches
```

### Semantic Verification Checklist (5 Behavioral Questions)

Answer these 5 questions to verify the feature actually works:

1. **Does INPUT -> OUTPUT work as specified?**
   - [ ] `setKey('sk-abc')` then `hasApiKey()` returns `true`
   - [ ] `setBaseUrl('https://api.example.com/')` then `getBaseUrl()` returns `'https://api.example.com'` (normalized)

2. **Can I trigger this behavior manually?**
   - [ ] Write a script that sets a key and verifies createOpenAIClient doesn't throw
   - [ ] Verify setKeyFile reads from actual file (create temp file for test)

3. **What happens with edge cases?**
   - [ ] `setKey('')` then `hasApiKey()` returns `false`
   - [ ] `setKeyFile('/nonexistent')` throws with clear error
   - [ ] Empty key file throws 'Key file is empty'

4. **Does round-trip/integration work?**
   - [ ] After `setKey()`, `validateConfiguration()` passes
   - [ ] After `createOpenAIClient()`, returned client has correct config

5. **Is the feature observable in the system?**
   - [ ] All P07 tests PASS
   - [ ] Type checking passes
   - [ ] No regressions in previous tests

### Structural Verification Checklist

- [ ] setKey stores the API key
- [ ] setKeyFile reads from file and stores key
- [ ] setBaseUrl stores normalized URL
- [ ] All P07 tests PASS

## Success Criteria

- All authentication tests from P07 PASS
- API key can be set via setKey and setKeyFile
- Base URL can be configured
- OpenAI client is created correctly
- No regressions in previous tests

## Fraud Prevention Checklist (TDD GREEN Phase)

Before marking this phase complete, verify:

- [ ] Implementation is MINIMAL to pass tests (no extra features)
- [ ] All P07 tests now PASS (TDD Green)
- [ ] No implementation code was written BEFORE tests
- [ ] No logic that isn't covered by a test
- [ ] Type checking passes
- [ ] All previous tests still pass (no regressions)

### Anti-Pattern Detection

```bash
# Check for deferred implementation markers
grep -rn -E "(TODO|FIXME|HACK|STUB|XXX|TEMPORARY|TEMP|WIP)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts | grep -v "Not yet implemented"
# Expected: No matches

# Check for cop-out comments
grep -rn -E "(in a real|in production|ideally|for now|placeholder)" packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts
# Expected: No matches

# Verify all tests pass including previous phases
npm run test -- packages/core/src/providers/openai-vercel/
# Expected: All pass
```

## Failure Recovery

If this phase fails:
1. Review test error messages
2. Check Vercel AI SDK createOpenAI signature
3. Verify fs.readFile mocking
4. Update implementation to match test expectations

## Related Files

- `packages/core/src/providers/openai-vercel/__tests__/authentication.test.ts`
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts`
- Vercel AI SDK documentation for createOpenAI

## Phase State Tracking

**Phase State**: `NOT_STARTED` | `IN_PROGRESS` | `BLOCKED` | `COMPLETED`

**Current State**: `NOT_STARTED`

**State Transitions**:
- [ ] NOT_STARTED → IN_PROGRESS: When implementation begins
- [ ] IN_PROGRESS → BLOCKED: If unexpected test failures
- [ ] IN_PROGRESS → COMPLETED: When all P07 tests PASS (TDD Green)
- [ ] BLOCKED → IN_PROGRESS: After issues resolved

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P08.md`
Contents:

```markdown
Phase: P08
Completed: YYYY-MM-DD HH:MM
Files Modified:
- packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts [diff stats]
Tests Passing: [count from P07]
Test Run Output: [paste showing all P07 tests PASS]
Regression Check: [paste showing all previous tests still pass]
Fraud Prevention Checklist: [all items checked]
```
