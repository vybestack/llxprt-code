/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type {
  IContent,
  ThinkingBlock,
  ToolCallBlock,
  ToolResponseBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import {
  createProviderWithRuntime,
  createRuntimeConfigStub,
} from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import {
  createProviderCallOptions,
  type ProviderCallOptionsInit,
} from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  clearActiveProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  AnthropicContentBlock,
  AnthropicRequestBody,
} from './test-utils/anthropicTestUtils.js';

// Mock dependencies
vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

// REQ-RETRY-001: retryWithBackoff removed from providers
vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

const mockMessagesCreate = vi.fn();

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: {
      create: mockMessagesCreate,
    },
  })),
}));

describe('AnthropicProvider Issue #1150: tool_result Adjacency Validation', () => {
  let provider: AnthropicProvider;
  let runtimeContext: ProviderRuntimeContext;
  let settingsService: SettingsService;

  beforeEach(() => {
    vi.clearAllMocks();

    let ephemeralSettingsGetter: () => Record<string, unknown> = () => ({});

    const result = createProviderWithRuntime<AnthropicProvider>(
      ({ settingsService: svc }) => {
        svc.set('auth-key', 'test-api-key');
        svc.set('activeProvider', 'anthropic');
        svc.setProviderSetting('anthropic', 'streaming', 'disabled');

        ephemeralSettingsGetter = () => ({
          ...svc.getAllGlobalSettings(),
          ...svc.getProviderSettings('anthropic'),
        });

        return new AnthropicProvider('test-api-key', undefined, {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: ephemeralSettingsGetter,
        });
      },
      {
        runtimeId: 'anthropic.toolresult.test',
        metadata: { source: 'AnthropicProvider.issue1150.toolresult.test.ts' },
      },
    );

    provider = result.provider;
    runtimeContext = result.runtime;
    settingsService = result.settingsService;

    runtimeContext.config ??= createRuntimeConfigStub(settingsService);

    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings(provider.name),
    });

    runtimeContext.config.getEphemeralSetting = (key: string) => {
      const providerValue = settingsService.getProviderSetting(
        provider.name,
        key,
      );
      if (providerValue !== undefined) {
        return providerValue;
      }
      return settingsService.get(key);
    };

    setActiveProviderRuntimeContext(runtimeContext);

    // Enable extended thinking
    settingsService.set('reasoning.enabled', true);
    settingsService.set('reasoning.budgetTokens', 10000);
    settingsService.set('reasoning.includeInContext', true);
    settingsService.set('reasoning.stripFromContext', 'none');
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  const buildCallOptions = (
    contents: IContent[],
    overrides: Omit<ProviderCallOptionsInit, 'providerName' | 'contents'> = {},
  ) =>
    createProviderCallOptions({
      providerName: provider.name,
      contents,
      settings: settingsService,
      runtime: runtimeContext,
      config: runtimeContext.config,
      ...overrides,
    });

  /**
   * Helper to extract tool_use ids from a message
   */
  const getToolUseIds = (content: AnthropicContentBlock[]): string[] =>
    content
      .filter(
        (
          b,
        ): b is {
          type: 'tool_use';
          id: string;
          name: string;
          input: unknown;
        } => b.type === 'tool_use',
      )
      .map((b) => b.id);

  /**
   * Helper to extract tool_result tool_use_ids from a message
   */
  const getToolResultIds = (content: AnthropicContentBlock[]): string[] =>
    content
      .filter(
        (
          b,
        ): b is {
          type: 'tool_result';
          tool_use_id: string;
          content: unknown;
        } => b.type === 'tool_result',
      )
      .map((b) => b.tool_use_id);

  describe('Edge cases for tool_result handling', () => {
    /**
     * Test handling of tool errors
     */
    it('should properly format tool_result with is_error for failed tools', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Try something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Attempting action',
              sourceField: 'thinking',
              signature: 'sig_err',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_will_fail',
              name: 'risky_action',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_will_fail',
              toolName: 'risky_action',
              result: null,
              error: 'Permission denied: cannot access resource',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'What happened?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the tool_result
      let toolResult: AnthropicContentBlock | undefined;
      for (const msg of request.messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          toolResult = msg.content.find((b) => b.type === 'tool_result');
          if (toolResult) break;
        }
      }

      expect(toolResult).toBeDefined();
      expect(toolResult!.type).toBe('tool_result');

      // Error should set is_error flag
      const result = toolResult as {
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      };
      expect(
        result.is_error,
        'Tool error should set is_error: true in tool_result',
      ).toBe(true);
    });

    it('should serialize tool_result content correctly for complex objects', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const complexResult = {
        files: [
          { name: 'a.txt', size: 100 },
          { name: 'b.txt', size: 200 },
        ],
        metadata: {
          total: 2,
          directory: '/test',
        },
      };

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'List files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Listing',
              sourceField: 'thinking',
              signature: 'sig_complex',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_complex_result',
              name: 'list_files',
              parameters: {},
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_complex_result',
              toolName: 'list_files',
              result: complexResult,
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Details?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // Find the tool_result
      let toolResult: AnthropicContentBlock | undefined;
      for (const msg of request.messages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          toolResult = msg.content.find((b) => b.type === 'tool_result');
          if (toolResult) break;
        }
      }

      expect(toolResult).toBeDefined();

      const result = toolResult as {
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
      };

      // Content should be present and serializable
      expect(result.content).toBeDefined();

      // Should not throw when stringified
      expect(() => JSON.stringify(result.content)).not.toThrow();
    });
  });

  describe('Issue #1312: Interrupted tool calls and consecutive same-role messages', () => {
    const assertStrictAlternation = (
      messages: Array<{ role: string; content: unknown }>,
    ) => {
      for (let i = 1; i < messages.length; i++) {
        expect(messages[i].role).not.toBe(messages[i - 1].role);
      }
    };

    it('should handle interrupted tool calls followed by user messages (issue #1312)', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Find some files' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'I will search for files',
              sourceField: 'thinking',
              signature: 'sig_interrupted',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'toolu_01QzKQrpaCwfR4JgXphWnGrC',
              name: 'glob',
              parameters: { pattern: '**/*.ts' },
            } as ToolCallBlock,
            {
              type: 'tool_call',
              id: 'toolu_017u1Ybt9ECtS4GYE46hXB8H',
              name: 'glob',
              parameters: { pattern: '**/*.js' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: 'First, reason in your scratchpad...',
            },
          ],
        },
        {
          speaker: 'human',
          blocks: [
            { type: 'text', text: 'do you remember what we are doing?' },
          ],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'The user is asking me to remember',
              sourceField: 'thinking',
              signature: 'sig_response',
            } as ThinkingBlock,
            {
              type: 'text',
              text: 'Yes, I remember we were looking for files.',
            },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

      let toolUseMessageIndex = -1;
      let toolUseIds: string[] = [];

      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const ids = getToolUseIds(msg.content);
          if (ids.length > 0) {
            toolUseMessageIndex = i;
            toolUseIds = ids;
            break;
          }
        }
      }

      expect(toolUseMessageIndex).toBeGreaterThan(-1);
      expect(toolUseIds.length).toBe(2);

      const nextMessage = request.messages[toolUseMessageIndex + 1];
      expect(nextMessage).toBeDefined();
      expect(nextMessage.role).toBe('user');
      expect(Array.isArray(nextMessage.content)).toBe(true);

      const toolResultIds = getToolResultIds(
        nextMessage.content as AnthropicContentBlock[],
      );
      for (const toolUseId of toolUseIds) {
        expect(toolResultIds).toContain(toolUseId);
      }

      const toolResults = (
        nextMessage.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      for (const tr of toolResults) {
        expect(tr.is_error).toBe(true);
        expect(tr.content).toBe('[tool execution interrupted]');
      }
    });

    it('should merge consecutive user messages containing tool_results to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Do something' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Calling a tool',
              sourceField: 'thinking',
              signature: 'sig_tool',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_merge_test',
              name: 'read_file',
              parameters: { path: 'test.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_merge_test',
              toolName: 'read_file',
              result: 'file contents',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Now do something else' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Got it',
              sourceField: 'thinking',
              signature: 'sig_response',
            } as ThinkingBlock,
            { type: 'text', text: 'Done.' },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

      let toolUseIdx = -1;
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (
          msg.role === 'assistant' &&
          Array.isArray(msg.content) &&
          msg.content.some((b) => b.type === 'tool_use')
        ) {
          toolUseIdx = i;
          break;
        }
      }

      expect(toolUseIdx).toBeGreaterThan(-1);
      const nextMsg = request.messages[toolUseIdx + 1];
      expect(nextMsg.role).toBe('user');
      expect(Array.isArray(nextMsg.content)).toBe(true);

      const content = nextMsg.content as AnthropicContentBlock[];
      const hasToolResult = content.some((b) => b.type === 'tool_result');
      const hasText = content.some((b) => b.type === 'text');
      expect(hasToolResult).toBe(true);
      expect(hasText).toBe(true);
    });

    it('should handle tool_use followed by user interruption then another tool_use cycle', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Start' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'First tool call',
              sourceField: 'thinking',
              signature: 'sig_first_call',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_interrupted_1',
              name: 'read_file',
              parameters: { path: 'a.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Actually, try something else' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Second tool call',
              sourceField: 'thinking',
              signature: 'sig_second_call',
            } as ThinkingBlock,
            {
              type: 'tool_call',
              id: 'tool_success_2',
              name: 'read_file',
              parameters: { path: 'b.txt' },
            } as ToolCallBlock,
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'tool_success_2',
              toolName: 'read_file',
              result: 'content of b.txt',
            } as ToolResponseBlock,
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Great, what did you find?' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      assertStrictAlternation(request.messages);

      const toolUseIndices: Array<{
        index: number;
        ids: string[];
      }> = [];
      for (let i = 0; i < request.messages.length; i++) {
        const msg = request.messages[i];
        if (msg.role === 'assistant' && Array.isArray(msg.content)) {
          const ids = getToolUseIds(msg.content);
          if (ids.length > 0) {
            toolUseIndices.push({ index: i, ids });
          }
        }
      }

      for (const { index, ids } of toolUseIndices) {
        const nextMsg = request.messages[index + 1];
        expect(nextMsg).toBeDefined();
        expect(nextMsg.role).toBe('user');
        expect(Array.isArray(nextMsg.content)).toBe(true);

        const resultIds = getToolResultIds(
          nextMsg.content as AnthropicContentBlock[],
        );
        for (const id of ids) {
          expect(resultIds).toContain(id);
        }
      }

      const firstToolUse = toolUseIndices.find((t) =>
        t.ids.some((id) => id.includes('tool_interrupted_1')),
      );
      expect(firstToolUse).toBeDefined();
      const firstNextMsg = request.messages[firstToolUse!.index + 1];
      const firstToolResults = (
        firstNextMsg.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      const interruptedResult = firstToolResults.find((tr) =>
        tr.tool_use_id.includes('tool_interrupted_1'),
      );
      expect(interruptedResult).toBeDefined();
      expect(interruptedResult!.is_error).toBe(true);
      expect(interruptedResult!.content).toBe('[tool execution interrupted]');

      const secondToolUse = toolUseIndices.find((t) =>
        t.ids.some((id) => id.includes('tool_success_2')),
      );
      expect(secondToolUse).toBeDefined();
      const secondNextMsg = request.messages[secondToolUse!.index + 1];
      const secondToolResults = (
        secondNextMsg.content as AnthropicContentBlock[]
      ).filter((b) => b.type === 'tool_result') as Array<{
        type: 'tool_result';
        tool_use_id: string;
        content: unknown;
        is_error?: boolean;
      }>;
      const successResult = secondToolResults.find((tr) =>
        tr.tool_use_id.includes('tool_success_2'),
      );
      expect(successResult).toBeDefined();
      expect(successResult!.is_error).toBeUndefined();
    });

    it('should merge consecutive text-only user messages to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'First message' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Thinking about it',
              sourceField: 'thinking',
              signature: 'sig_consec_user',
            } as ThinkingBlock,
            { type: 'text', text: 'Let me think...' },
          ],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Actually, do this instead' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'And also this' }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'thinking',
              thought: 'Got updated instructions',
              sourceField: 'thinking',
              signature: 'sig_consec_response',
            } as ThinkingBlock,
            { type: 'text', text: 'Sure, doing both.' },
          ],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // The output stream must still carry at least one user message and
      // one assistant message and satisfy strict role alternation between
      // every adjacent pair (the merge/pad logic is what this test guards).
      expect(request.messages.length).toBeGreaterThanOrEqual(2);
      expect(request.messages.some((m) => m.role === 'user')).toBe(true);
      expect(request.messages.some((m) => m.role === 'assistant')).toBe(true);
      assertStrictAlternation(request.messages);
    });

    it('should merge consecutive assistant messages to maintain role alternation', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Response' }],
        usage: { input_tokens: 100, output_tokens: 50 },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Tell me something' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Here is part one.' }],
        },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'And here is part two.' }],
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Thanks' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock
        .calls[0][0] as AnthropicRequestBody;

      // The output stream must still carry at least one user message and
      // one assistant message and satisfy strict role alternation between
      // every adjacent pair (the merge/pad logic is what this test guards).
      expect(request.messages.length).toBeGreaterThanOrEqual(2);
      expect(request.messages.some((m) => m.role === 'user')).toBe(true);
      expect(request.messages.some((m) => m.role === 'assistant')).toBe(true);
      assertStrictAlternation(request.messages);
    });
  });
});
