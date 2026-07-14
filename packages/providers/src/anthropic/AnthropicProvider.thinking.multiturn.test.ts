/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider extended thinking: multi-turn persistence and prefill guard.
 * Split from AnthropicProvider.thinking.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import type {
  IContent,
  ThinkingBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';
import {
  mockMessagesCreate,
  setupThinkingProvider,
  type ThinkingTestSetup,
} from './test-utils/anthropicThinkingTestSetup.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';

describe('AnthropicProvider Extended Thinking @plan:PLAN-ANTHROPIC-THINKING', () => {
  let provider: ThinkingTestSetup['provider'];
  let settingsService: ThinkingTestSetup['settingsService'];
  let buildCallOptions: ThinkingTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupThinkingProvider();
    provider = setup.provider;
    settingsService = setup.settingsService;
    buildCallOptions = setup.buildCallOptions;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  describe('Multi-Turn Thinking Persistence Tests @requirement:REQ-ISSUE1150-FIX', () => {
    beforeEach(() => {
      settingsService.setProviderSetting('anthropic', 'streaming', 'disabled');
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.includeInContext', true);
      settingsService.set('reasoning.stripFromContext', 'none');
    });

    it('should NOT disable thinking when tool calls have associated thinking blocks in history', async () => {
      // Simulate a multi-turn conversation with thinking + tool calls
      const messages: IContent[] = [
        // Turn 1: User asks
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List files in current directory' }],
        },
        // Turn 2: AI responds with thinking + tool call
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I need to list the files',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'hist_tool_001',
              name: 'list_directory',
              parameters: { path: '.' },
            },
          ],
        },
        // Turn 3: Tool result
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_001',
              toolName: 'list_directory',
              result: 'file1.txt, file2.txt',
            },
          ],
        },
        // Turn 4: User asks follow-up
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What is in file1.txt?' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Now I need to read the file',
            signature: 'sig2',
          },
          { type: 'text', text: 'Let me read that file' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Pin a non-adaptive model: the provider default is Opus 4.8 (adaptive),
      // but this test asserts the manual 'enabled' thinking mode persists.
      const generator = provider.generateChatCompletion(
        buildCallOptions(messages, {
          settingsOverrides: {
            global: {
              model: 'claude-sonnet-4-5-20250929',
            },
          },
        }),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Verify thinking is still enabled (NOT disabled)
      expect(request.thinking).toBeDefined();
      expect(request.thinking?.type).toBe('enabled');

      // Verify the tool call message includes thinking block
      const assistantMsg = request.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((b) => b.type === 'tool_use'),
      );
      expect(assistantMsg).toBeDefined();

      const hasThinking = (
        assistantMsg!.content as AnthropicContentBlock[]
      ).some((b) => b.type === 'thinking' || b.type === 'redacted_thinking');
      expect(hasThinking).toBe(true);
    });

    it('should not attach orphaned thinking across intervening messages', async () => {
      // Simulate streaming scenario where thinking and tool calls are in separate IContent items
      // with a human message in between. The thinking should NOT be merged into later tool calls
      // because a human message intervenes. However, consecutive tool_call assistant messages
      // WILL be merged by the role-alternation enforcement pass.
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        // Thinking block arrives first (orphaned - no tool call yet)
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Planning my approach',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
          ],
        },
        // Interruption keeps thinking orphaned
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Please continue' }],
        },
        // Tool calls arrive separately
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_002',
              name: 'do_something',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_003',
              name: 'do_something_else',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_002',
              toolName: 'do_something',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_003',
              toolName: 'do_something_else',
              result: 'Done again',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'thinking',
            thinking: 'Continuing work',
            signature: 'sig2',
          },
          { type: 'text', text: 'Continuing...' },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // The two consecutive tool_call assistant messages get merged into one
      // to maintain Anthropic's role alternation requirement
      const assistantMessages = request.messages.filter(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((block) => block.type === 'tool_use'),
      );
      expect(assistantMessages).toHaveLength(1);

      const mergedContent = assistantMessages[0]
        .content as AnthropicContentBlock[];

      // Both tool_use blocks should be in the merged message
      const toolUseBlocks = mergedContent.filter((b) => b.type === 'tool_use');
      expect(toolUseBlocks).toHaveLength(2);

      // Orphaned thinking should NOT be attached (human message intervened)
      const hasThinking = mergedContent.some(
        (block) =>
          block.type === 'thinking' || block.type === 'redacted_thinking',
      );
      expect(hasThinking).toBe(false);
    });

    it('should keep thinking enabled even when no thinking blocks exist for tool calls', async () => {
      // Simulate a scenario where tool call has NO associated thinking at all
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        // AI responds with tool call but NO thinking block anywhere
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_003',
              name: 'do_something',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_003',
              toolName: 'do_something',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      expect(request.thinking).toBeDefined();
    });

    it('should merge orphaned thinking blocks into the next assistant message without tool calls', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First question' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking about it',
              sourceField: 'thinking',
              signature: 'sig-merge',
            } as ThinkingBlock,
          ],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Final answer' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;
      const assistantMessages = request.messages.filter(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      );

      const lastAssistant = assistantMessages[assistantMessages.length - 1];
      const content = lastAssistant.content as AnthropicContentBlock[];

      expect(content[0]).toMatchObject({
        type: 'thinking',
        signature: 'sig-merge',
      });

      const thinkingBlocks = assistantMessages.flatMap((message) =>
        (message.content as AnthropicContentBlock[]).filter(
          (block) => block.type === 'thinking',
        ),
      );
      expect(thinkingBlocks).toHaveLength(1);
    });

    it('should find orphaned thinking up to 3 messages back', async () => {
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Start' }],
        },
        // Orphaned thinking block
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Deep thinking',
              sourceField: 'thinking',
              signature: 'sig1',
            } as ThinkingBlock,
          ],
        },
        // Some text in between
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Intermediate response' }],
        },
        // Tool result
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_004',
              toolName: 'some_tool',
              result: 'Result',
            },
          ],
        },
        // Tool call 3 messages after thinking
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'hist_tool_005',
              name: 'another_tool',
              parameters: {},
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'hist_tool_005',
              toolName: 'another_tool',
              result: 'Done',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Continue' }],
        },
      ];

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      const assistantMsg = request.messages.find(
        (m) => m.role === 'assistant' && Array.isArray(m.content),
      );
      expect(assistantMsg).toBeDefined();

      const content = assistantMsg?.content as AnthropicContentBlock[];
      expect(content[0]).toMatchObject({
        type: 'thinking',
        signature: 'sig1',
      });
    });
  });

  describe('Issue #1545: prefill guard for thinking models', () => {
    it('should append user placeholder when conversation ends with assistant and thinking is enabled', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.budgetTokens', 5000);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      // Simulate a conversation that ends with an assistant message.
      // This can occur after cross-provider --continue when orphan
      // tool_result removal drops the trailing user message.
      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'I will help you.' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // The last message must be user to avoid Anthropic prefill rejection
      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      // Content may be wrapped in array by prompt caching
      const textContent = Array.isArray(lastMessage.content)
        ? (lastMessage.content as Array<{ type: string; text?: string }>).find(
            (b) => b.type === 'text',
          )?.text
        : lastMessage.content;
      expect(textContent).toBe('Continue the conversation');
    });

    it('should NOT append user placeholder when thinking is disabled and conversation ends with assistant', async () => {
      settingsService.set('reasoning.enabled', false);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'I will help you.' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Without thinking, prefill (ending with assistant) is allowed
      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage.role).toBe('assistant');
    });

    it('should NOT append user placeholder when conversation already ends with user and thinking is enabled', async () => {
      settingsService.set('reasoning.enabled', true);
      settingsService.set('reasoning.budgetTokens', 5000);

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Last message should be the original user message, not a placeholder
      const lastMessage = request.messages[request.messages.length - 1];
      expect(lastMessage.role).toBe('user');
      // Content may be wrapped in array by prompt caching — extract text to verify
      const textContent = Array.isArray(lastMessage.content)
        ? (lastMessage.content as Array<{ type: string; text?: string }>).find(
            (b) => b.type === 'text',
          )?.text
        : lastMessage.content;
      expect(textContent).not.toBe('Continue the conversation');
    });
  });
});
