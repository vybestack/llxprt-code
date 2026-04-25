/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @fix issue1861
 * RetryOrchestrator OnAuthErrorHandler integration tests
 *
 * These behavioral tests verify that RetryOrchestrator:
 * 1. Calls onAuthError handler on 401/403 errors before retry
 * 2. Passes correct context to the handler (failedAccessToken, providerId, errorStatus)
 * 3. Uses the handler from config (both runtime.config and options.config)
 */

import { describe, it, expect, vi } from 'vitest';
import { RetryOrchestrator } from '../RetryOrchestrator.js';
import type { IProvider, GenerateChatOptions } from '../IProvider.js';
import type { IContent } from '../../services/history/IContent.js';
import type { IModel } from '../IModel.js';
import type { OnAuthErrorHandler } from '../../config/configTypes.js';

// Helper to create 401/403 auth errors
function createAuthError(
  status: 401 | 403,
  message: string,
): Error & { status?: number } {
  const error = new Error(message) as Error & { status?: number };
  error.status = status;
  return error;
}

// Helper to consume stream
async function consumeStream(
  stream: AsyncIterableIterator<IContent>,
): Promise<IContent[]> {
  const chunks: IContent[] = [];
  for await (const chunk of stream) {
    chunks.push(chunk);
  }
  return chunks;
}

// Test provider factory
function createTestProvider(config: {
  responses: Array<'success' | { error: Error }>;
  name?: string;
}): IProvider {
  let callCount = 0;
  const successContent: IContent = {
    speaker: 'ai',
    blocks: [{ type: 'text', text: 'success' }],
  };

  return {
    name: config.name ?? 'test-provider',
    async *generateChatCompletion(_options: GenerateChatOptions) {
      const response = config.responses[callCount++];
      if (response === 'success') {
        yield successContent;
        return;
      }
      throw response.error;
    },
    async getModels(): Promise<IModel[]> {
      return [];
    },
    getDefaultModel(): string {
      return 'test-model';
    },
    getServerTools(): string[] {
      return [];
    },
    async invokeServerTool(): Promise<unknown> {
      return null;
    },
  };
}

