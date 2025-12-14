/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { DebugLogger } from '@vybestack/llxprt-code-core';

const logger = new DebugLogger('llxprt:auth:multi-bucket');

/**
 * Multi-bucket authentication result
 */
export interface MultiBucketAuthResult {
  authenticatedBuckets: string[];
  failedBuckets: string[];
  cancelled: boolean;
  error?: string;
}

/**
 * Multi-bucket authentication options
 */
export interface MultiBucketAuthOptions {
  provider: string;
  buckets: string[];
  delay?: number;
  showPrompt?: boolean;
  autoOpenBrowser?: boolean;
}

/**
 * Callback types for multi-bucket authentication
 */
export interface MultiBucketAuthCallbacks {
  onAuthBucket: (
    provider: string,
    bucket: string,
    index: number,
    total: number,
  ) => Promise<void>;
  onPrompt: (provider: string, bucket: string) => Promise<boolean>;
  onDelay: (ms: number, bucket: string) => Promise<void>;
  getEphemeralSetting: <T>(key: string) => T | undefined;
}

/**
 * Multi-bucket authenticator for OAuth flows
 *
 * Handles sequential authentication of multiple OAuth buckets with:
 * - Timing controls (delay or prompt-based)
 * - Browser auto-open control
 * - User notifications
 * - Partial cancellation support
 */
export class MultiBucketAuthenticator {
  private cancelled = false;

  constructor(
    private readonly onAuthBucket: (
      provider: string,
      bucket: string,
      index: number,
      total: number,
    ) => Promise<void>,
    private readonly onPrompt: (
      provider: string,
      bucket: string,
    ) => Promise<boolean>,
    private readonly onDelay: (ms: number, bucket: string) => Promise<void>,
    private readonly getEphemeralSetting: <T>(
      key: string,
    ) => T | undefined = () => undefined,
  ) {}

  /**
   * Create authenticator from callbacks object
   */
  static fromCallbacks(
    callbacks: MultiBucketAuthCallbacks,
  ): MultiBucketAuthenticator {
    return new MultiBucketAuthenticator(
      callbacks.onAuthBucket,
      callbacks.onPrompt,
      callbacks.onDelay,
      callbacks.getEphemeralSetting,
    );
  }

  /**
   * Authenticate multiple buckets sequentially with timing controls
   */
  async authenticateMultipleBuckets(
    options: MultiBucketAuthOptions,
  ): Promise<MultiBucketAuthResult> {
    const { provider, buckets } = options;

    logger.debug('Starting multi-bucket authentication', {
      provider,
      bucketCount: buckets.length,
    });

    if (buckets.length === 0) {
      return {
        authenticatedBuckets: [],
        failedBuckets: [],
        cancelled: false,
      };
    }

    const authenticatedBuckets: string[] = [];
    const failedBuckets: string[] = [];
    let firstError: string | undefined;

    const effectiveDelay =
      options.delay ??
      this.getEphemeralSetting<number>('auth-bucket-delay') ??
      5000;
    const effectiveShowPrompt =
      options.showPrompt ??
      this.getEphemeralSetting<boolean>('auth-bucket-prompt') ??
      false;

    for (let i = 0; i < buckets.length; i++) {
      if (this.cancelled) {
        logger.debug('Multi-bucket auth cancelled', {
          authenticated: authenticatedBuckets.length,
          remaining: buckets.length - i,
        });
        failedBuckets.push(...buckets.slice(i));
        return {
          authenticatedBuckets,
          failedBuckets,
          cancelled: true,
          error: firstError,
        };
      }

      const bucket = buckets[i];
      const isFirst = i === 0;

      if (effectiveShowPrompt) {
        const shouldContinue = await this.onPrompt(provider, bucket);
        if (!shouldContinue) {
          logger.debug('User cancelled at prompt', { bucket });
          failedBuckets.push(...buckets.slice(i));
          return {
            authenticatedBuckets,
            failedBuckets,
            cancelled: true,
            error: firstError,
          };
        }
      } else if (!isFirst) {
        await this.onDelay(effectiveDelay, bucket);
      }

      try {
        await this.onAuthBucket(provider, bucket, i + 1, buckets.length);
        authenticatedBuckets.push(bucket);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        logger.error('Bucket authentication failed', {
          bucket,
          error: errorMessage,
        });
        failedBuckets.push(bucket);
        if (!firstError) {
          firstError = errorMessage;
        }
      }
    }

    const result: MultiBucketAuthResult = {
      authenticatedBuckets,
      failedBuckets,
      cancelled: false,
      error: firstError,
    };

    logger.debug('Multi-bucket auth complete', {
      authenticated: authenticatedBuckets.length,
      failed: failedBuckets.length,
    });

    return result;
  }

  /**
   * Request cancellation of multi-bucket auth flow
   */
  cancel(): void {
    logger.debug('Multi-bucket auth cancellation requested');
    this.cancelled = true;
  }
}
