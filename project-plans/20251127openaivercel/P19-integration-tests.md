# Phase 19: End-to-End Integration Tests (TDD RED)

## Phase ID

`PLAN-20251127-OPENAIVERCEL.P19`

## Prerequisites

- Required: Phase 18 completed
- Verification: Provider is registered and activatable
- Expected files from previous phase: Updated ProviderManager with openaivercel support
- Preflight verification: Phase 0.5 MUST be completed before any implementation phase

## Overview

This phase creates failing end-to-end integration tests that verify the complete user workflow works. These tests verify that a user can actually use the provider through the CLI.

## Requirements Implemented (Expanded)

### REQ-INT-001.2: CLI Argument Compatibility

**Full Text**: Provider MUST work with CLI command-line arguments
**Behavior**:
- GIVEN: User is starting the CLI
- WHEN: User starts with `--provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1"` arguments
- THEN: Provider is configured correctly with the specified settings
**Why This Matters**: Users interact via CLI command-line arguments

**CLI Testing Format**:
```bash
node scripts/start.js --provider openaivercel --keyfile ~/.synthetic_key --model "hf:zai-org/GLM-4.6" --base-url "https://api.synthetic.new/openai/v1" --prompt "write me a haiku"
```

**IMPORTANT**: All testing must use command-line arguments (`--key`, `--keyfile`), NOT interactive slash commands (`/key`, `/keyfile`). Slash commands only work in interactive mode and agents cannot test them.

**Feature Support Note**: The provider supports all 4 authentication methods (`/key`, `/keyfile`, `--key`, `--keyfile`), but automated tests can only verify CLI arguments.

### REQ-INT-001.3: HistoryService Interoperability

**Full Text**: Provider MUST interoperate with HistoryService
**Behavior**:
- GIVEN: Conversation history exists with IContent
- WHEN: generateChatCompletion receives history
- THEN: Messages are converted correctly, tool IDs preserved
**Why This Matters**: Conversation continuity across turns

### REQ-INT-001.4: ToolScheduler Compatibility

**Full Text**: Provider MUST work with ToolScheduler
**Behavior**:
- GIVEN: Provider yields tool_call block
- WHEN: Tool is executed and result returned
- THEN: Tool result callId matches original tool_call id
**Why This Matters**: Tool execution loop must complete correctly

## Test Code

### File: `packages/core/src/providers/openai-vercel/__tests__/integration.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P19
// @requirement:REQ-INT-001.2
// @requirement:REQ-INT-001.3
// @requirement:REQ-INT-001.4

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OpenAIVercelProvider } from '../OpenAIVercelProvider';
import type { IContent, TextBlock, ToolCallBlock, ToolResponseBlock } from '../../../services/history/IContent';
import type { ITool } from '../../ITool';
import { streamText, generateText } from 'ai';

vi.mock('ai', () => ({
  streamText: vi.fn(),
  generateText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn()),
}));

