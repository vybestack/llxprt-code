/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue490
 * Phase 7: Bucket Failover Integration Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeProviderWithBucketFailover,
  shouldEnableBucketFailover,
  aggregateTextFromBlocks,
  type BucketFailoverConfig,
} from '../bucketFailoverIntegration.js';
import type { IContent } from '../../services/history/IContent.js';
import type {
  IProvider,
  GenerateChatOptions,
} from '../../providers/IProvider.js';

describe('bucketFailoverIntegration', () => {
  describe('shouldEnableBucketFailover', () => {
    it('returns false when no auth config provided', () => {
      expect(shouldEnableBucketFailover(undefined)).toBe(false);
    });

    it('returns false when auth type is not oauth', () => {
      expect(
        shouldEnableBucketFailover({
          type: 'apikey',
          buckets: ['bucket1', 'bucket2'],
        }),
      ).toBe(false);
    });

    it('returns false when only one bucket configured', () => {
      expect(
        shouldEnableBucketFailover({
          type: 'oauth',
          buckets: ['bucket1'],
        }),
      ).toBe(false);
    });

    it('returns false when no buckets configured', () => {
      expect(
        shouldEnableBucketFailover({
          type: 'oauth',
        }),
      ).toBe(false);
    });

    it('returns true when oauth with multiple buckets', () => {
      expect(
        shouldEnableBucketFailover({
          type: 'oauth',
          buckets: ['bucket1', 'bucket2'],
        }),
      ).toBe(true);
    });
  });

  describe('aggregateTextFromBlocks', () => {
    it('aggregates text from text blocks', () => {
      const blocks = [
        { type: 'text' as const, text: 'Hello ' },
        { type: 'text' as const, text: 'World' },
      ];

      expect(aggregateTextFromBlocks(blocks)).toBe('Hello World');
    });

    it('ignores non-text blocks', () => {
      const blocks = [
        { type: 'text' as const, text: 'Hello' },
        {
          type: 'tool_call' as const,
          id: '1',
          name: 'test',
          parameters: {},
        },
        { type: 'text' as const, text: ' World' },
      ];

      expect(aggregateTextFromBlocks(blocks)).toBe('Hello World');
    });

    it('returns empty string for no text blocks', () => {
      const blocks = [
        {
          type: 'tool_call' as const,
          id: '1',
          name: 'test',
          parameters: {},
        },
      ];

      expect(aggregateTextFromBlocks(blocks)).toBe('');
    });
  });

  describe('executeProviderWithBucketFailover', () => {
    let mockProvider: IProvider;
    let options: GenerateChatOptions;

    beforeEach(() => {
      mockProvider = {
        name: 'test-provider',
        generateChatCompletion: vi.fn(),
      } as unknown as IProvider;

      options = {
        contents: [],
        config: {},
        runtime: {
          runtimeId: 'test',
          metadata: {},
        },
      } as GenerateChatOptions;
    });

    it('succeeds on first bucket when no errors', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // Mock successful async generator
      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!).mockReturnValue(
        successGenerator(),
      );

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket1');
      expect(result.content).toEqual(responseContent);
      expect(result.attemptedBuckets).toEqual(['bucket1']);
      expect(mockProvider.generateChatCompletion).toHaveBeenCalledTimes(1);
    });

    it('fails over to second bucket on 429 error', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success from bucket2!' }],
      };

      // First call throws 429, second succeeds
      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('429 Rate limit exceeded');
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const notificationSpy = vi.fn();
      const tokenRefreshSpy = vi.fn().mockResolvedValue(undefined);

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
        notificationCallback: notificationSpy,
        tokenRefreshCallback: tokenRefreshSpy,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
      expect(result.content).toEqual(responseContent);
      expect(result.attemptedBuckets).toEqual(['bucket1', 'bucket2']);
      expect(mockProvider.generateChatCompletion).toHaveBeenCalledTimes(2);
      expect(notificationSpy).toHaveBeenCalledWith('bucket1', 'bucket2');
      expect(tokenRefreshSpy).toHaveBeenCalledTimes(2);
      expect(tokenRefreshSpy).toHaveBeenNthCalledWith(1, 'bucket1');
      expect(tokenRefreshSpy).toHaveBeenNthCalledWith(2, 'bucket2');
    });

    it('fails over on quota exceeded error', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('Quota exceeded for this bucket');
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
      expect(mockProvider.generateChatCompletion).toHaveBeenCalledTimes(2);
    });

    it('throws immediately on non-failover errors', async () => {
      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('400 Bad Request - invalid parameter');
      }

      vi.mocked(mockProvider.generateChatCompletion!).mockReturnValue(
        failGenerator(),
      );

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      await expect(
        executeProviderWithBucketFailover(options, config),
      ).rejects.toThrow('400 Bad Request');

      // Should only try first bucket
      expect(mockProvider.generateChatCompletion).toHaveBeenCalledTimes(1);
    });

    it('throws comprehensive error when all buckets exhausted', async () => {
      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('429 Rate limit exceeded');
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(failGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2', 'bucket3'],
        provider: mockProvider,
      };

      await expect(
        executeProviderWithBucketFailover(options, config),
      ).rejects.toThrow(/All buckets exhausted/);

      // Should try all buckets
      expect(mockProvider.generateChatCompletion).toHaveBeenCalledTimes(3);
    });

    it('throws error when no buckets provided', async () => {
      const config: BucketFailoverConfig = {
        buckets: [],
        provider: mockProvider,
      };

      await expect(
        executeProviderWithBucketFailover(options, config),
      ).rejects.toThrow('requires at least one bucket');
    });

    it('throws error when provider does not support generateChatCompletion', async () => {
      const invalidProvider = {
        name: 'invalid-provider',
      } as IProvider;

      const config: BucketFailoverConfig = {
        buckets: ['bucket1'],
        provider: invalidProvider,
      };

      await expect(
        executeProviderWithBucketFailover(options, config),
      ).rejects.toThrow('does not support generateChatCompletion');
    });

    it('handles 402 payment required errors', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('402 Payment Required');
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
    });

    it('handles token expired errors', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('OAuth token has expired');
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
    });

    it('calls tokenRefreshCallback before each attempt', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!).mockReturnValue(
        successGenerator(),
      );

      const tokenRefreshSpy = vi.fn().mockResolvedValue(undefined);

      const config: BucketFailoverConfig = {
        buckets: ['bucket1'],
        provider: mockProvider,
        tokenRefreshCallback: tokenRefreshSpy,
      };

      await executeProviderWithBucketFailover(options, config);

      expect(tokenRefreshSpy).toHaveBeenCalledTimes(1);
      expect(tokenRefreshSpy).toHaveBeenCalledWith('bucket1');
    });

    it('consumes entire async generator stream', async () => {
      const chunk1: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Hello' }],
      };
      const chunk2: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: ' World' }],
      };

      async function* multiChunkGenerator() {
        yield chunk1;
        yield chunk2;
      }

      vi.mocked(mockProvider.generateChatCompletion!).mockReturnValue(
        multiChunkGenerator(),
      );

      const config: BucketFailoverConfig = {
        buckets: ['bucket1'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      // Should return the last chunk
      expect(result.content).toEqual(chunk2);
    });
    it('handles 403 permission_error (OAuth token revoked)', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        const error = new Error(
          'API Error: 403 {"type":"error","error":{"type":"permission_error","message":"OAuth token has been revoked."}}',
        );
        (error as { status?: number }).status = 403;
        throw error;
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
    });

    it('handles error message containing "revoked"', async () => {
      const responseContent: IContent = {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Success!' }],
      };

      // eslint-disable-next-line require-yield
      async function* failGenerator() {
        throw new Error('OAuth token has been revoked');
      }

      async function* successGenerator() {
        yield responseContent;
      }

      vi.mocked(mockProvider.generateChatCompletion!)
        .mockReturnValueOnce(failGenerator())
        .mockReturnValueOnce(successGenerator());

      const config: BucketFailoverConfig = {
        buckets: ['bucket1', 'bucket2'],
        provider: mockProvider,
      };

      const result = await executeProviderWithBucketFailover(options, config);

      expect(result.bucket).toBe('bucket2');
    });
  });
});
