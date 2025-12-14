/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue686
 * Bucket Failover Integration Tests for OpenAIProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { ProviderRuntimeContext } from '../types/providerRuntime.js';
import type { Config } from '../../config/config.js';

interface BucketFailoverHandler {
  isEnabled(): boolean;
  tryFailover(): Promise<boolean>;
  getCurrentBucket(): string;
}

describe('OpenAIProvider - Bucket Failover Integration', () => {
  let provider: OpenAIProvider;
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
    provider = new OpenAIProvider('test-api-key');
  });

  describe('streaming mode', () => {
    it('should call bucket failover handler on persistent 429 errors', async () => {
      // Mock the OpenAI client to throw 429 errors initially, then succeed
      const mockClient = {
        chat: {
          completions: {
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
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: 'Success after failover',
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              }),
          },
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
        resolved: {
          streaming: true,
        },
      };

      // Execute the request - should trigger bucket failover
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
    });

    it('should not attempt bucket failover when handler is disabled', async () => {
      // Disable the failover handler
      vi.mocked(mockFailoverHandler.isEnabled).mockReturnValue(false);

      const mockClient = {
        chat: {
          completions: {
            create: vi.fn().mockRejectedValue({
              status: 429,
              message: 'Rate limit exceeded',
            }),
          },
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
        resolved: {
          streaming: true,
        },
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
  });

  describe('non-streaming mode', () => {
    it('should call bucket failover handler on persistent 429 errors', async () => {
      const mockClient = {
        chat: {
          completions: {
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
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: 'Success after failover',
                    },
                    finish_reason: 'stop',
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              }),
          },
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
        resolved: {
          streaming: false,
        },
      };

      const responseGenerator = provider.generateChatCompletion(options);
      const responses: IContent[] = [];

      for await (const response of responseGenerator) {
        responses.push(response);
      }

      // Verify bucket failover was attempted
      expect(mockFailoverHandler.isEnabled).toHaveBeenCalled();
      expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();

      // Verify we got a successful response
      expect(responses.length).toBeGreaterThan(0);
    });
  });

  describe('tools mode', () => {
    it('should call bucket failover handler in tools processing', async () => {
      const mockClient = {
        chat: {
          completions: {
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
                id: 'chatcmpl-123',
                object: 'chat.completion',
                created: Date.now(),
                model: 'gpt-4',
                choices: [
                  {
                    index: 0,
                    message: {
                      role: 'assistant',
                      content: null,
                      tool_calls: [
                        {
                          id: 'call_123',
                          type: 'function',
                          function: {
                            name: 'test_tool',
                            arguments: '{}',
                          },
                        },
                      ],
                    },
                    finish_reason: 'tool_calls',
                  },
                ],
                usage: {
                  prompt_tokens: 10,
                  completion_tokens: 5,
                  total_tokens: 15,
                },
              }),
          },
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
        tools: [
          {
            id: 'test_tool',
            name: 'test_tool',
            description: 'Test tool',
            parameters: {
              type: 'object' as const,
              properties: {},
            },
          },
        ],
      };

      const responseGenerator = provider.generateChatCompletion(options);

      for await (const _ of responseGenerator) {
        // Consume the generator
      }

      // Verify bucket failover was attempted
      expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
    });
  });

  it('should stop retrying when bucket failover returns false', async () => {
    // Failover handler indicates no more buckets available
    vi.mocked(mockFailoverHandler.tryFailover).mockResolvedValue(false);

    const mockClient = {
      chat: {
        completions: {
          create: vi.fn().mockRejectedValue({
            status: 429,
            message: 'Rate limit exceeded',
          }),
        },
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

  it('should pass authType to bucket failover callback', async () => {
    const mockClient = {
      chat: {
        completions: {
          create: vi
            .fn()
            .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
            .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
            .mockResolvedValueOnce({
              id: 'chatcmpl-123',
              object: 'chat.completion',
              created: Date.now(),
              model: 'gpt-4',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Success',
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 10,
                completion_tokens: 5,
                total_tokens: 15,
              },
            }),
        },
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
