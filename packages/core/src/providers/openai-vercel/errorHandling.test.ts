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

/**
 * @plan PLAN-20251127-OPENAIVERCEL.P13
 * @requirement REQ-OAV-009 - Error Handling
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { OpenAIVercelProvider } from './OpenAIVercelProvider.js';
import { IContent } from '../../services/history/IContent.js';
import { createProviderCallOptions } from '../../test-utils/providerCallOptions.js';
import {
  ProviderError,
  RateLimitError,
  AuthenticationError,
  wrapError,
} from './errors.js';
import { SettingsService } from '../../settings/SettingsService.js';
import { createRuntimeConfigStub } from '../../test-utils/runtime.js';

interface MockStreamTextResult {
  textStream: AsyncIterable<string>;
  usage: Promise<{
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  }>;
  finishReason: Promise<string>;
  toolCalls: Promise<unknown[]>;
  toolResults: Promise<unknown[]>;
  response: Promise<{ id: string; timestamp: Date; modelId: string }>;
  warnings: Promise<unknown[]>;
  experimental_providerMetadata: Promise<Record<string, unknown>>;
}

vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => vi.fn((modelId: string) => ({ modelId }))),
}));

describe('OpenAIVercelProvider - Error Handling', () => {
  let provider: OpenAIVercelProvider;
  let mockStreamText: ReturnType<typeof vi.fn>;
  let mockGenerateText: ReturnType<typeof vi.fn>;
  let settingsService: SettingsService;
  let config: ReturnType<typeof createRuntimeConfigStub>;

  beforeEach(async () => {
    vi.clearAllMocks();
    settingsService = new SettingsService();
    settingsService.set('activeProvider', 'openaivercel');
    config = createRuntimeConfigStub();

    mockStreamText = vi.mocked((await import('ai')).streamText);
    mockGenerateText = vi.mocked((await import('ai')).generateText);

    provider = new OpenAIVercelProvider('test-api-key', undefined, {
      settingsService,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('Rate Limit Errors (429)', () => {
    it('should handle rate limit errors with retry-after header', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      Object.assign(rateLimitError, {
        name: 'AI_APICallError',
        statusCode: 429,
        responseHeaders: {
          'retry-after': '60',
          'x-ratelimit-limit-requests': '10000',
          'x-ratelimit-remaining-requests': '0',
          'x-ratelimit-reset-requests': '1m',
        },
      });

      mockStreamText.mockRejectedValue(rateLimitError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);

      let error: unknown;
      try {
        await iterator.next();
        throw new Error('Should have thrown an error');
      } catch (e) {
        error = e;
      }

      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.retryAfter).toBe(60);
    });

    it('should handle rate limit errors without retry-after header', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      Object.assign(rateLimitError, {
        name: 'AI_APICallError',
        statusCode: 429,
        responseHeaders: {
          'x-ratelimit-limit-requests': '10000',
          'x-ratelimit-remaining-requests': '0',
        },
      });
      mockStreamText.mockRejectedValue(rateLimitError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);

      const error = await iterator.next().catch((e) => e);
      expect(error).toBeInstanceOf(RateLimitError);
      expect(error.message).toContain('Rate limit exceeded');
      expect(error.retryAfter).toBeUndefined();
    });
  });

  describe('Authentication Errors (401)', () => {
    it('should handle invalid API key errors', async () => {
      const authError = new Error('Invalid API key') as Error & {
        name: string;
        statusCode: number;
      };
      Object.assign(authError, {
        name: 'AI_APICallError',
        statusCode: 401,
      });
      mockStreamText.mockRejectedValue(authError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(AuthenticationError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      expect(error).toMatchObject({
        message: expect.stringContaining('Invalid API key'),
      });
    });

    it('should handle authentication errors in streaming mode', async () => {
      const authError = new Error(
        'Invalid authentication credentials',
      ) as Error & {
        name: string;
        statusCode: number;
      };
      Object.assign(authError, {
        name: 'AI_APICallError',
        statusCode: 401,
      });
      mockStreamText.mockRejectedValue(authError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
        resolved: { streaming: true },
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(AuthenticationError);
    });
  });

  describe('Model Errors (404)', () => {
    it('should handle model not found errors', async () => {
      const modelError = new Error('Model not found') as Error & {
        name: string;
        statusCode: number;
        responseBody: {
          error: {
            message: string;
            type: string;
            code: string;
          };
        };
      };
      Object.assign(modelError, {
        name: 'AI_APICallError',
        statusCode: 404,
        responseBody: {
          error: {
            message: 'The model `gpt-5` does not exist',
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        },
      });
      mockStreamText.mockRejectedValue(modelError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
        modelOverride: 'gpt-5',
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // The error message will be "Model not found" since that's what we passed to the mock
      expect(error).toMatchObject({
        message: expect.stringContaining('Model not found'),
        statusCode: 404,
      });
    });
  });

  describe('Server Errors (500, 502, 503)', () => {
    it('should handle internal server errors (500)', async () => {
      const serverError = new Error('Internal server error');
      Object.assign(serverError, {
        name: 'AI_APICallError',
        statusCode: 500,
      });
      mockStreamText.mockRejectedValue(serverError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      expect(error).toMatchObject({
        message: expect.stringContaining('server error'),
        isRetryable: true,
      });
    });

    it('should handle bad gateway errors (502)', async () => {
      const badGatewayError = new Error('Bad gateway');
      Object.assign(badGatewayError, {
        name: 'AI_APICallError',
        statusCode: 502,
      });
      mockStreamText.mockRejectedValue(badGatewayError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      expect(error).toMatchObject({
        isRetryable: true,
      });
    });

    it('should handle service unavailable errors (503)', async () => {
      const unavailableError = new Error('Service temporarily unavailable');
      Object.assign(unavailableError, {
        name: 'AI_APICallError',
        statusCode: 503,
        responseHeaders: {
          'retry-after': '30',
        },
      });
      mockStreamText.mockRejectedValue(unavailableError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // 503 errors are server errors and should be retryable
      expect(error).toMatchObject({
        isRetryable: true,
        statusCode: 503,
      });
    });
  });

  describe('Network Errors', () => {
    it('should handle network timeout errors', async () => {
      const timeoutError = new Error('Request timeout');
      Object.assign(timeoutError, {
        name: 'AI_APICallError',
        code: 'ETIMEDOUT',
      });
      mockStreamText.mockRejectedValue(timeoutError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // Network timeout errors are wrapped - the message will be "Request timeout"
      expect(error).toMatchObject({
        message: expect.stringContaining('timeout'),
      });
    });

    it('should handle connection refused errors', async () => {
      const connectionError = new Error('Connection refused');
      Object.assign(connectionError, {
        name: 'AI_APICallError',
        code: 'ECONNREFUSED',
      });
      mockStreamText.mockRejectedValue(connectionError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // Connection refused errors - message should contain connection info
      expect(error).toMatchObject({
        message: expect.stringContaining('Connection refused'),
      });
    });

    it('should handle DNS resolution errors', async () => {
      const dnsError = new Error('DNS resolution failed');
      Object.assign(dnsError, {
        name: 'AI_APICallError',
        code: 'ENOTFOUND',
      });
      mockStreamText.mockRejectedValue(dnsError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      expect(error).toMatchObject({
        isRetryable: false,
      });
    });
  });

  describe('Invalid Request Errors (400)', () => {
    it('should handle invalid parameter errors', async () => {
      const invalidParamError = new Error('Invalid parameter');
      Object.assign(invalidParamError, {
        name: 'AI_APICallError',
        statusCode: 400,
        responseBody: {
          error: {
            message: 'Invalid value for temperature: must be between 0 and 2',
            type: 'invalid_request_error',
            param: 'temperature',
          },
        },
      });
      mockStreamText.mockRejectedValue(invalidParamError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // The error message will be the mock's message: "Invalid parameter"
      expect(error).toMatchObject({
        message: expect.stringContaining('Invalid parameter'),
        statusCode: 400,
      });
    });

    it('should handle context length exceeded errors', async () => {
      const contextError = new Error('Context length exceeded');
      Object.assign(contextError, {
        name: 'AI_APICallError',
        statusCode: 400,
        responseBody: {
          error: {
            message:
              "This model's maximum context length is 4096 tokens. However, your messages resulted in 5000 tokens.",
            type: 'invalid_request_error',
            code: 'context_length_exceeded',
          },
        },
      });
      mockStreamText.mockRejectedValue(contextError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // The error message will be the mock's message: "Context length exceeded"
      expect(error).toMatchObject({
        message: expect.stringContaining('Context length exceeded'),
        statusCode: 400,
      });
    });

    it('should handle invalid tool definition errors', async () => {
      const toolError = new Error('Invalid tool definition');
      Object.assign(toolError, {
        name: 'AI_APICallError',
        statusCode: 400,
        responseBody: {
          error: {
            message: 'Invalid tool schema: missing required field "name"',
            type: 'invalid_request_error',
          },
        },
      });
      mockStreamText.mockRejectedValue(toolError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
      const error = await provider
        .generateChatCompletion(options)
        .next()
        .catch((e) => e);
      // The error message will be the mock's message
      expect(error).toMatchObject({
        message: expect.stringContaining('Invalid tool definition'),
        statusCode: 400,
      });
    });
  });

  describe('Streaming Error Handling', () => {
    it('should handle errors during stream initialization', async () => {
      const streamError = new Error('Stream initialization failed');
      Object.assign(streamError, {
        name: 'AI_APICallError',
        statusCode: 500,
      });
      mockStreamText.mockRejectedValue(streamError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
        resolved: { streaming: true },
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });

    it('should handle errors during stream consumption', async () => {
      async function* errorStream(): AsyncIterableIterator<string> {
        yield 'First chunk';
        throw new Error('Stream error during consumption');
      }

      // Create a rejected promise and attach a catch handler to prevent unhandled rejection
      const rejectedTextPromise = Promise.reject(new Error('Stream error'));
      rejectedTextPromise.catch(() => {
        /* handled */
      });

      const mockResult: MockStreamTextResult = {
        textStream: errorStream(),
        text: rejectedTextPromise,
        usage: Promise.resolve({
          promptTokens: 10,
          completionTokens: 0,
          totalTokens: 10,
        }),
        finishReason: Promise.resolve('error'),
        toolCalls: Promise.resolve([]),
        toolResults: Promise.resolve([]),
        response: Promise.resolve({
          id: 'test-id',
          timestamp: new Date(),
          modelId: 'gpt-4',
        }),
        warnings: Promise.resolve([]),
        experimental_providerMetadata: Promise.resolve({}),
      };

      mockStreamText.mockResolvedValue(mockResult);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
        resolved: { streaming: true },
      });

      const iterator = provider.generateChatCompletion(options);
      const result = { stream: iterator };

      if (!result.stream) {
        throw new Error('Expected streaming result');
      }

      const chunks: string[] = [];
      await expect(async () => {
        for await (const chunk of result.stream!) {
          chunks.push(chunk);
        }
      }).rejects.toThrow(ProviderError);

      expect(chunks.length).toBeGreaterThan(0);
    });
  });

  describe('Error Wrapping', () => {
    it('should wrap unknown errors with ProviderError', async () => {
      const unknownError = new Error('Unknown error');
      mockStreamText.mockRejectedValue(unknownError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });

    it('should preserve original error details', async () => {
      const originalError = new Error('Original error message');
      Object.assign(originalError, {
        name: 'CustomError',
        code: 'CUSTOM_CODE',
        details: { field: 'value' },
      });
      mockStreamText.mockRejectedValue(originalError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      const error = await iterator.next().catch((e) => e);

      expect(error).toBeInstanceOf(ProviderError);
      const providerError = error as ProviderError;
      expect(providerError.originalError).toBe(originalError);
      expect(providerError.message).toBe('Original error message');
      expect(providerError.provider).toBe('openaivercel');
      // The original error doesn't have a statusCode, so providerError.statusCode is undefined
      expect(providerError.statusCode).toBeUndefined();
    });

    it('should use wrapError utility for consistent error handling', async () => {
      const testError = new Error('Test error');
      Object.assign(testError, {
        name: 'AI_APICallError',
        statusCode: 429,
      });

      const wrappedError = wrapError(testError);
      expect(wrappedError).toBeInstanceOf(RateLimitError);
    });
  });

  describe('Error Messages', () => {
    it('should provide user-friendly error messages', async () => {
      const apiError = new Error('Complex technical error');
      Object.assign(apiError, {
        name: 'AI_APICallError',
        statusCode: 500,
        responseBody: {
          error: {
            message: 'Internal processing error in module XYZ',
          },
        },
      });
      mockStreamText.mockRejectedValue(apiError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      const error = await iterator.next().catch((e) => e);

      expect(error).toBeInstanceOf(ProviderError);
      expect((error as Error).message).toBeTruthy();
    });

    it('should include rate limit details in error message', async () => {
      const rateLimitError = new Error('Rate limit exceeded');
      Object.assign(rateLimitError, {
        name: 'AI_APICallError',
        statusCode: 429,
        responseHeaders: {
          'retry-after': '60',
          'x-ratelimit-limit-requests': '10000',
          'x-ratelimit-remaining-requests': '0',
        },
      });
      mockStreamText.mockRejectedValue(rateLimitError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
      });

      const iterator = provider.generateChatCompletion(options);
      const error = await iterator.next().catch((e) => e);

      expect(error).toBeInstanceOf(RateLimitError);
      const rateLimitErr = error as RateLimitError;
      expect(rateLimitErr.message).toContain('Rate limit');
    });
  });

  describe('Non-streaming Error Handling', () => {
    it('should handle errors in non-streaming mode', async () => {
      const apiError = new Error('API error');
      Object.assign(apiError, {
        name: 'AI_APICallError',
        statusCode: 500,
      });
      mockGenerateText.mockRejectedValue(apiError);

      const content: IContent[] = [
        {
          speaker: 'human',
          blocks: [{ type: 'text' as const, text: 'Hello' }],
        },
      ];
      const options = createProviderCallOptions({
        providerName: 'openaivercel',
        config,
        contents: content,
        settings: settingsService,
        resolved: { streaming: false },
      });

      const iterator = provider.generateChatCompletion(options);
      await expect(iterator.next()).rejects.toThrow(ProviderError);
    });
  });
});
