/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue490
 * Phase 7: Bucket Failover Integration
 *
 * Integrates bucket failover logic into GeminiChat provider execution flow
 */

import type { IContent, ContentBlock } from '../services/history/IContent.js';
import type { IProvider, GenerateChatOptions } from '../providers/IProvider.js';
import { DebugLogger } from '../debug/index.js';

/**
 * Determines if an error should trigger failover to the next bucket
 *
 * Failover triggers:
 * - 429 rate limit
 * - Quota exceeded
 * - 402 payment required
 * - Token renewal failure
 *
 * Does NOT failover:
 * - 400 bad request
 * - Other API errors
 */
function shouldFailover(error: Error): boolean {
  const message = error.message.toLowerCase();

  // Check for status code on error object (common pattern)
  const errorStatus = (error as { status?: number }).status;
  if (errorStatus === 401 || errorStatus === 403) {
    return true;
  }

  return (
    message.includes('429') ||
    message.includes('401') ||
    message.includes('403') ||
    message.includes('rate limit') ||
    message.includes('quota') ||
    message.includes('402') ||
    message.includes('payment') ||
    message.includes('revoked') ||
    message.includes('permission_error') ||
    (message.includes('token') && message.includes('expired'))
  );
}

const logger = new DebugLogger('llxprt:bucket:failover:integration');

/**
 * Configuration for bucket failover execution
 */
export interface BucketFailoverConfig {
  buckets: string[];
  provider: IProvider;
  tokenRefreshCallback?: (bucket: string) => Promise<void>;
  notificationCallback?: (fromBucket: string, toBucket: string) => void;
}

/**
 * Result from bucket failover execution including which bucket succeeded
 */
export interface BucketFailoverResult {
  content: IContent;
  bucket: string;
  attemptedBuckets: string[];
}

/**
 * Wrapper for provider generateChatCompletion that handles bucket failover
 *
 * When multiple OAuth buckets are configured, this will automatically retry
 * failed requests (429/quota/402 errors) with the next available bucket.
 *
 * @param options - Chat generation options to pass to provider
 * @param config - Bucket failover configuration
 * @returns The final IContent response and which bucket succeeded
 * @throws Error if all buckets are exhausted
 */
export async function executeProviderWithBucketFailover(
  options: GenerateChatOptions,
  config: BucketFailoverConfig,
): Promise<BucketFailoverResult> {
  const { buckets, provider, tokenRefreshCallback, notificationCallback } =
    config;

  if (!buckets || buckets.length === 0) {
    throw new Error('Bucket failover requires at least one bucket');
  }

  if (!provider.generateChatCompletion) {
    throw new Error('Provider does not support generateChatCompletion');
  }

  const attemptedBuckets: string[] = [];
  let lastError: Error | null = null;

  for (let i = 0; i < buckets.length; i++) {
    const bucket = buckets[i];
    attemptedBuckets.push(bucket);

    try {
      // Refresh token for this bucket if callback provided
      if (tokenRefreshCallback) {
        logger.debug(() => `Refreshing OAuth token for bucket '${bucket}'`);
        await tokenRefreshCallback(bucket);
      }

      logger.debug(
        () =>
          `Attempting provider call with bucket '${bucket}' (${i + 1}/${buckets.length})`,
      );

      // Call provider with current bucket's auth
      const stream = provider.generateChatCompletion(options);

      // Consume the async generator to get the final result
      let lastContent: IContent | undefined;
      for await (const chunk of stream) {
        lastContent = chunk;
      }

      if (!lastContent) {
        throw new Error('Provider returned empty response');
      }

      logger.debug(
        () => `Successfully completed request with bucket '${bucket}'`,
      );

      return {
        content: lastContent,
        bucket,
        attemptedBuckets,
      };
    } catch (error) {
      const err = error as Error;
      lastError = err;

      logger.debug(
        () => `Bucket '${bucket}' failed with error: ${err.message}`,
      );

      // Check if this error should trigger failover
      if (shouldFailover(err)) {
        if (i < buckets.length - 1) {
          const nextBucket = buckets[i + 1];

          // Notify about bucket switch
          if (notificationCallback) {
            notificationCallback(bucket, nextBucket);
          }

          logger.debug(
            () => `Failing over from bucket '${bucket}' to '${nextBucket}'`,
          );

          // Continue to next bucket
          continue;
        } else {
          // Last bucket also failed with failover error
          const exhaustedMessage = formatAllBucketsExhaustedError(
            provider.name,
            buckets,
            attemptedBuckets,
            lastError,
          );
          throw new Error(exhaustedMessage);
        }
      }

      // Non-failover error - throw immediately
      throw err;
    }
  }

  // Should never reach here, but handle the case
  const exhaustedMessage = formatAllBucketsExhaustedError(
    provider.name,
    buckets,
    attemptedBuckets,
    lastError,
  );
  throw new Error(exhaustedMessage);
}

/**
 * Format comprehensive error message when all buckets are exhausted
 */
function formatAllBucketsExhaustedError(
  providerName: string,
  allBuckets: string[],
  attemptedBuckets: string[],
  lastError: Error | null,
): string {
  let message = `All buckets exhausted for provider '${providerName}':\n`;

  for (const bucket of attemptedBuckets) {
    message += `  - ${bucket}: failed\n`;
  }

  // Note any buckets that weren't tried
  const unattempted = allBuckets.filter((b) => !attemptedBuckets.includes(b));
  if (unattempted.length > 0) {
    message += `\nUnattempted buckets: ${unattempted.join(', ')}\n`;
  }

  if (lastError) {
    message += `\nLast error: ${lastError.message}`;
  }

  message += `\n\nTry again later or add more OAuth buckets to the profile.`;

  return message;
}

/**
 * Check if bucket failover should be enabled for the current configuration
 *
 * Bucket failover is enabled when:
 * 1. Profile has auth configuration
 * 2. Auth type is 'oauth'
 * 3. Multiple buckets are configured
 *
 * @param authConfig - The profile's auth configuration
 * @returns true if failover should be enabled
 */
export function shouldEnableBucketFailover(
  authConfig:
    | {
        type: string;
        buckets?: string[];
      }
    | undefined,
): boolean {
  if (!authConfig) {
    return false;
  }

  if (authConfig.type !== 'oauth') {
    return false;
  }

  if (!authConfig.buckets || authConfig.buckets.length <= 1) {
    return false;
  }

  return true;
}

/**
 * Aggregate text content from IContent blocks
 * Helper to extract text from provider responses
 */
export function aggregateTextFromBlocks(blocks: ContentBlock[]): string {
  let text = '';

  for (const block of blocks) {
    if (block.type === 'text') {
      text += block.text;
    }
  }

  return text;
}