describe('OpenAIVercelProvider End-to-End Integration', () => {
  let provider: OpenAIVercelProvider;

  beforeEach(() => {
    provider = new OpenAIVercelProvider('sk-test-key');
    vi.resetAllMocks();
  });

  describe('HistoryService Interoperability', () => {
    it('should convert conversation history with multiple turns', async () => {
      // Setup: Multi-turn conversation with tool usage
      const history: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Read config.json' } as TextBlock]
        },
        {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'I will read that file.' } as TextBlock,
            {
              type: 'tool_call',
              id: 'hist_tool_read123',
              name: 'read_file',
              parameters: { path: 'config.json' }
            } as ToolCallBlock
          ]
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_read123',
              toolName: 'read_file',
              result: '{"key": "value"}',
              status: 'success'
            } as ToolResponseBlock
          ]
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'The config contains key: value' } as TextBlock]
        }
      ];

      vi.mocked(generateText).mockResolvedValue({
        text: 'Response based on history',
        usage: { promptTokens: 100, completionTokens: 20 },
        finishReason: 'stop',
      });

      // Execute: Generate with history
      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion(history, {
        model: 'gpt-4o',
        streaming: false,
      })) {
        results.push(content);
      }

      // Verify: generateText was called with converted messages
      expect(generateText).toHaveBeenCalled();
      const callArgs = vi.mocked(generateText).mock.calls[0][0];
      
      // Verify tool IDs were normalized
      const messages = callArgs.messages;
      const assistantWithToolCall = messages.find(
        m => m.role === 'assistant' && m.content?.some?.(c => c.type === 'tool-call')
      );
      expect(assistantWithToolCall).toBeDefined();
      
      const toolCall = assistantWithToolCall.content.find(c => c.type === 'tool-call');
      expect(toolCall.toolCallId).toBe('call_read123'); // Normalized to OpenAI format
    });

    it('should preserve tool ID round-trip through tool execution', async () => {
      // Setup: AI returns tool call
      vi.mocked(streamText).mockReturnValue({
        textStream: (async function* () {
          yield '';
        })(),
        toolCalls: Promise.resolve([{
          toolCallId: 'call_exec456',
          toolName: 'execute_command',
          args: { command: 'ls' }
        }]),
        usage: Promise.resolve({ promptTokens: 10, completionTokens: 5 }),
        finishReason: Promise.resolve('tool_calls'),
      });

      // Execute: Get tool call from provider
      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion([
        { speaker: 'human', blocks: [{ type: 'text', text: 'List files' }] }
      ], { model: 'gpt-4o' })) {
        results.push(content);
      }

      // Verify: Tool call has history-format ID
      const toolCallContent = results.find(
        r => r.blocks?.some?.(b => b.type === 'tool_call')
      );
      expect(toolCallContent).toBeDefined();
      
      const toolCallBlock = toolCallContent.blocks.find(b => b.type === 'tool_call') as ToolCallBlock;
      expect(toolCallBlock.id).toBe('hist_tool_exec456'); // Normalized to history format
      
      // Now simulate tool result coming back
      const toolResultHistory: IContent[] = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'List files' }] },
        toolCallContent, // The AI's tool call
        {
          speaker: 'tool',
          blocks: [{
            type: 'tool_response',
            callId: 'hist_tool_exec456', // Same ID
            toolName: 'execute_command',
            result: 'file1.txt\nfile2.txt',
            status: 'success'
          }]
        }
      ];

      vi.mocked(generateText).mockResolvedValue({
        text: 'You have file1.txt and file2.txt',
        usage: { promptTokens: 50, completionTokens: 10 },
        finishReason: 'stop',
      });

      // Execute with tool result
      for await (const content of provider.generateChatCompletion(toolResultHistory, {
        model: 'gpt-4o',
        streaming: false,
      })) {
        results.push(content);
      }

      // Verify: Tool result ID was normalized in API call
      const apiCall = vi.mocked(generateText).mock.calls[0][0];
      const toolResultMsg = apiCall.messages.find(m => m.role === 'tool');
      expect(toolResultMsg).toBeDefined();
      expect(toolResultMsg.content[0].toolCallId).toBe('call_exec456'); // Back to OpenAI format
    });
  });

  describe('Tool Definition Handling', () => {
    it('should pass tool definitions to API', async () => {
      const tools: ITool[] = [
        {
          name: 'read_file',
          description: 'Read a file',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' }
            },
            required: ['path']
          }
        }
      ];

      vi.mocked(generateText).mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 10, completionTokens: 5 },
        finishReason: 'stop',
      });

      for await (const _ of provider.generateChatCompletion([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Read test.txt' }] }
      ], { model: 'gpt-4o', streaming: false, tools })) {
        // Consume
      }

      expect(generateText).toHaveBeenCalledWith(
        expect.objectContaining({
          tools: expect.objectContaining({
            read_file: expect.objectContaining({
              description: 'Read a file'
            })
          })
        })
      );
    });
  });

  describe('Error Propagation', () => {
    it('should propagate API errors with provider context', async () => {
      const apiError = new Error('Invalid model');
      (apiError as any).status = 404;
      
      vi.mocked(generateText).mockRejectedValue(apiError);

      const iterator = provider.generateChatCompletion([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }
      ], { model: 'invalid-model', streaming: false });

      try {
        await iterator.next();
        fail('Should have thrown');
      } catch (error) {
        expect(error.provider).toBe('openaivercel');
        expect(error.message).toContain('Invalid model');
      }
    });
  });

  describe('Usage Tracking', () => {
    it('should yield usage metadata for analytics', async () => {
      vi.mocked(generateText).mockResolvedValue({
        text: 'Response',
        usage: { promptTokens: 150, completionTokens: 75 },
        finishReason: 'stop',
      });

      const results: IContent[] = [];
      for await (const content of provider.generateChatCompletion([
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] }
      ], { model: 'gpt-4o', streaming: false })) {
        results.push(content);
      }

      const usageContent = results.find(r => r.metadata?.usage);
      expect(usageContent).toBeDefined();
      expect(usageContent.metadata.usage.inputTokens).toBe(150);
      expect(usageContent.metadata.usage.outputTokens).toBe(75);
    });
  });
});
```

### File: `packages/cli/src/providers/__tests__/openaivercel.integration.test.ts`

```typescript
// @plan:PLAN-20251127-OPENAIVERCEL.P19
// @requirement:REQ-INT-001.2

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { keyCommand } from '../../ui/commands/keyCommand.js';
import { keyfileCommand } from '../../ui/commands/keyfileCommand.js';
import { baseurlCommand } from '../../ui/commands/baseurlCommand.js';
import { modelCommand } from '../../ui/commands/modelCommand.js';
import type { CommandContext } from '../../ui/commands/types.js';
import { getRuntimeApi } from '../../ui/contexts/RuntimeContext.js';

