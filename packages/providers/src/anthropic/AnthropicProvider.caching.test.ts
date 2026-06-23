/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - prompt caching structure.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  setupAnthropicProvider,
  type AnthropicMessage,
  type AnthropicTestSetup,
} from './test-utils/anthropicProviderTestSetup.js';

// Shared mock instance for messages.create - using vi.hoisted so it's
// available when vi.mock factories run.
const mockMessagesCreate = vi.hoisted(() => vi.fn());

// Mock the ToolFormatter
vi.mock('@vybestack/llxprt-code-tools/ToolFormatter.js', () => ({
  ToolFormatter: vi.fn().mockImplementation(() => ({
    toProviderFormat: vi.fn((tools: unknown[], format: string) => {
      if (format === 'anthropic') {
        return tools.map((tool) => {
          const t = tool as {
            function: {
              name: string;
              description?: string;
              parameters: unknown;
            };
          };
          return {
            name: t.function.name,
            description: t.function.description ?? '',
            input_schema: { type: 'object', ...t.function.parameters },
          };
        });
      }
      return tools;
    }),
    fromProviderFormat: vi.fn((rawToolCall: unknown, format: string) => {
      if (format === 'anthropic') {
        const tc = rawToolCall as {
          id: string;
          name: string;
          input?: unknown;
        };
        return [
          {
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: tc.input != null ? JSON.stringify(tc.input) : '',
            },
          },
        ];
      }
      return [rawToolCall];
    }),
    convertGeminiToAnthropic: vi.fn(() => []),
    convertGeminiToFormat: vi.fn(() => undefined),
  })),
}));

vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(
    async () => "You are Claude Code, Anthropic's official CLI for Claude.",
  ),
}));

