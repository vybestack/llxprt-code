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

interface MultiBucketAuthState {
  authenticatedBuckets: string[];
  failedBuckets: string[];
  firstError?: string;
  effectiveDelay: number;
  effectiveShowPrompt: boolean;
}

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

    const state = this.createAuthState(options);

    for (let i = 0; i < buckets.length; i++) {
      const cancellationResult = this.handleCancellation(buckets, i, state);
      if (cancellationResult !== undefined) return cancellationResult;

      const bucket = buckets[i];
      const promptResult = await this.handleBucketPrompt(
        provider,
        bucket,
        buckets,
        i,
        state,
      );
      if (promptResult !== undefined) return promptResult;

      await this.authenticateBucket(provider, bucket, i, buckets.length, state);
    }

    return this.completeAuth(state);
  }

  private createAuthState(
    options: MultiBucketAuthOptions,
  ): MultiBucketAuthState {
    const effectiveDelay =
      options.delay ??
      this.getEphemeralSetting<number>('auth-bucket-delay') ??
      5000;
    const rawShowPromptSetting =
      this.getEphemeralSetting<boolean>('auth-bucket-prompt');
    const effectiveShowPrompt =
      options.showPrompt ?? rawShowPromptSetting ?? false;

    logger.debug('Multi-bucket auth settings', {
      optionsShowPrompt: options.showPrompt,
      rawShowPromptSetting,
      effectiveShowPrompt,
      effectiveDelay,
    });

    return {
      authenticatedBuckets: [],
      failedBuckets: [],
      effectiveDelay,
      effectiveShowPrompt,
    };
  }

  private handleCancellation(
    buckets: string[],
    index: number,
    state: MultiBucketAuthState,
  ): MultiBucketAuthResult | undefined {
    if (!this.cancelled) return undefined;

    logger.debug('Multi-bucket auth cancelled', {
      authenticated: state.authenticatedBuckets.length,
      remaining: buckets.length - index,
    });
    state.failedBuckets.push(...buckets.slice(index));
    return this.createCancelledResult(state);
  }

  private async handleBucketPrompt(
    provider: string,
    bucket: string,
    buckets: string[],
    index: number,
    state: MultiBucketAuthState,
  ): Promise<MultiBucketAuthResult | undefined> {
    if (!state.effectiveShowPrompt) {
      await this.onDelay(state.effectiveDelay, bucket);
      return undefined;
    }

    const shouldContinue = await this.onPrompt(provider, bucket);
    if (shouldContinue) return undefined;

    logger.debug('User cancelled at prompt', { bucket });
    state.failedBuckets.push(...buckets.slice(index));
    return this.createCancelledResult(state);
  }

  private async authenticateBucket(
    provider: string,
    bucket: string,
    index: number,
    total: number,
    state: MultiBucketAuthState,
  ): Promise<void> {
    try {
      await this.onAuthBucket(provider, bucket, index + 1, total);
      state.authenticatedBuckets.push(bucket);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error('Bucket authentication failed', {
        bucket,
        error: errorMessage,
      });
      state.failedBuckets.push(bucket);
      state.firstError ??= errorMessage;
    }
  }

  private createCancelledResult(
    state: MultiBucketAuthState,
  ): MultiBucketAuthResult {
    return {
      authenticatedBuckets: state.authenticatedBuckets,
      failedBuckets: state.failedBuckets,
      cancelled: true,
      error: state.firstError,
    };
  }

  private completeAuth(state: MultiBucketAuthState): MultiBucketAuthResult {
    const result: MultiBucketAuthResult = {
      authenticatedBuckets: state.authenticatedBuckets,
      failedBuckets: state.failedBuckets,
      cancelled: false,
      error: state.firstError,
    };

    logger.debug('Multi-bucket auth complete', {
      authenticated: state.authenticatedBuckets.length,
      failed: state.failedBuckets.length,
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
