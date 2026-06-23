/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for AnthropicProvider - OAuth compatibility and sanitize.
 * Split from AnthropicProvider.test.ts for max-lines compliance.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import { clearActiveProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import { sanitizeBlockForCacheControl } from './AnthropicRequestBuilder.js';

import {
  setupAnthropicProvider,
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
  let settingsService: AnthropicTestSetup['settingsService'];
  let runtimeContext: AnthropicTestSetup['runtimeContext'];

  beforeEach(() => {
    vi.clearAllMocks();
    const setup = setupAnthropicProvider();
    settingsService = setup.settingsService;
    runtimeContext = setup.runtimeContext;
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });
  describe('OAuth Compatibility', () => {
    it('should prefix tool names with llxprt_ for OAuth requests', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const tools = [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
        tools,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const requestBody = call[0];
      expect(requestBody).toBeDefined();
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('llxprt_read_file');
    });

    it('should NOT prefix tool names for regular API key requests', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const tools = [
        {
          functionDeclarations: [
            {
              name: 'read_file',
              description: 'Read a file',
              parametersJsonSchema: { type: 'object', properties: {} },
            },
          ],
        },
      ];

      const providerWithNoStreaming = new AnthropicProvider(
        'test-api-key',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
        tools,
      });

      const generator =
        providerWithNoStreaming.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      expect(call).toBeDefined();

      const requestBody = call[0];
      expect(requestBody).toBeDefined();
      expect(requestBody.tools).toBeDefined();
      expect(requestBody.tools[0].name).toBe('read_file'); // NO prefix
    });

    it('should unprefix tool names in streaming responses for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'enabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      // Mock streaming response with prefixed tool name
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            type: 'content_block_start',
            content_block: {
              type: 'tool_use',
              id: 'tool-123',
              name: 'llxprt_read_file', // PREFIXED by API
            },
          };
          yield {
            type: 'content_block_delta',
            delta: {
              type: 'input_json_delta',
              partial_json: '{"path":"test.txt"}',
            },
          };
          yield { type: 'content_block_stop' };
        },
      };

      mockMessagesCreate.mockResolvedValue(mockStream);

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);

      const chunks = [];
      for await (const chunk of generator) {
        chunks.push(chunk);
      }

      const toolCallChunk = chunks.find((c) =>
        c.blocks.some((b) => b.type === 'tool_call'),
      );
      expect(toolCallChunk).toBeDefined();

      const toolCall = (toolCallChunk as IContent).blocks.find(
        (b) => b.type === 'tool_call',
      ) as { type: 'tool_call'; name: string };

      // Should be un-prefixed
      expect(toolCall.name).toBe('read_file');
    });

    it('should unprefix tool names in non-streaming responses for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      // Mock non-streaming response with prefixed tool name
      mockMessagesCreate.mockResolvedValueOnce({
        content: [
          {
            type: 'tool_use',
            id: 'tool-123',
            name: 'llxprt_read_file', // PREFIXED by API
            input: { path: 'test.txt' },
          },
        ],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      const result = await generator.next();

      expect(result.value).toBeDefined();
      const content = result.value as IContent;

      const toolCall = content.blocks.find((b) => b.type === 'tool_call') as {
        type: 'tool_call';
        name: string;
      };

      expect(toolCall).toBeDefined();
      // Should be un-prefixed
      expect(toolCall.name).toBe('read_file');
    });

    it('should include User-Agent header for OAuth requests', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const options = call[1];
      expect(options).toBeDefined();
      expect(options?.headers).toBeDefined();
      expect(options?.headers?.['User-Agent']).toBe(
        'claude-cli/2.1.2 (external, cli)',
      );
    });

    it('should include both oauth-2025-04-20 AND interleaved-thinking-2025-05-14 in anthropic-beta headers for OAuth', async () => {
      // Create provider with OAuth token
      const oauthProvider = new AnthropicProvider(
        'sk-ant-oat-test-token',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      // Mock getAuthToken to return the OAuth token
      vi.spyOn(oauthProvider, 'getAuthToken').mockResolvedValue(
        'sk-ant-oat-test-token',
      );

      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator = oauthProvider.generateChatCompletion(callOptions);
      await generator.next();

      const call = mockMessagesCreate.mock.calls[0];
      expect(call).toBeDefined();

      const options = call[1];
      expect(options).toBeDefined();
      expect(options?.headers).toBeDefined();
      const betaHeader = options?.headers?.['anthropic-beta'];
      expect(betaHeader).toContain('oauth-2025-04-20');
      expect(betaHeader).toContain('interleaved-thinking-2025-05-14');
    });

    it('should NOT add OAuth headers for non-OAuth API keys', async () => {
      mockMessagesCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'response' }],
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      });

      const messages: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Test' }],
        },
      ];

      const providerWithNoStreaming = new AnthropicProvider(
        'test-api-key',
        undefined,
        {
          ...TEST_PROVIDER_CONFIG,
          getEphemeralSettings: () => ({
            ...settingsService.getAllGlobalSettings(),
            ...settingsService.getProviderSettings('anthropic'),
            streaming: 'disabled',
          }),
        },
      );

      const callOptions = createProviderCallOptions({
        providerName: 'anthropic',
        contents: messages,
        settings: settingsService,
        runtime: runtimeContext,
        config: runtimeContext.config!,
      });

      const generator =
        providerWithNoStreaming.generateChatCompletion(callOptions);
      await generator.next();

      const call =
        mockMessagesCreate.mock.calls[mockMessagesCreate.mock.calls.length - 1];
      expect(call).toBeDefined();

      const options = call[1];
      expect(options).toBeDefined();

      // Should NOT have User-Agent header for non-OAuth requests
      expect(options?.headers?.['User-Agent']).toBeUndefined();
    });

    it('should strip extra keys from text blocks', () => {
      const block = {
        type: 'text' as const,
        text: 'hello',
        spurious: true,
        _debug: 'leak',
      };
      const result = sanitizeBlockForCacheControl(block, '5m');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'text',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'text',
        text: 'hello',
        cache_control: { type: 'ephemeral', ttl: '5m' },
      });
    });

    it('should strip extra keys from tool_use blocks', () => {
      const block = {
        type: 'tool_use' as const,
        id: 'toolu_abc',
        name: 'read_file',
        input: { path: '/tmp/x' },
        _sdk_internal: 999,
      };
      const result = sanitizeBlockForCacheControl(block, '1h');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'id',
        'input',
        'name',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'tool_use',
        id: 'toolu_abc',
        name: 'read_file',
        input: { path: '/tmp/x' },
        cache_control: { type: 'ephemeral', ttl: '1h' },
      });
    });

    it('should strip extra keys from tool_result blocks and include is_error when present', () => {
      const block = {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_123',
        content: 'file data',
        is_error: true,
        extra_meta: 'should vanish',
      };
      const result = sanitizeBlockForCacheControl(block, '5m');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'content',
        'is_error',
        'tool_use_id',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'tool_result',
        tool_use_id: 'toolu_123',
        content: 'file data',
        is_error: true,
        cache_control: { type: 'ephemeral', ttl: '5m' },
      });
    });

    it('should omit is_error from tool_result when undefined', () => {
      const block = {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_456',
        content: 'ok',
      };
      const result = sanitizeBlockForCacheControl(block, '1h');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'content',
        'tool_use_id',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'tool_result',
        tool_use_id: 'toolu_456',
        content: 'ok',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      });
      expect('is_error' in result).toBe(false);
    });

    it('should preserve is_error: false on tool_result blocks', () => {
      const block = {
        type: 'tool_result' as const,
        tool_use_id: 'toolu_789',
        content: 'done',
        is_error: false,
      };
      const result = sanitizeBlockForCacheControl(block, '5m');
      expect(result).toMatchObject({ is_error: false });
    });

    it('should strip extra keys from thinking blocks', () => {
      const block = {
        type: 'thinking' as const,
        thinking: 'I am thinking...',
        signature: 'sig123',
        _internal: 'drop me',
      };
      const result = sanitizeBlockForCacheControl(block, '5m');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'signature',
        'thinking',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'thinking',
        thinking: 'I am thinking...',
        signature: 'sig123',
        cache_control: { type: 'ephemeral', ttl: '5m' },
      });
    });

    it('should omit signature from thinking blocks when undefined', () => {
      const block = {
        type: 'thinking' as const,
        thinking: 'pondering',
      };
      const result = sanitizeBlockForCacheControl(block, '1h');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'thinking',
        'type',
      ]);
      expect('signature' in result).toBe(false);
    });

    it('should strip extra keys from redacted_thinking blocks', () => {
      const block = {
        type: 'redacted_thinking' as const,
        data: 'base64data==',
        _extra: 'polluted',
      };
      const result = sanitizeBlockForCacheControl(block, '1h');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'data',
        'type',
      ]);
      expect(result).toStrictEqual({
        type: 'redacted_thinking',
        data: 'base64data==',
        cache_control: { type: 'ephemeral', ttl: '1h' },
      });
    });

    it('should handle unknown block types fail-safe without spreading keys', () => {
      const block = {
        type: 'unknown_future_type' as never,
        url: 'https://example.com/img.png',
        secretKey: 'should-not-appear',
      };
      const result = sanitizeBlockForCacheControl(block, '5m');
      // Should produce a minimal text fallback, not spread unknown keys
      expect(result.type).toBe('text');
      expect(Object.keys(result).sort()).toStrictEqual([
        'cache_control',
        'text',
        'type',
      ]);
      expect(result).not.toHaveProperty('url');
      expect(result).not.toHaveProperty('secretKey');
    });
  });
});
