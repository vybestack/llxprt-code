/**
 * Copyright 2025 Vybestack LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OpenAIProvider } from './OpenAIProvider.js';
import { ContentGeneratorRole } from '../ContentGeneratorRole.js';
import { TEST_PROVIDER_CONFIG } from '../test-utils/providerTestConfig.js';
import type { ITool } from '../ITool.js';

// Mock OpenAI module
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: vi.fn(),
      },
    },
    models: {
      list: vi.fn(),
    },
  })),
}));

// Mock SettingsService
vi.mock('../../settings/settingsServiceInstance.js', () => ({
  getSettingsService: vi.fn(),
}));

describe('OpenAIProvider', () => {
  let provider: OpenAIProvider;
  let mockOpenAIInstance: {
    chat: { completions: { create: ReturnType<typeof vi.fn> } };
    models: { list: ReturnType<typeof vi.fn> };
  };
  let capturedApiParams: unknown;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = new OpenAIProvider(
      'test-api-key',
      undefined,
      TEST_PROVIDER_CONFIG,
    );
    // Set a model that doesn't use the Responses API
    provider.setModel('gpt-3.5-turbo');
    // Get the mocked OpenAI instance (typed as unknown then cast)
    mockOpenAIInstance = (
      provider as unknown as { openai: typeof mockOpenAIInstance }
    ).openai; // Cast for test

    // Reset captured params
    capturedApiParams = undefined;
  });

  describe('generateChatCompletion with usage tracking', () => {
    it('should include stream_options with include_usage', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
          };
          yield {
            choices: [{ delta: { content: ' world' } }],
            usage: {
              prompt_tokens: 10,
              completion_tokens: 5,
              total_tokens: 15,
            },
          };
        },
      };

      // Capture the parameters passed to the API
      mockOpenAIInstance.chat.completions.create.mockImplementation(
        async (params) => {
          capturedApiParams = params;
          return mockStream;
        },
      );

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Hi' }];

      const generator = provider.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Test the actual parameters that would be sent to the API
      expect(capturedApiParams).toBeDefined();
      const apiParams = capturedApiParams as Record<string, unknown>;
      expect(apiParams.stream).toBe(true);
      expect(apiParams.stream_options).toEqual({ include_usage: true });
    });

    it('should yield usage data when provided in stream', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Test response' } }],
          };
          yield {
            choices: [{ delta: {} }],
            usage: {
              prompt_tokens: 20,
              completion_tokens: 10,
              total_tokens: 30,
            },
          };
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockStream);

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];

      const generator = provider.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Should have content chunk and usage chunk
      expect(results).toHaveLength(2);

      // Check content chunk
      expect(results[0]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: 'Test response',
      });

      // Check usage chunk
      expect(results[1]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        usage: {
          prompt_tokens: 20,
          completion_tokens: 10,
          total_tokens: 30,
        },
      });
    });

    it('should handle usage data with tool calls', async () => {
      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: 'call_123',
                      function: {
                        name: 'test_tool',
                        arguments: '{"param": "value"}',
                      },
                    },
                  ],
                },
              },
            ],
          };
          yield {
            choices: [{ delta: {} }],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 25,
              total_tokens: 75,
            },
          };
        },
      };

      mockOpenAIInstance.chat.completions.create.mockResolvedValue(mockStream);

      const messages = [
        { role: ContentGeneratorRole.USER, content: 'Use a tool' },
      ];
      const tools = [
        {
          type: 'function' as const,
          function: {
            name: 'test_tool',
            parameters: { type: 'object', properties: {} },
          },
        },
      ];

      const generator = provider.generateChatCompletion(messages, tools);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Should yield tool call with usage data
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        role: ContentGeneratorRole.ASSISTANT,
        content: '',
        tool_calls: [
          {
            id: 'call_123',
            type: 'function',
            function: {
              name: 'test_tool',
              arguments: '{"param": "value"}',
            },
          },
        ],
        usage: {
          prompt_tokens: 50,
          completion_tokens: 25,
          total_tokens: 75,
        },
      });
    });
  });

  describe('stream_options ephemeral settings', () => {
    it('should omit stream_options when set to null via ephemeral settings', async () => {
      // Create provider with config that returns null for stream-options
      const configWithNullStreamOptions = {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({ 'stream-options': null }),
      };
      const providerWithNullStreamOptions = new OpenAIProvider(
        'test-key',
        undefined,
        configWithNullStreamOptions,
      );
      providerWithNullStreamOptions.setModel('gpt-3.5-turbo');

      const mockInstance = (
        providerWithNullStreamOptions as unknown as {
          openai: typeof mockOpenAIInstance;
        }
      ).openai;

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
          };
        },
      };

      let localCapturedParams: unknown;
      mockInstance.chat.completions.create.mockImplementation(
        async (params) => {
          localCapturedParams = params;
          return mockStream;
        },
      );

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];
      const generator =
        providerWithNullStreamOptions.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify stream_options is NOT included when set to null
      expect(localCapturedParams).toBeDefined();
      const apiParams = localCapturedParams as Record<string, unknown>;
      expect(apiParams.stream).toBe(true);
      expect(apiParams).not.toHaveProperty('stream_options');
    });

    it('should use custom stream_options from ephemeral settings', async () => {
      // Create provider with custom stream_options
      const configWithCustomStreamOptions = {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({
          'stream-options': { include_usage: false, custom_field: true },
        }),
      };
      const providerWithCustomStreamOptions = new OpenAIProvider(
        'test-key',
        undefined,
        configWithCustomStreamOptions,
      );
      providerWithCustomStreamOptions.setModel('gpt-3.5-turbo');

      const mockInstance = (
        providerWithCustomStreamOptions as unknown as {
          openai: typeof mockOpenAIInstance;
        }
      ).openai;

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
          };
        },
      };

      let localCapturedParams: unknown;
      mockInstance.chat.completions.create.mockImplementation(
        async (params) => {
          localCapturedParams = params;
          return mockStream;
        },
      );

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];
      const generator =
        providerWithCustomStreamOptions.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify custom stream_options is used
      expect(localCapturedParams).toBeDefined();
      const apiParams = localCapturedParams as Record<string, unknown>;
      expect(apiParams.stream).toBe(true);
      expect(apiParams.stream_options).toEqual({
        include_usage: false,
        custom_field: true,
      });
    });

    it('should use default stream_options when ephemeral setting is undefined', async () => {
      // Create provider with no stream-options in ephemeral settings
      const configWithoutStreamOptions = {
        ...TEST_PROVIDER_CONFIG,
        getEphemeralSettings: () => ({}), // No stream-options key
      };
      const providerWithDefaults = new OpenAIProvider(
        'test-key',
        undefined,
        configWithoutStreamOptions,
      );
      providerWithDefaults.setModel('gpt-3.5-turbo');

      const mockInstance = (
        providerWithDefaults as unknown as { openai: typeof mockOpenAIInstance }
      ).openai;

      const mockStream = {
        async *[Symbol.asyncIterator]() {
          yield {
            choices: [{ delta: { content: 'Hello' } }],
          };
        },
      };

      let localCapturedParams: unknown;
      mockInstance.chat.completions.create.mockImplementation(
        async (params) => {
          localCapturedParams = params;
          return mockStream;
        },
      );

      const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];
      const generator = providerWithDefaults.generateChatCompletion(messages);
      const results: unknown[] = [];
      for await (const chunk of generator) {
        results.push(chunk);
      }

      // Verify default stream_options is used
      expect(localCapturedParams).toBeDefined();
      const apiParams = localCapturedParams as Record<string, unknown>;
      expect(apiParams.stream).toBe(true);
      expect(apiParams.stream_options).toEqual({ include_usage: true });
    });
  });

  describe('model management', () => {
    it('should set and get current model', () => {
      // We set it to gpt-3.5-turbo in beforeEach to avoid Responses API
      expect(provider.getCurrentModel()).toBe('gpt-3.5-turbo');

      provider.setModel('gpt-4o');
      expect(provider.getCurrentModel()).toBe('gpt-4o');
    });
  });

  describe('configuration methods', () => {
    it('should update API key', () => {
      const newKey = 'new-test-key';
      provider.setApiKey(newKey);

      // Verify that API key was set (we can't access private property directly)
      // Just verify the method doesn't throw
      expect(() => provider.setApiKey(newKey)).not.toThrow();
    });

    it('should accept empty API key', () => {
      // Should not throw error for empty API key
      expect(() => provider.setApiKey('')).not.toThrow();
      expect(() => provider.setApiKey('  ')).not.toThrow();
    });

    it('should update base URL', () => {
      const newUrl = 'https://custom.openai.com';
      provider.setBaseUrl(newUrl);

      // Verify new OpenAI instance was created with base URL
      expect((provider as unknown as { baseURL?: string }).baseURL).toBe(
        newUrl,
      );
    });
  });

  describe('model parameters functionality', () => {
    describe('setting and getting model parameters', () => {
      it('should store model parameters when set', () => {
        // When I set model parameters
        provider.setModelParams({ temperature: 0.7 });

        // Then they should be retrievable
        const params = provider.getModelParams();
        expect(params).toEqual({ temperature: 0.7 });
      });

      it('should return undefined when no model parameters are set', () => {
        // Given a fresh provider with no parameters set
        const freshProvider = new OpenAIProvider(
          'test-key',
          undefined,
          TEST_PROVIDER_CONFIG,
        );

        // When I get model parameters
        const params = freshProvider.getModelParams();

        // Then it should return undefined
        expect(params).toBeUndefined();
      });

      it('should merge new parameters with existing ones instead of replacing', () => {
        // Given I have set some initial parameters
        provider.setModelParams({ temperature: 0.7, max_tokens: 1000 });

        // When I set additional parameters
        provider.setModelParams({ top_p: 0.9, temperature: 0.5 });

        // Then all parameters should be merged with new values overriding old
        const params = provider.getModelParams();
        expect(params).toEqual({
          temperature: 0.5, // Updated value
          max_tokens: 1000, // Retained from first call
          top_p: 0.9, // New parameter
        });
      });

      it('should accept any parameter names without validation', () => {
        // When I set various parameter types including unknown ones
        provider.setModelParams({
          temperature: 0.8,
          max_tokens: 2048,
          top_p: 0.95,
          unknown_param: 'should_work',
          nested_object: { key: 'value' },
          numeric_string: '123',
        });

        // Then all parameters should be stored as-is
        const params = provider.getModelParams();
        expect(params).toEqual({
          temperature: 0.8,
          max_tokens: 2048,
          top_p: 0.95,
          unknown_param: 'should_work',
          nested_object: { key: 'value' },
          numeric_string: '123',
        });
      });
    });

    describe('passing parameters to OpenAI API', () => {
      it('should include model parameters in chat completions API call', async () => {
        // Given I have set model parameters
        provider.setModelParams({
          temperature: 0.7,
          max_tokens: 2000,
          top_p: 0.9,
        });

        // And the API returns a response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response' } }],
            };
          },
        };

        // Capture the parameters passed to the API
        let localCapturedParams: unknown;
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            localCapturedParams = params;
            return mockStream;
          },
        );

        // When I generate a chat completion
        const messages = [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
        ];
        const generator = provider.generateChatCompletion(messages);
        const results: unknown[] = [];
        for await (const chunk of generator) {
          results.push(chunk);
        }

        // Then the API should receive the model parameters
        expect(localCapturedParams).toBeDefined();
        const apiParams = localCapturedParams as Record<string, unknown>;
        expect(apiParams.temperature).toBe(0.7);
        expect(apiParams.max_tokens).toBe(2000);
        expect(apiParams.top_p).toBe(0.9);
        expect(apiParams.model).toBe('gpt-3.5-turbo');
        expect(apiParams.messages).toEqual(messages);
        expect(apiParams.stream).toBe(true);
        expect(apiParams.stream_options).toEqual({ include_usage: true });
      });

      it('should make API calls without parameters when none are set', async () => {
        // Given no model parameters are set (fresh provider)
        const freshProvider = new OpenAIProvider(
          'test-key',
          undefined,
          TEST_PROVIDER_CONFIG,
        );
        freshProvider.setModel('gpt-3.5-turbo');
        const freshMockInstance = (
          freshProvider as unknown as { openai: typeof mockOpenAIInstance }
        ).openai;

        // And the API returns a response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response' } }],
            };
          },
        };

        // Capture the parameters passed to the API
        let localCapturedParams: unknown;
        freshMockInstance.chat.completions.create.mockImplementation(
          async (params) => {
            localCapturedParams = params;
            return mockStream;
          },
        );

        // When I generate a chat completion
        const messages = [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
        ];
        const generator = freshProvider.generateChatCompletion(messages);
        const results: unknown[] = [];
        for await (const chunk of generator) {
          results.push(chunk);
        }

        // Then the API should be called without extra parameters
        expect(localCapturedParams).toBeDefined();
        const apiParams = localCapturedParams as Record<string, unknown>;
        expect(apiParams).not.toHaveProperty('temperature');
        expect(apiParams).not.toHaveProperty('max_tokens');
        expect(apiParams).not.toHaveProperty('top_p');
      });

      it('should pass multiple model parameters correctly to the API', async () => {
        // Given I have set multiple diverse parameters
        provider.setModelParams({
          temperature: 0.5,
          max_tokens: 4096,
          top_p: 0.95,
          presence_penalty: 0.1,
          frequency_penalty: 0.2,
          seed: 12345,
        });

        // And the API returns a response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response' } }],
            };
          },
        };

        // Capture the parameters passed to the API
        let localCapturedParams: unknown;
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            localCapturedParams = params;
            return mockStream;
          },
        );

        // When I generate a chat completion
        const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];
        const generator = provider.generateChatCompletion(messages);
        for await (const _chunk of generator) {
          // consume the generator
        }

        // Then all parameters should be passed to the API
        expect(localCapturedParams).toBeDefined();
        const apiParams = localCapturedParams as Record<string, unknown>;
        expect(apiParams.temperature).toBe(0.5);
        expect(apiParams.max_tokens).toBe(4096);
        expect(apiParams.top_p).toBe(0.95);
        expect(apiParams.presence_penalty).toBe(0.1);
        expect(apiParams.frequency_penalty).toBe(0.2);
        expect(apiParams.seed).toBe(12345);
      });

      it('should pass unknown parameters through to the API without validation', async () => {
        // Given I set parameters that might not be standard OpenAI params
        provider.setModelParams({
          custom_param: 'custom_value',
          experimental_feature: true,
          vendor_specific: { nested: 'data' },
        });

        // And the API returns a response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response' } }],
            };
          },
        };

        // Capture the parameters passed to the API
        let localCapturedParams: unknown;
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            localCapturedParams = params;
            return mockStream;
          },
        );

        // When I generate a chat completion
        const messages = [{ role: ContentGeneratorRole.USER, content: 'Test' }];
        const generator = provider.generateChatCompletion(messages);
        for await (const _chunk of generator) {
          // consume the generator
        }

        // Then unknown parameters should be passed through
        expect(localCapturedParams).toBeDefined();
        const apiParams = localCapturedParams as Record<string, unknown>;
        expect(apiParams.custom_param).toBe('custom_value');
        expect(apiParams.experimental_feature).toBe(true);
        expect(apiParams.vendor_specific).toEqual({ nested: 'data' });
      });

      it('should use model parameters across multiple API calls', async () => {
        // Given I set model parameters once
        provider.setModelParams({ temperature: 0.8 });

        // And the API returns responses
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response' } }],
            };
          },
        };

        // Capture parameters from multiple calls
        const capturedParamsArray: unknown[] = [];
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            capturedParamsArray.push(params);
            return mockStream;
          },
        );

        // When I make multiple API calls
        const messages = [
          { role: ContentGeneratorRole.USER, content: 'Hello' },
        ];

        // First call
        const generator1 = provider.generateChatCompletion(messages);
        for await (const _chunk of generator1) {
          // consume
        }

        // Second call
        const generator2 = provider.generateChatCompletion(messages);
        for await (const _chunk of generator2) {
          // consume
        }

        // Then both calls should include the parameters
        expect(capturedParamsArray).toHaveLength(2);
        const firstCallParams = capturedParamsArray[0] as Record<
          string,
          unknown
        >;
        const secondCallParams = capturedParamsArray[1] as Record<
          string,
          unknown
        >;
        expect(firstCallParams.temperature).toBe(0.8);
        expect(secondCallParams.temperature).toBe(0.8);
      });

      it('should work correctly with common OpenAI parameters', async () => {
        // Given I set common OpenAI parameters
        provider.setModelParams({
          temperature: 0.7, // Controls randomness
          max_tokens: 2048, // Maximum response length
          top_p: 0.9, // Nucleus sampling
          presence_penalty: 0.5, // Penalize repeated topics
          frequency_penalty: 0.3, // Penalize repeated tokens
        });

        // And the API returns a response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Creative response' } }],
            };
          },
        };

        // Capture the parameters passed to the API
        let localCapturedParams: unknown;
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            localCapturedParams = params;
            return mockStream;
          },
        );

        // When I generate a chat completion
        const messages = [
          {
            role: ContentGeneratorRole.USER,
            content: 'Write something creative',
          },
        ];
        const generator = provider.generateChatCompletion(messages);
        const results: unknown[] = [];
        for await (const chunk of generator) {
          results.push(chunk);
        }

        // Then the response should be generated with all parameters
        expect(results[0]).toMatchObject({
          role: ContentGeneratorRole.ASSISTANT,
          content: 'Creative response',
        });

        // And all parameters should have been passed to the API
        expect(localCapturedParams).toBeDefined();
        const apiParams = localCapturedParams as Record<string, unknown>;
        expect(apiParams.temperature).toBe(0.7);
        expect(apiParams.max_tokens).toBe(2048);
        expect(apiParams.top_p).toBe(0.9);
        expect(apiParams.presence_penalty).toBe(0.5);
        expect(apiParams.frequency_penalty).toBe(0.3);
      });
    });
  });

  describe('GLM-4.5 Tool Format Detection and Conversion', () => {
    // Import the getSettingsService mock
    let mockGetSettingsService: ReturnType<typeof vi.fn>;

    beforeEach(async () => {
      const { getSettingsService } = vi.mocked(
        await import('../../settings/settingsServiceInstance.js'),
      );
      mockGetSettingsService = getSettingsService;
    });

    describe('detectToolFormat', () => {
      it('should return "qwen" for glm-4.5 model', () => {
        // Given a provider with GLM-4.5 model
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService to return no override (auto-detect)
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {
                toolFormat: 'auto',
              },
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should return 'qwen'
        expect(format).toBe('qwen');
      });

      it('should return "qwen" for glm-4-5 model with dash', () => {
        // Given a provider with GLM-4-5 model (dash variant)
        provider.setModel('glm-4-5-turbo');

        // Mock SettingsService to return no override
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {
                toolFormat: 'auto',
              },
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should return 'qwen'
        expect(format).toBe('qwen');
      });

      it('should return "qwen" for qwen models', () => {
        // Given a provider with Qwen model
        provider.setModel('qwen2.5-72b-instruct');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should return 'qwen'
        expect(format).toBe('qwen');
      });

      it('should return "openai" for gpt models', () => {
        // Given a provider with GPT model
        provider.setModel('gpt-4o');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should return 'openai'
        expect(format).toBe('openai');
      });

      it('should respect toolFormat setting override', () => {
        // Given a provider with GLM model but explicit OpenAI format setting
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService to return explicit override
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {
                toolFormat: 'openai',
              },
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should respect the override and return 'openai'
        expect(format).toBe('openai');
      });

      it('should fallback to model-based detection when SettingsService fails', () => {
        // Given a provider with GLM model
        provider.setModel('glm-4.5-chat');

        // Mock SettingsService to throw an error
        mockGetSettingsService.mockImplementation(() => {
          throw new Error('Settings access failed');
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should still detect 'qwen' based on model name
        expect(format).toBe('qwen');
      });

      it('should return "openai" as default for unknown models', () => {
        // Given a provider with unknown model
        provider.setModel('unknown-model-v1');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I detect tool format
        const format = provider.detectToolFormat();

        // Then it should default to 'openai'
        expect(format).toBe('openai');
      });
    });

    describe('formatToolsForAPI', () => {
      const sampleTools: ITool[] = [
        {
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather information',
            parameters: {
              type: 'object',
              properties: {
                location: {
                  type: 'string',
                  description: 'The city and state',
                },
              },
              required: ['location'],
            },
          },
        },
        {
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Perform mathematical calculations',
            parameters: {
              type: 'object',
              properties: {
                expression: {
                  type: 'string',
                  description: 'Mathematical expression to evaluate',
                },
              },
              required: ['expression'],
            },
          },
        },
      ];

      it('should convert to OpenAI format for GLM models (pending Qwen format implementation)', () => {
        // Given a provider with GLM model
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I format tools for API
        const formattedTools = provider.formatToolsForAPI(sampleTools);

        // Then tools should currently be in OpenAI format (TODO: convert to Qwen format)
        // The current implementation always uses OpenAI format through ToolFormatter
        expect(Array.isArray(formattedTools)).toBe(true);
        const tools = formattedTools as Array<Record<string, unknown>>;
        expect(tools).toHaveLength(2);

        // Verify the structure is OpenAI format (with type/function wrapper)
        expect(tools[0]).toMatchObject({
          type: 'function',
          function: {
            name: 'get_weather',
            description: 'Get current weather information',
          },
        });

        expect(tools[1]).toMatchObject({
          type: 'function',
          function: {
            name: 'calculate',
            description: 'Perform mathematical calculations',
          },
        });
      });

      it('should keep OpenAI format for GPT models', () => {
        // Given a provider with GPT model
        provider.setModel('gpt-4o');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I format tools for API
        const formattedTools = provider.formatToolsForAPI(sampleTools);

        // Then tools should remain in OpenAI format (with type/function wrapper)
        // The ToolFormatter.toProviderFormat should be called for 'openai' format
        expect(Array.isArray(formattedTools)).toBe(true);
        // Note: The exact format depends on ToolFormatter implementation
        // but it should not be the flat Qwen format
      });

      it('should handle tools with missing descriptions in OpenAI format', () => {
        // Given tools without descriptions
        const toolsWithoutDesc: ITool[] = [
          {
            type: 'function',
            function: {
              name: 'simple_function',
              parameters: {
                type: 'object',
                properties: {},
              },
            },
          },
        ];

        // And a GLM model
        provider.setModel('glm-4-5-chat');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I format tools for API
        const formattedTools = provider.formatToolsForAPI(toolsWithoutDesc);

        // Then it should be in OpenAI format with undefined description
        expect(Array.isArray(formattedTools)).toBe(true);
        const tools = formattedTools as Array<Record<string, unknown>>;
        expect(tools).toHaveLength(1);
        expect(tools[0]).toMatchObject({
          type: 'function',
          function: {
            name: 'simple_function',
            description: undefined,
          },
        });
      });

      it('should respect toolFormat override when formatting', () => {
        // Given a GLM model with OpenAI format override
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService to override to OpenAI format
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {
                toolFormat: 'openai',
              },
            },
          },
        });

        // When I format tools for API
        const formattedTools = provider.formatToolsForAPI(sampleTools);

        // Then it should use ToolFormatter instead of Qwen conversion
        expect(Array.isArray(formattedTools)).toBe(true);
        // Should not be the flat Qwen format since override is 'openai'
        const firstTool = (formattedTools as unknown[])[0] as Record<
          string,
          unknown
        >;
        expect(firstTool).not.toHaveProperty('name');
        expect(firstTool).not.toHaveProperty('description');
        expect(firstTool).not.toHaveProperty('parameters');
      });

      it('should handle empty tools array', () => {
        // Given empty tools array
        const emptyTools: ITool[] = [];

        // And a GLM model
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // When I format tools for API
        const formattedTools = provider.formatToolsForAPI(emptyTools);

        // Then it should return empty array
        expect(formattedTools).toEqual([]);
      });
    });

    describe('integration with chat completions', () => {
      it('should pass correctly formatted tools to API for GLM models (currently OpenAI format)', async () => {
        // Given a GLM model
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // And sample tools
        const tools: ITool[] = [
          {
            type: 'function',
            function: {
              name: 'test_tool',
              description: 'A test tool',
              parameters: { type: 'object', properties: {} },
            },
          },
        ];

        // And mock API response
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            yield {
              choices: [{ delta: { content: 'Response with tools' } }],
            };
          },
        };

        let capturedApiParams: unknown;
        mockOpenAIInstance.chat.completions.create.mockImplementation(
          async (params) => {
            capturedApiParams = params;
            return mockStream;
          },
        );

        // When I generate chat completion with tools
        const messages = [
          { role: ContentGeneratorRole.USER, content: 'Use the tool' },
        ];
        const generator = provider.generateChatCompletion(messages, tools);
        const results: unknown[] = [];
        for await (const chunk of generator) {
          results.push(chunk);
        }

        // Then the API should receive tools in OpenAI format (current implementation)
        expect(capturedApiParams).toBeDefined();
        const apiParams = capturedApiParams as Record<string, unknown>;
        const apiTools = apiParams.tools as Array<Record<string, unknown>>;
        expect(Array.isArray(apiTools)).toBe(true);
        expect(apiTools).toHaveLength(1);
        expect(apiTools[0]).toMatchObject({
          type: 'function',
          function: {
            name: 'test_tool',
            description: 'A test tool',
          },
        });
      });

      it('should apply anti-repetition streaming logic for GLM-4.5 models with tool calls', async () => {
        // Given a GLM-4.5 model
        provider.setModel('glm-4.5-plus');

        // Mock SettingsService
        mockGetSettingsService.mockReturnValue({
          settings: {
            providers: {
              openai: {},
            },
          },
        });

        // And sample tools
        const tools: ITool[] = [
          {
            type: 'function',
            function: {
              name: 'get_weather',
              description: 'Get weather information',
              parameters: { type: 'object', properties: {} },
            },
          },
        ];

        // Mock streaming response that includes both content and tool calls
        const mockStream = {
          async *[Symbol.asyncIterator]() {
            // First chunk: content
            yield {
              choices: [
                {
                  delta: { content: 'I will check the weather for you.' },
                },
              ],
            };
            // Second chunk: more content
            yield {
              choices: [
                {
                  delta: { content: ' Let me use the weather tool.' },
                },
              ],
            };
            // Third chunk: tool call
            yield {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_123',
                        function: {
                          name: 'get_weather',
                          arguments: '{"location": "San Francisco"}',
                        },
                      },
                    ],
                  },
                },
              ],
            };
            // Final chunk: usage data
            yield {
              choices: [{ delta: {} }],
              usage: {
                prompt_tokens: 25,
                completion_tokens: 15,
                total_tokens: 40,
              },
            };
          },
        };

        mockOpenAIInstance.chat.completions.create.mockResolvedValue(
          mockStream,
        );

        // When I generate chat completion with tools
        const messages = [
          { role: ContentGeneratorRole.USER, content: 'What is the weather?' },
        ];
        const generator = provider.generateChatCompletion(messages, tools);
        const results: unknown[] = [];
        for await (const chunk of generator) {
          results.push(chunk);
        }

        // Then it should apply anti-repetition logic:
        // 1. Stream content chunks first
        expect(results).toHaveLength(3);

        // First content chunk
        expect(results[0]).toMatchObject({
          role: ContentGeneratorRole.ASSISTANT,
          content: 'I will check the weather for you.',
        });

        // Second content chunk
        expect(results[1]).toMatchObject({
          role: ContentGeneratorRole.ASSISTANT,
          content: ' Let me use the weather tool.',
        });

        // Final message should have tool calls with EMPTY content (anti-repetition)
        expect(results[2]).toMatchObject({
          role: ContentGeneratorRole.ASSISTANT,
          content: '', // Content should be empty to avoid duplication
          tool_calls: [
            {
              id: 'call_123',
              type: 'function',
              function: {
                name: 'get_weather',
                arguments: '{"location": "San Francisco"}',
              },
            },
          ],
          usage: {
            prompt_tokens: 25,
            completion_tokens: 15,
            total_tokens: 40,
          },
        });
      });
    });
  });
});