// Mock dependencies
vi.mock('../../ui/contexts/RuntimeContext.js', () => ({
  getRuntimeApi: vi.fn(),
}));

describe('CLI Commands with OpenAIVercelProvider', () => {
  let runtimeApi: {
    updateActiveProviderApiKey: ReturnType<typeof vi.fn>;
    updateActiveProviderKeyFile: ReturnType<typeof vi.fn>;
    updateActiveProviderBaseUrl: ReturnType<typeof vi.fn>;
    setActiveModel: ReturnType<typeof vi.fn>;
    getActiveProviderStatus: ReturnType<typeof vi.fn>;
  };

  let mockContext: CommandContext;

  beforeEach(async () => {
    runtimeApi = {
      updateActiveProviderApiKey: vi.fn().mockResolvedValue({ message: 'ok' }),
      updateActiveProviderKeyFile: vi.fn().mockResolvedValue({ message: 'ok' }),
      updateActiveProviderBaseUrl: vi
        .fn()
        .mockResolvedValue({ message: 'ok' }),
      setActiveModel: vi.fn().mockResolvedValue({
        previousModel: 'gpt-4o',
        nextModel: 'gpt-4o-mini',
        providerName: 'openaivercel',
      }),
      getActiveProviderStatus: vi.fn().mockReturnValue({
        providerName: 'openaivercel',
      }),
    };

    vi.mocked(getRuntimeApi).mockReturnValue(runtimeApi as never);

    mockContext = {} as CommandContext;
  });

  describe('/key command', () => {
    it('should set API key on openaivercel provider', async () => {
      await keyCommand.action?.(mockContext, 'sk-test-key-123');

      expect(runtimeApi.updateActiveProviderApiKey).toHaveBeenCalledWith(
        'sk-test-key-123',
      );
    });
  });

  describe('/keyfile command', () => {
    it('should read key file for openaivercel provider', async () => {
      await keyfileCommand.action?.(mockContext, '~/.openai/key');

      expect(runtimeApi.updateActiveProviderKeyFile).toHaveBeenCalledWith(
        '~/.openai/key',
      );
    });
  });

  describe('/baseurl command', () => {
    it('should set base URL on openaivercel provider', async () => {
      await baseurlCommand.action?.(mockContext, 'https://custom.api.com/v1');

      expect(
        runtimeApi.updateActiveProviderBaseUrl,
      ).toHaveBeenCalledWith('https://custom.api.com/v1');
    });
  });

  describe('/models command', () => {
    it('should switch models via runtime API', async () => {
      await modelCommand.action?.(mockContext, 'gpt-4o-mini');

      expect(runtimeApi.setActiveModel).toHaveBeenCalledWith('gpt-4o-mini');
    });
  });
});
```

## Verification Commands

### Automated Checks

```bash
# Verify test files exist
ls -la packages/core/src/providers/openai-vercel/__tests__/integration.test.ts
ls -la packages/cli/src/providers/__tests__/openaivercel.integration.test.ts

