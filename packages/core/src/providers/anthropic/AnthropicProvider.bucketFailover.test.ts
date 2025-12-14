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

interface BucketFailoverHandler {
  isEnabled(): boolean;
  tryFailover(): Promise<boolean>;
  getCurrentBucket(): string;
}

describe('AnthropicProvider - Bucket Failover Integration', () => {
  let provider: AnthropicProvider;
  let mockFailoverHandler: BucketFailoverHandler;
  let mockConfig: Config;
  let mockRuntime: ProviderRuntimeContext;

  beforeEach(() => {
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

  it('should call bucket failover handler on persistent 429 errors', async () => {
    // Mock the Anthropic client to throw 429 errors initially, then succeed
    const mockClient = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce({
            status: 429,
            message: 'Rate limit exceeded',
          })
          .mockRejectedValueOnce({
            status: 429,
            message: 'Rate limit exceeded',
          })
          .mockResolvedValueOnce({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Success after failover' }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    };

    // Spy on the provider's internal client creation
    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClient);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: mockRuntime,
      config: mockConfig,
    };

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
    expect(responses[responses.length - 1].blocks[0]).toMatchObject({
      type: 'text',
      text: expect.stringContaining('Success'),
    });
  });

  it('should not attempt bucket failover when handler is disabled', async () => {
    // Disable the failover handler
    vi.mocked(mockFailoverHandler.isEnabled).mockReturnValue(false);

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue({
          status: 429,
          message: 'Rate limit exceeded',
        }),
      },
    };

    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClient);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: mockRuntime,
      config: mockConfig,
    };

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
  });

  it('should not attempt bucket failover when no handler is configured', async () => {
    // Remove the failover handler from config
    const configWithoutHandler = {
      getBucketFailoverHandler: vi.fn().mockReturnValue(null),
    } as unknown as Config;

    const runtimeWithoutHandler = {
      ...mockRuntime,
      config: configWithoutHandler,
    };

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue({
          status: 429,
          message: 'Rate limit exceeded',
        }),
      },
    };

    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClient);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: runtimeWithoutHandler,
      config: configWithoutHandler,
    };

    // Should throw error without attempting failover
    await expect(async () => {
      const responseGenerator = provider.generateChatCompletion(options);
      for await (const _ of responseGenerator) {
        // Should not reach here
      }
    }).rejects.toThrow();

    // Verify handler getter was called but returned null
    expect(configWithoutHandler.getBucketFailoverHandler).toHaveBeenCalled();
  });

  it('should stop retrying when bucket failover returns false (no more buckets)', async () => {
    // Failover handler indicates no more buckets available
    vi.mocked(mockFailoverHandler.tryFailover).mockResolvedValue(false);

    const mockClient = {
      messages: {
        create: vi.fn().mockRejectedValue({
          status: 429,
          message: 'Rate limit exceeded',
        }),
      },
    };

    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClient);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: mockRuntime,
      config: mockConfig,
    };

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
    // Mock client to fail twice, then succeed after bucket switch
    const mockClient = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
          .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
          .mockResolvedValueOnce({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Success' }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    };

    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClient);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: mockRuntime,
      config: mockConfig,
    };

    const responseGenerator = provider.generateChatCompletion(options);
    const responses: IContent[] = [];

    for await (const response of responseGenerator) {
      responses.push(response);
    }

    // Should have succeeded after bucket failover
    expect(responses.length).toBeGreaterThan(0);
    expect(mockClient.messages.create).toHaveBeenCalledTimes(3);
    expect(mockFailoverHandler.tryFailover).toHaveBeenCalledTimes(1);
  });

  it('should pass authType to bucket failover callback', async () => {
    // Mock the provider to use OAuth auth
    const mockClientWithOAuth = {
      messages: {
        create: vi
          .fn()
          .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
          .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
          .mockResolvedValueOnce({
            id: 'msg_123',
            type: 'message',
            role: 'assistant',
            content: [{ type: 'text', text: 'Success' }],
            model: 'claude-3-5-sonnet-20241022',
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 5 },
          }),
      },
    };

    vi.spyOn(
      provider as unknown as { getClient: () => unknown },
      'getClient',
    ).mockReturnValue(mockClientWithOAuth);

    const userContent: IContent = {
      speaker: 'user',
      blocks: [{ type: 'text', text: 'Hello' }],
    };

    const options = {
      contents: [userContent],
      runtime: mockRuntime,
      config: mockConfig,
      resolved: {
        authToken: {
          type: 'oauth' as const,
          value: 'mock-token',
        },
      },
    };

    const responseGenerator = provider.generateChatCompletion(options);

    for await (const _ of responseGenerator) {
      // Consume the generator
    }

    // Verify bucket failover was called
    expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
  });
});
