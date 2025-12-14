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
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';

interface BucketFailoverHandler {
  isEnabled(): boolean;
  tryFailover(): Promise<boolean>;
  getCurrentBucket(): string;
}

// Mock the OpenAI SDK
vi.mock('openai', () => ({
  default: vi.fn(),
}));

// Mock the core prompts module
vi.mock('../../core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'test-system-prompt'),
}));

describe('OpenAIProvider - Bucket Failover Integration', () => {
  let provider: OpenAIProvider;
  let mockFailoverHandler: BucketFailoverHandler;
  let mockConfig: Config;
  let mockRuntime: ProviderRuntimeContext;
  let OpenAIMock: ReturnType<typeof vi.fn>;

  // Helper to create async iterable stream
  async function* createStream() {
    yield {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { role: 'assistant', content: 'Success' },
          finish_reason: null,
        },
      ],
    };
    yield {
      id: 'chatcmpl-123',
      object: 'chat.completion.chunk',
      created: Date.now(),
      model: 'gpt-4',
      choices: [
        {
          index: 0,
          delta: { content: ' after failover' },
          finish_reason: 'stop',
        },
      ],
    };
  }

  beforeEach(async () => {
    // Get the mocked OpenAI constructor
    const { default: OpenAI } = await import('openai');
    OpenAIMock = OpenAI as unknown as ReturnType<typeof vi.fn>;

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
    it(
      'should call bucket failover handler on persistent 429 errors',
      async () => {
        // Mock the OpenAI client to throw 429 errors initially, then succeed
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
          .mockResolvedValueOnce(createStream());

        OpenAIMock.mockImplementation(() => ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }));

        const userContent: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        };

        const options = createProviderCallOptions({
          providerName: 'openai',
          contents: [userContent],
          runtime: mockRuntime,
        });

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

        OpenAIMock.mockImplementation(() => ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }));

        const userContent: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        };

        // Use minimal retry attempts since failover is disabled
        // Need at least 3 retries: 2 to hit failover threshold, 1 more to check failover
        const options = createProviderCallOptions({
          providerName: 'openai',
          contents: [userContent],
          runtime: mockRuntime,
          settingsOverrides: {
            global: { retries: 3, retrywait: 10 },
          },
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
      { timeout: 5000 },
    );
  });

  describe('non-streaming mode', () => {
    it(
      'should call bucket failover handler on persistent 429 errors',
      async () => {
        // Helper to create async iterable stream (OpenAI defaults to streaming)
        async function* createStreamForNonStreaming() {
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: { role: 'assistant', content: 'Success' },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: { content: ' after failover' },
                finish_reason: 'stop',
              },
            ],
          };
        }

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
          .mockResolvedValueOnce(createStreamForNonStreaming());

        OpenAIMock.mockImplementation(() => ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }));

        const userContent: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        };

        const options = createProviderCallOptions({
          providerName: 'openai',
          contents: [userContent],
          runtime: mockRuntime,
        });

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
      },
      { timeout: 10000 },
    );
  });

  describe('tools mode', () => {
    it(
      'should call bucket failover handler in tools processing',
      async () => {
        // Helper to create async iterable stream with tool calls
        async function* createStreamWithTools() {
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: {
                  role: 'assistant',
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      type: 'function',
                      function: {
                        name: 'test_tool',
                        arguments: '',
                      },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          };
          yield {
            id: 'chatcmpl-123',
            object: 'chat.completion.chunk',
            created: Date.now(),
            model: 'gpt-4',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: {
                        arguments: '{}',
                      },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
          };
        }

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
          .mockResolvedValueOnce(createStreamWithTools());

        OpenAIMock.mockImplementation(() => ({
          chat: {
            completions: {
              create: mockCreate,
            },
          },
        }));

        const userContent: IContent = {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        };

        const options = createProviderCallOptions({
          providerName: 'openai',
          contents: [userContent],
          runtime: mockRuntime,
          tools: [
            {
              name: 'test_tool',
              description: 'Test tool',
              functionDeclarations: [
                {
                  name: 'test_tool',
                  description: 'Test tool',
                  parameters: {
                    type: 'object' as const,
                    properties: {},
                  },
                },
              ],
            },
          ],
        });

        const responseGenerator = provider.generateChatCompletion(options);

        for await (const _ of responseGenerator) {
          // Consume the generator
        }

        // Verify bucket failover was attempted
        expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
      },
      { timeout: 10000 },
    );
  });

  it(
    'should stop retrying when bucket failover returns false',
    async () => {
      // Failover handler indicates no more buckets available
      vi.mocked(mockFailoverHandler.tryFailover).mockResolvedValue(false);

      const mockCreate = vi.fn().mockRejectedValue({
        status: 429,
        message: 'Rate limit exceeded',
      });

      OpenAIMock.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      }));

      const userContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      };

      const options = createProviderCallOptions({
        providerName: 'openai',
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
    },
    { timeout: 10000 },
  );

  it(
    'should pass authType to bucket failover callback',
    async () => {
      // Helper to create async iterable stream
      async function* createStreamForAuthTest() {
        yield {
          id: 'chatcmpl-123',
          object: 'chat.completion.chunk',
          created: Date.now(),
          model: 'gpt-4',
          choices: [
            {
              index: 0,
              delta: { role: 'assistant', content: 'Success' },
              finish_reason: 'stop',
            },
          ],
        };
      }

      const mockCreate = vi
        .fn()
        .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
        .mockRejectedValueOnce({ status: 429, message: 'Rate limit' })
        .mockResolvedValueOnce(createStreamForAuthTest());

      OpenAIMock.mockImplementation(() => ({
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      }));

      const userContent: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'Hello' }],
      };

      const options = createProviderCallOptions({
        providerName: 'openai',
        contents: [userContent],
        runtime: mockRuntime,
      });

      const responseGenerator = provider.generateChatCompletion(options);

      for await (const _ of responseGenerator) {
        // Consume the generator
      }

      // Verify bucket failover was called
      expect(mockFailoverHandler.tryFailover).toHaveBeenCalled();
    },
    { timeout: 10000 },
  );
});