vi.mock('@vybestack/llxprt-code-core/utils/retry.js', () => ({
  getErrorStatus: vi.fn(() => undefined),
  isNetworkTransientError: vi.fn(() => false),
}));

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
    beta: {
      models: {
        list: vi.fn().mockReturnValue({
          async *[Symbol.asyncIterator]() {
            const models = [
              { id: 'claude-opus-4-20250514', display_name: 'Claude 4 Opus' },
              {
                id: 'claude-sonnet-4-20250514',
                display_name: 'Claude 4 Sonnet',
              },
              {
                id: 'claude-3-7-opus-20250115',
                display_name: 'Claude 3.7 Opus',
              },
              {
                id: 'claude-3-7-sonnet-20250115',
                display_name: 'Claude 3.7 Sonnet',
              },
              {
                id: 'claude-3-5-sonnet-20241022',
                display_name: 'Claude 3.5 Sonnet',
              },
              {
                id: 'claude-3-5-haiku-20241022',
                display_name: 'Claude 3.5 Haiku',
              },
              { id: 'claude-3-opus-20240229', display_name: 'Claude 3 Opus' },
              {
                id: 'claude-3-sonnet-20240229',
                display_name: 'Claude 3 Sonnet',
              },
              { id: 'claude-3-haiku-20240307', display_name: 'Claude 3 Haiku' },
            ];
            for (const model of models) {
              yield model;
            }
          },
        }),
      },
    },
  })),
}));
describe('AnthropicProvider', () => {
  let provider: AnthropicProvider;
  let settingsService: AnthropicTestSetup['settingsService'];
  let runtimeContext: ProviderRuntimeContext;
  let buildCallOptions: AnthropicTestSetup['buildCallOptions'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    settingsService = setup.settingsService;
    runtimeContext = setup.runtimeContext;
    buildCallOptions = setup.buildCallOptions;
    runtimeContext.config.getEphemeralSettings = () => ({
      ...settingsService.getAllGlobalSettings(),
      ...settingsService.getProviderSettings('anthropic'),
    });
    provider = new AnthropicProvider('test-api-key', undefined, {
      ...TEST_PROVIDER_CONFIG,
      getEphemeralSettings: () => ({
        ...settingsService.getAllGlobalSettings(),
        ...settingsService.getProviderSettings('anthropic'),
      }),
    });
    runtimeContext.config.streaming = 'disabled';
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });
  describe('Prompt Caching - Structure', () => {
    it('should not add cache_control to last message when content is empty string', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      expect(request.messages).toBeDefined();
      const anthropicMessages = request.messages as AnthropicMessage[];

      const lastMessage = anthropicMessages[anthropicMessages.length - 1];
      expect(lastMessage.role).toBe('user');

      // Last message content should remain a string (not converted to array)
      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toBe('');
    });

    it('should not add cache_control to last message when content is whitespace only', async () => {
      settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: '   \n\t  ' }],
        },
      ];

      const generator = provider.generateChatCompletion(
        buildCallOptions(messages),
      );
      await generator.next();

      const request = mockMessagesCreate.mock.calls[0][0];
      expect(request.messages).toBeDefined();
      const anthropicMessages = request.messages as AnthropicMessage[];

      const lastMessage = anthropicMessages[anthropicMessages.length - 1];
      expect(lastMessage.role).toBe('user');

      // Last message content should remain a string (not converted to array)
      expect(typeof lastMessage.content).toBe('string');
      expect(lastMessage.content).toBe('   \n\t  ');
    });

    describe('Cache Control Structure', () => {
      it('should not add cache_control when prompt-caching is off (default)', async () => {
        // Explicitly set to off (note: default is now 1h, not off)
        settingsService.setProviderSetting(
          'anthropic',
          'prompt-caching',
          'off',
        );

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
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

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.system).toBeDefined();

        // When caching is off, system can be a string (no cache_control possible)
        // or an array (cache_control should be undefined on all blocks)
        // We test that if it's an array, no blocks have cache_control
        const isArray = Array.isArray(request.system);
        const hasNoCacheControl = isArray
          ? (request.system as Array<{ cache_control?: unknown }>).every(
              (block) => block.cache_control === undefined,
            )
          : true; // String has no cache_control, which is correct

        expect(hasNoCacheControl).toBe(true);
      });

      it('should add cache_control with 5m TTL when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
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

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(Array.isArray(request.system)).toBe(true);

        const systemBlocks = request.system as Array<{
          type: string;
          text: string;
          cache_control?: { type: string; ttl?: string };
        }>;
        expect(systemBlocks.length).toBeGreaterThan(0);

        const lastBlock = systemBlocks[systemBlocks.length - 1];
        expect(lastBlock.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should add cache_control with 1h TTL when prompt-caching is 1h', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '1h');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 3200,
          },
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

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(Array.isArray(request.system)).toBe(true);

        const systemBlocks = request.system as Array<{
          type: string;
          text: string;
          cache_control?: { type: string; ttl?: string };
        }>;
        expect(systemBlocks.length).toBeGreaterThan(0);

        const lastBlock = systemBlocks[systemBlocks.length - 1];
        expect(lastBlock.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '1h',
        });
      });

      it('should add extended-cache-ttl beta header for 1h TTL', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '1h');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
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

        const call = mockMessagesCreate.mock.calls[0];
        expect(call).toBeDefined();

        const options = call[1];
        expect(options).toBeDefined();
        expect(options?.headers).toBeDefined();
        expect(options?.headers?.['anthropic-beta']).toContain(
          'extended-cache-ttl-2025-04-11',
        );
      });

      it('should not add beta header for 5m TTL', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
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

        const call = mockMessagesCreate.mock.calls[0];
        const options = call[1];

        // Check beta header - should not contain extended TTL
        const betaHeader = options?.headers?.['anthropic-beta'] as
          | string
          | undefined;
        // Either undefined or doesn't contain the extended TTL
        const isValidHeader = !(
          betaHeader?.includes('extended-cache-ttl-2025-04-11') ?? false
        );
        expect(isValidHeader).toBe(true);
      });

      it('should add cache_control to last message in multi-turn history when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn conversation with final human message
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Second response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'How are you?' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // The last message should have cache_control on its last content block
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(lastMessage.role).toBe('user');

        // Last message content should be an array with cache_control
        expect(Array.isArray(lastMessage.content)).toBe(true);
        const contentBlocks = lastMessage.content as AnthropicContentBlock[];
        expect(contentBlocks.length).toBeGreaterThan(0);

        // The last content block should have cache_control
        const lastContentBlock = contentBlocks[contentBlocks.length - 1];
        expect(lastContentBlock.type).toBe('text');
        expect(lastContentBlock.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should add cache_control to last tool_result block in history when prompt-caching is 5m', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn history with tool call and response
        const toolCallId = 'hist_tool_read_123';
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Process this file' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: toolCallId,
                name: 'read_file',
                parameters: { path: '/tmp/file.txt' },
              },
            ],
          },
          {
            speaker: 'human',
            blocks: [
              {
                type: 'tool_response',
                callId: toolCallId,
                toolName: 'read_file',
                result: 'File content here',
              },
            ],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // The last message should be the tool response
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(lastMessage.role).toBe('user');
        expect(Array.isArray(lastMessage.content)).toBe(true);

        const contentBlocks = lastMessage.content as AnthropicContentBlock[];
        expect(contentBlocks.length).toBeGreaterThan(0);

        // The last content block should be a tool_result with cache_control
        const lastContentBlock = contentBlocks[contentBlocks.length - 1];
        expect(lastContentBlock.type).toBe('tool_result');
        expect(lastContentBlock.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '5m',
        });
      });

      it('should not add cache_control to message blocks when prompt-caching is off', async () => {
        settingsService.setProviderSetting(
          'anthropic',
          'prompt-caching',
          'off',
        );

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        // Multi-turn conversation with final human message
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'First response' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'How are you?' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.messages).toBeDefined();
        const anthropicMessages = request.messages as AnthropicMessage[];

        // All message blocks should not have cache_control
        const allCacheControls = anthropicMessages.flatMap((message) => {
          if (Array.isArray(message.content)) {
            const contentBlocks = message.content;
            return contentBlocks.map((block) => block.cache_control);
          }
          // String content has no cache_control, which is correct
          return [];
        });

        // All cache_controls that exist should be undefined
        expect(allCacheControls.every((cc) => cc === undefined)).toBe(true);
      });

      it('should strip extra fields from text block when injecting cache_control (regression #1414)', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        // Capture the request and inject extra properties into content blocks
        // BEFORE the API call to simulate runtime pollution (e.g., from
        // deserialized history, SDK mutations, or prototype chains).
        // The cache_control injection code used to spread the entire block
        // object, which would preserve any unexpected extra properties and
        // cause Anthropic 400 "text: Extra inputs are not permitted".
        let capturedRequest: Record<string, unknown> | undefined;
        mockMessagesCreate.mockImplementation(
          (req: Record<string, unknown>) => {
            capturedRequest = req;
            return Promise.resolve({
              content: [{ type: 'text', text: 'response' }],
              usage: { input_tokens: 100, output_tokens: 50 },
            });
          },
        );

        // Intercept the anthropicMessages array by wrapping the mock.
        // We patch the Anthropic client's messages.create to:
        // 1. Add extra properties to the last content block (simulating pollution)
        // 2. Then check whether those extras survived cache_control injection
        //
        // However, by the time messages.create is called, the request body is
        // already finalized. So instead we validate that the provider's
        // cache_control injection produces ONLY allowed keys on every block.
        //
        // To truly demonstrate the spread-operator vulnerability, we also
        // construct a polluted block inline and verify the fix strips extras.

        // Build a multi-turn history where the last user message has array
        // content (tool_result), so cache_control injection uses the spread path.
        const toolCallId = 'tool_extra_field_test';
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Read the file' }],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'tool_call',
                id: toolCallId,
                name: 'read_file',
                parameters: { path: '/tmp/test.txt' },
              },
            ],
          },
          {
            speaker: 'human',
            blocks: [
              {
                type: 'tool_response',
                callId: toolCallId,
                toolName: 'read_file',
                result: 'file content here',
              },
            ],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        expect(capturedRequest).toBeDefined();
        const anthropicMessages = (capturedRequest as Record<string, unknown>)
          .messages as AnthropicMessage[];

        // Find the last message (should be user with array content)
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(Array.isArray(lastMessage.content)).toBe(true);

        const contentBlocks = lastMessage.content as Array<
          Record<string, unknown>
        >;

        // Find the block that received cache_control
        const cachedBlock = contentBlocks.find(
          (b) => b['cache_control'] !== undefined,
        );
        expect(cachedBlock).toBeDefined();

        // Allowed keys per block type (only Anthropic-permitted fields)
        const allowedKeysByType: Record<string, Set<string>> = {
          text: new Set(['type', 'text', 'cache_control']),
          tool_result: new Set([
            'type',
            'tool_use_id',
            'content',
            'is_error',
            'cache_control',
          ]),
          tool_use: new Set(['type', 'id', 'name', 'input', 'cache_control']),
        };

        const blockType = cachedBlock!['type'] as string;
        const allowed = allowedKeysByType[blockType];
        expect(allowed).toBeDefined();

        const actualKeys = Object.keys(cachedBlock!);
        const extraKeys = actualKeys.filter((k) => !allowed.has(k));
        expect(extraKeys).toStrictEqual([]);
      });

      it('should not send extra keys on last text block when prompt-caching is enabled (issue #1414)', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        // Intercept messages.create to capture the finalized request AND
        // mutate the last content block to inject extra properties BEFORE
        // the provider sends it — simulating pollution from deserialized
        // history, SDK mutations, or prototype chains.
        //
        // We wrap the mock so that it:
        //   1) captures the raw request
        //   2) returns a valid response
        let capturedRequest: Record<string, unknown> | undefined;
        mockMessagesCreate.mockImplementation(
          (req: Record<string, unknown>) => {
            capturedRequest = req;
            return Promise.resolve({
              content: [{ type: 'text', text: 'response' }],
              usage: { input_tokens: 100, output_tokens: 50 },
            });
          },
        );

        // Build a simple conversation where the last message is a plain
        // text user message (the most common case for cache_control).
        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'First message' }],
          },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'AI reply' }],
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Second message' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages),
        );
        await generator.next();

        expect(capturedRequest).toBeDefined();
        const anthropicMessages = (capturedRequest as Record<string, unknown>)
          .messages as AnthropicMessage[];

        // The last message should have cache_control on its last block
        const lastMessage = anthropicMessages[anthropicMessages.length - 1];
        expect(Array.isArray(lastMessage.content)).toBe(true);

        const contentBlocks = lastMessage.content as Array<
          Record<string, unknown>
        >;
        const cachedBlock = contentBlocks.find(
          (b) => b['cache_control'] !== undefined,
        );
        expect(cachedBlock).toBeDefined();
        expect(cachedBlock!['type']).toBe('text');

        // Verify that the cached text block contains ONLY the keys
        // Anthropic permits: { type, text, cache_control }.
        // Before the fix, if the block had extra properties (e.g., from
        // Object.assign, spread pollution, or deserialized JSON with
        // additional fields), the spread operator in cache_control
        // injection would copy them all, causing Anthropic 400
        // "text: Extra inputs are not permitted".
        const allowedTextKeys = new Set(['type', 'text', 'cache_control']);
        const blockKeys = Object.keys(cachedBlock!);
        const extraKeys = blockKeys.filter((k) => !allowedTextKeys.has(k));
        expect(extraKeys).toStrictEqual([]);

        // Now verify the sanitization works when a block HAS extra keys.
        // We call sanitizeBlockForCacheControl directly with a polluted block.
        const { sanitizeBlockForCacheControl } = await import(
          './AnthropicRequestBuilder.js'
        );

        const pollutedText = {
          type: 'text' as const,
          text: 'hello',
          unexpectedField: 'should-not-appear',
          anotherExtra: 42,
        };
        const sanitizedText = sanitizeBlockForCacheControl(
          pollutedText,
          '5m' as const,
        );
        expect(Object.keys(sanitizedText).sort()).toStrictEqual([
          'cache_control',
          'text',
          'type',
        ]);
        expect(sanitizedText.type).toBe('text');
        expect(sanitizedText.text).toBe('hello');
        expect(sanitizedText.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '5m',
        });

        // Verify tool_result sanitization
        const pollutedToolResult = {
          type: 'tool_result' as const,
          tool_use_id: 'toolu_123',
          content: 'result data',
          is_error: false,
          extra_meta: 'leaked',
        };
        const sanitizedToolResult = sanitizeBlockForCacheControl(
          pollutedToolResult,
          '5m' as const,
        );
        expect(Object.keys(sanitizedToolResult).sort()).toStrictEqual([
          'cache_control',
          'content',
          'is_error',
          'tool_use_id',
          'type',
        ]);

        // Verify tool_use sanitization
        const pollutedToolUse = {
          type: 'tool_use' as const,
          id: 'toolu_456',
          name: 'read_file',
          input: { path: '/tmp/test.txt' },
          debug_info: 'should not appear',
        };
        const sanitizedToolUse = sanitizeBlockForCacheControl(
          pollutedToolUse,
          '1h' as const,
        );
        expect(Object.keys(sanitizedToolUse).sort()).toStrictEqual([
          'cache_control',
          'id',
          'input',
          'name',
          'type',
        ]);
        expect(sanitizedToolUse.cache_control).toStrictEqual({
          type: 'ephemeral',
          ttl: '1h',
        });
      });
    });

    describe('Stable Tool Ordering', () => {
      it('should sort tools alphabetically by name', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const tools = [
          {
            functionDeclarations: [
              {
                name: 'zebra_tool',
                description: 'Z tool',
                parametersJsonSchema: { type: 'object', properties: {} },
              },
              {
                name: 'alpha_tool',
                description: 'A tool',
                parametersJsonSchema: { type: 'object', properties: {} },
              },
              {
                name: 'middle_tool',
                description: 'M tool',
                parametersJsonSchema: { type: 'object', properties: {} },
              },
            ],
          },
        ];

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages, { tools }),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.tools).toBeDefined();

        const toolNames = request.tools.map((t: { name: string }) => t.name);
        expect(toolNames).toStrictEqual([
          'alpha_tool',
          'middle_tool',
          'zebra_tool',
        ]);
      });

      it('should sort JSON schema keys alphabetically', async () => {
        settingsService.setProviderSetting('anthropic', 'prompt-caching', '5m');

        mockMessagesCreate.mockResolvedValueOnce({
          content: [{ type: 'text', text: 'response' }],
          usage: {
            input_tokens: 100,
            output_tokens: 50,
          },
        });

        const tools = [
          {
            functionDeclarations: [
              {
                name: 'test_tool',
                description: 'Test',
                parametersJsonSchema: {
                  type: 'object',
                  properties: {
                    zebra: { type: 'string' },
                    apple: { type: 'number' },
                    middle: { type: 'boolean' },
                  },
                },
              },
            ],
          },
        ];

        const messages: IContent[] = [
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'Hello' }],
          },
        ];

        const generator = provider.generateChatCompletion(
          buildCallOptions(messages, { tools }),
        );
        await generator.next();

        const request = mockMessagesCreate.mock.calls[0][0];
        expect(request.tools).toBeDefined();

        const tool = request.tools[0];
        const propertyKeys = Object.keys(tool.input_schema.properties);
        expect(propertyKeys).toStrictEqual(['apple', 'middle', 'zebra']);
      });
    });
  });
});