# Check for plan markers
grep "@plan:PLAN-20251127-OPENAIVERCEL.P19" packages/core/src/providers/openai-vercel/__tests__/integration.test.ts

# Check for requirement markers
grep "@requirement:REQ-INT-001" packages/core/src/providers/openai-vercel/__tests__/integration.test.ts

# Run tests (expect some FAIL - integration not complete)
npm run test -- packages/core/src/providers/openai-vercel/__tests__/integration.test.ts
npm run test -- packages/cli/src/providers/__tests__/openaivercel.integration.test.ts
```

### Structural Verification Checklist

- [ ] Integration test file created for core
- [ ] Integration test file created for CLI
- [ ] Plan markers present
- [ ] Requirement markers present
- [ ] Tests verify history conversion
- [ ] Tests verify tool ID round-trip
- [ ] Tests verify CLI command integration
- [ ] Tests verify error propagation
- [ ] Tests FAIL (because integration not complete)

## Success Criteria

- Tests exist and are properly structured
- Tests verify end-to-end scenarios
- Some tests may pass (individual features work)
- Integration-specific tests FAIL (wiring not complete)

## Fraud Prevention Checklist (TDD RED Phase)

Before marking this phase complete, verify:

- [ ] Tests are written BEFORE integration wiring
- [ ] Tests verify ACTUAL behavior, not mocks
- [ ] Tests use realistic multi-turn conversation scenarios
- [ ] Tests verify tool ID preservation through full cycle
- [ ] No "always pass" tests

## Failure Recovery

If this phase fails:
1. Review test dependencies
2. Check mock setup
3. Verify IContent type definitions
4. Re-create tests with correct types

## Files Involved in Integration

### Core Files
- `packages/core/src/providers/openai-vercel/OpenAIVercelProvider.ts` - Main provider
- `packages/core/src/providers/openai-vercel/utils.ts` - Tool ID normalization
- `packages/core/src/providers/openai-vercel/errors.ts` - Error classes
- `packages/core/src/providers/ProviderManager.ts` - Provider registry

### Type Definitions
- `packages/core/src/services/history/IContent.ts` - IContent type
- `packages/core/src/providers/ITool.ts` - Tool definition interface

### CLI Files
- `packages/cli/src/ui/commands/keyCommand.ts` - `/key` command handler
- `packages/cli/src/ui/commands/keyfileCommand.ts` - `/keyfile` command handler
- `packages/cli/src/ui/commands/baseurlCommand.ts` - `/baseurl` command handler
- `packages/cli/src/ui/commands/modelCommand.ts` - `/model` command handler
- `packages/cli/src/ui/commands/providerCommand.ts` - `/provider` command handler

## Phase State Tracking

**Phase State**: `NOT_STARTED`

## Phase Completion Marker

Create: `project-plans/20251127openaivercel/.completed/P19.md`