describe('RetryOrchestrator onAuthError handler', () => {
  /**
   * @fix issue1861
   * Test that RetryOrchestrator calls onAuthError handler on 401 error before retry
   */
  it('should call onAuthError handler on 401 error before retry', async () => {
    const authError = createAuthError(
      401,
      'API Error: 401 {"type":"authentication_error"}',
    );

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [{ error: authError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      resolved: {
        authToken: 'failed-oauth-token-abc123',
      },
      runtime: {
        config: {
          getOnAuthErrorHandler: () => onAuthErrorHandler,
        } as unknown as GenerateChatOptions['runtime'],
      } as unknown as GenerateChatOptions['runtime'],
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    // onAuthError should have been called once before the retry
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockOnAuthError).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAccessToken: 'failed-oauth-token-abc123',
        providerId: 'test-provider',
        errorStatus: 401,
      }),
    );
  });

  /**
   * @fix issue1861
   * Test that RetryOrchestrator calls onAuthError handler on 403 error before retry
   */
  it('should call onAuthError handler on 403 error before retry', async () => {
    const authError = createAuthError(
      403,
      'API Error: 403 {"type":"permission_error","message":"OAuth token revoked"}',
    );

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [{ error: authError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      resolved: {
        authToken: 'revoked-token-xyz789',
      },
      runtime: {
        config: {
          getOnAuthErrorHandler: () => onAuthErrorHandler,
        } as unknown as GenerateChatOptions['runtime'],
      } as unknown as GenerateChatOptions['runtime'],
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    expect(mockOnAuthError).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAccessToken: 'revoked-token-xyz789',
        providerId: 'test-provider',
        errorStatus: 403,
      }),
    );
  });

  /**
   * @fix issue1861
   * Test that onAuthError handler is called from options.config when runtime.config is missing
   */
  it('should find onAuthError handler from options.config when runtime.config is missing', async () => {
    const authError = createAuthError(401, 'Unauthorized');

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [{ error: authError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      resolved: {
        authToken: 'failed-token-123',
      },
      config: {
        getOnAuthErrorHandler: () => onAuthErrorHandler,
      } as unknown as GenerateChatOptions['config'],
      // No runtime.config set
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
  });

  /**
   * @fix issue1861
   * Test that onAuthError handler is NOT called for non-auth errors
   */
  it('should NOT call onAuthError handler for 429 rate limit errors', async () => {
    const rateLimitError = new Error('Rate limit exceeded') as Error & {
      status?: number;
    };
    rateLimitError.status = 429;

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [{ error: rateLimitError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      runtime: {
        config: {
          getOnAuthErrorHandler: () => onAuthErrorHandler,
        } as unknown as GenerateChatOptions['runtime'],
      } as unknown as GenerateChatOptions['runtime'],
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    // onAuthError should NOT be called for 429 errors
    expect(mockOnAuthError).not.toHaveBeenCalled();
  });

  /**
   * @fix issue1861
   * Test that onAuthError handler is NOT called when no handler is configured
   */
  it('should NOT fail when no onAuthError handler is configured', async () => {
    const authError = createAuthError(401, 'Unauthorized');

    const provider = createTestProvider({
      responses: [{ error: authError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      // No handler configured
    };

    // Should succeed without throwing
    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
  });

  /**
   * @fix issue1861
   * Test that onAuthError handler is called on consecutive auth errors before failover
   */
  it('should call onAuthError handler before attempting bucket failover on auth errors', async () => {
    const authError = createAuthError(403, 'OAuth token revoked');

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [
        { error: authError },
        { error: authError }, // Second auth error triggers failover
        'success',
      ],
    });

    let currentBucket = 'bucket1';
    const buckets = ['bucket1', 'bucket2'];
    let bucketIndex = 0;

    const failoverHandler = {
      getBuckets: () => buckets,
      getCurrentBucket: () => currentBucket,
      tryFailover: async () => {
        bucketIndex++;
        if (bucketIndex >= buckets.length) return false;
        currentBucket = buckets[bucketIndex];
        return true;
      },
      isEnabled: () => true,
    };

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 5,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      resolved: {
        authToken: 'revoked-token',
      },
      runtime: {
        config: {
          getOnAuthErrorHandler: () => onAuthErrorHandler,
          getBucketFailoverHandler: () => failoverHandler,
        } as unknown as GenerateChatOptions['runtime'],
      } as unknown as GenerateChatOptions['runtime'],
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    // onAuthError should be called for the first auth error (before retry)
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
  });

  /**
   * @fix issue1861
   * Test that onAuthError handler works when authToken is a function
   */
  it('should resolve authToken when it is a function returning a Promise', async () => {
    const authError = createAuthError(401, 'Unauthorized');

    const mockOnAuthError = vi.fn().mockResolvedValue(undefined);
    const onAuthErrorHandler: OnAuthErrorHandler = {
      handleAuthError: mockOnAuthError,
    };

    const provider = createTestProvider({
      responses: [{ error: authError }, 'success'],
    });

    const orchestrator = new RetryOrchestrator(provider, {
      maxAttempts: 3,
      initialDelayMs: 10,
    });

    const options: GenerateChatOptions = {
      contents: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }],
      resolved: {
        // authToken as a function returning Promise
        authToken: () => Promise.resolve('async-token-xyz'),
      },
      runtime: {
        config: {
          getOnAuthErrorHandler: () => onAuthErrorHandler,
        } as unknown as GenerateChatOptions['runtime'],
      } as unknown as GenerateChatOptions['runtime'],
    };

    const result = await consumeStream(
      orchestrator.generateChatCompletion(options),
    );

    expect(result).toHaveLength(1);
    expect(mockOnAuthError).toHaveBeenCalledTimes(1);
    // Should have resolved the async token
    expect(mockOnAuthError).toHaveBeenCalledWith(
      expect.objectContaining({
        failedAccessToken: 'async-token-xyz',
      }),
    );
  });
});
