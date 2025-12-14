/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue686
 * Bucket Failover Integration Tests for AnthropicProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AnthropicProvider } from './AnthropicProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { ProviderRuntimeContext } from '../types/providerRuntime.js';
import type { Config } from '../../config/config.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

interface BucketFailoverHandler {
  isEnabled(): boolean;
  tryFailover(): Promise<boolean>;
  getCurrentBucket(): string;
}

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(),
}));

// Mock the core prompts module
vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'test-system-prompt'),
}));

describe('AnthropicProvider - Bucket Failover Integration', () => {
  let provider: AnthropicProvider;
  let mockFailoverHandler: BucketFailoverHandler;
  let mockConfig: Config;
  let mockRuntime: ProviderRuntimeContext;
  let AnthropicMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Get the mocked Anthropic constructor
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    AnthropicMock = Anthropic as unknown as ReturnType<typeof vi.fn>;

    // Create mock bucket failover handler
    mockFailoverHandler = {
      isEnabled: vi.fn().mockReturnValue(true),
      tryFailover: vi.fn().mockResolvedValue(true),
      getCurrentBucket: vi.fn().mockReturnValue('bucket2'),
    };

    // Create mock config with bucket failover handler
    mockConfig = {
      getBucketFailoverHandler: vi.fn().mockReturnValue(mockFailoverHandler),
    } as unknown as Config;

    // Create mock runtime context
    mockRuntime = {
      runtimeId: 'test-runtime',
      config: mockConfig,
      metadata: {},
    } as unknown as ProviderRuntimeContext;

    // Create provider with test API key
    provider = new AnthropicProvider('test-api-key');
  });

  it(
    'should call bucket failover handler on persistent 429 errors',
    async () => {
      // Helper to create async iterable stream for Anthropic
      async function* createAnthropicStream() {
        yield {
          type: 'message_start',
          message: {
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [],
            model: 'claude-sonnet-4-5-20250929',
            usage: { input_tokens: 10, output_tokens: 0 },
          },
        };
        yield {
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        };
        yield {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: 'Success after failover' },
        };
        yield {
          type: 'content_block_stop',
          index: 0,
        };
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        };
        yield {
          type: 'message_stop',
        };
      }

      // Mock the Anthropic client to throw 429 errors initially, then succeed
      const mockCreate = vi
        .fn()
        .mockRejectedValueOnce({
          status: 429,
          message: 'Rate limit exceeded',
        })
        .mockRejectedValueOnce({
          status: 429,
          message: 'Rate limit exceeded',
        })
        .mockResolvedValueOnce(createAnthropicStream());

      // Mock the Anthropic constructor to return a client with our mocked create method
      AnthropicMock.mockImplementation(() => ({
        messages: {
          create: mockCreate,
        },
      }));

      const userContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      };

      const options = createProviderCallOptions({
        providerName: 'anthropic',
        contents: [userContent],
        runtime: mockRuntime,
      });

      // Execute the request - should trigger bucket failover after 2 consecutive 429s
      const responseGenerator = provider.generateChatCompletion(options);
      const responses: IContent[] = [];

      for await (const response of responseGenerator) {
        responses.push(response);
      }

      // Verify bucket failover was attempted
      expect(mockFailoverHandler.isEnabled).toHaveBeenCalled();
      expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
      expect(mockFailoverHandler.getCurrentBucket).toHaveBeenCalled();

      // Verify we got a successful response
      expect(responses.length).toBeGreaterThan(0);
      const textBlocks = responses.flatMap((r) =>
        r.blocks.filter((b) => b.type === 'text'),
      );
      expect(textBlocks.length).toBeGreaterThan(0);
    },
    { timeout: 10000 },
  );

  it(
    'should not attempt bucket failover when handler is disabled',
    async () => {
      // Disable the failover handler
      vi.mocked(mockFailoverHandler.isEnabled).mockReturnValue(false);

      const mockCreate = vi.fn().mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      AnthropicMock.mockImplementation(() => ({
        messages: {
          create: mockCreate,
        },
      }));

      const userContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      };

      const options = createProviderCallOptions({
        providerName: 'anthropic',
        contents: [userContent],
        runtime: mockRuntime,
      });

      // Should throw error without attempting failover
      await expect(async () => {
        const responseGenerator = provider.generateChatCompletion(options);
        for await (const _ of responseGenerator) {
          // Should not reach here
        }
      }).rejects.toThrow();

      // Verify handler was checked but not used
      expect(mockFailoverHandler.isEnabled).toHaveBeenCalled();
      expect(mockFailoverHandler.tryFailover).not.toHaveBeenCalled();
    },
    { timeout: 30000 },
  );

  it(
    'should not attempt bucket failover when no handler is configured',
    async () => {
      // Remove the failover handler from config
      const configWithoutHandler = {
        getBucketFailoverHandler: vi.fn().mockReturnValue(null),
      } as unknown as Config;

      const runtimeWithoutHandler = {
        ...mockRuntime,
        config: configWithoutHandler,
      };

      const mockCreate = vi.fn().mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      AnthropicMock.mockImplementation(() => ({
        messages: {
          create: mockCreate,
        },
      }));

      const userContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      };

      const options = createProviderCallOptions({
        providerName: 'anthropic',
        contents: [userContent],
        runtime: runtimeWithoutHandler,
      });

      // Should throw error without attempting failover
      await expect(async () => {
        const responseGenerator = provider.generateChatCompletion(options);
        for await (const _ of responseGenerator) {
          // Should not reach here
        }
      }).rejects.toThrow();

      // Verify handler getter was called but returned null
      expect(configWithoutHandler.getBucketFailoverHandler).toHaveBeenCalled();
    },
    { timeout: 30000 },
  );

  it('should stop retrying when bucket failover returns false (no more buckets)', async () => {
    // Failover handler indicates no more buckets available
    vi.mocked(mockFailoverHandler.tryFailover).mockResolvedValue(false);

    const mockCreate = vi.fn().mockRejectedValue({
      status: 429,
      message: 'Rate limit exceeded',
    });

    AnthropicMock.mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    }));

    const userContent: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = createProviderCallOptions({
      providerName: 'anthropic',
      contents: [userContent],
      runtime: mockRuntime,
    });

    // Should throw error after attempting failover
    await expect(async () => {
      const responseGenerator = provider.generateChatCompletion(options);
      for await (const _ of responseGenerator) {
        // Should not reach here
      }
    }).rejects.toThrow();

    // Verify failover was attempted but returned false
    expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
  });

  it('should reset retry counters after successful bucket failover', async () => {
    // Helper to create async iterable stream for Anthropic
    async function* createAnthropicStream() {
      yield {
        type: 'message_start',
        message: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Success' },
      };
      yield {
        type: 'content_block_stop',
        index: 0,
      };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      };
      yield {
        type: 'message_stop',
      };
    }

    // Mock client to fail twice, then succeed after bucket switch
    const mockCreate = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockResolvedValueOnce(createAnthropicStream());

    AnthropicMock.mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    }));

    const userContent: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = createProviderCallOptions({
      providerName: 'anthropic',
      contents: [userContent],
      runtime: mockRuntime,
    });

    const responseGenerator = provider.generateChatCompletion(options);
    const responses: IContent[] = [];

    for await (const response of responseGenerator) {
      responses.push(response);
    }

    // Should have succeeded after bucket failover
    expect(responses.length).toBeGreaterThan(0);
    expect(mockCreate).toHaveBeenCalledTimes(3);
    expect(mockFailoverHandler.tryFailover).toHaveBeenCalledTimes(1);
  });

  it('should pass authType to bucket failover callback', async () => {
    // Helper to create async iterable stream for Anthropic
    async function* createAnthropicStream() {
      yield {
        type: 'message_start',
        message: {
          id: 'msg_123',
          type: 'message',
          role: 'assistant',
          content: [],
          model: 'claude-sonnet-4-5-20250929',
          usage: { input_tokens: 10, output_tokens: 0 },
        },
      };
      yield {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'text', text: '' },
      };
      yield {
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'Success' },
      };
      yield {
        type: 'content_block_stop',
        index: 0,
      };
      yield {
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
        usage: { output_tokens: 5 },
      };
      yield {
        type: 'message_stop',
      };
    }

    // Mock the provider to use OAuth auth
    const mockCreate = vi
      .fn()
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
      .mockResolvedValueOnce(createAnthropicStream());

    AnthropicMock.mockImplementation(() => ({
      messages: {
        create: mockCreate,
      },
    }));

    const userContent: IContent = {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = createProviderCallOptions({
      providerName: 'anthropic',
      contents: [userContent],
      runtime: mockRuntime,
      resolved: {
        authToken: 'sk-ant-oat-mock-token',
      },
    });

    const responseGenerator = provider.generateChatCompletion(options);

    for await (const _ of responseGenerator) {
      // Consume the generator
    }

    // Verify bucket failover was called
    expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
  });
});
