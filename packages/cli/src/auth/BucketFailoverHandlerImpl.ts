/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * @plan PLAN-20251213issue490
 * Implementation of BucketFailoverHandler for CLI package
 *
 * This class wraps OAuthManager to provide bucket failover capabilities
 * during API calls when rate limits or quota errors are encountered.
 */

import {
  BucketFailoverHandler,
  DebugLogger,
} from '@vybestack/llxprt-code-core';
import type { OAuthManager } from './oauth-manager.js';

const logger = new DebugLogger('llxprt:bucket:failover:handler');

/**
 * CLI implementation of BucketFailoverHandler
 *
 * Uses OAuthManager to:
 * - Track available buckets from profile configuration
 * - Switch between buckets on failover
 * - Refresh OAuth tokens when switching buckets
 */
export class BucketFailoverHandlerImpl implements BucketFailoverHandler {
  private buckets: string[];
  private currentBucketIndex: number;
  private readonly provider: string;
  private readonly oauthManager: OAuthManager;

  constructor(buckets: string[], provider: string, oauthManager: OAuthManager) {
    this.buckets = buckets;
    this.currentBucketIndex = 0;
    this.provider = provider;
    this.oauthManager = oauthManager;

    // Align the handler state with any existing session override.
    const sessionBucket = this.oauthManager.getSessionBucket(provider);
    if (sessionBucket) {
      const existingIndex = this.buckets.indexOf(sessionBucket);
      if (existingIndex >= 0) {
        this.currentBucketIndex = existingIndex;
      }
    } else if (this.buckets.length > 0) {
      // Default to the first configured bucket for this session.
      this.oauthManager.setSessionBucket(provider, this.buckets[0]);
    }

    logger.debug('BucketFailoverHandler initialized', {
      provider,
      bucketCount: buckets.length,
      buckets,
    });
  }

  /**
   * Get the list of available buckets
   */
  getBuckets(): string[] {
    return [...this.buckets];
  }

  /**
   * Get the currently active bucket
   */
  getCurrentBucket(): string | undefined {
    if (this.currentBucketIndex >= this.buckets.length) {
      return undefined;
    }
    return this.buckets[this.currentBucketIndex];
  }

  /**
   * Try to failover to the next bucket
   *
   * This method:
   * 1. Moves to the next bucket in the list
   * 2. Refreshes the OAuth token for that bucket
   * 3. Returns true if successful, false if no more buckets
   */
  async tryFailover(): Promise<boolean> {
    const currentBucket = this.getCurrentBucket();

    for (let i = 1; i < this.buckets.length; i++) {
      const nextIndex = (this.currentBucketIndex + i) % this.buckets.length;
      const nextBucket = this.buckets[nextIndex];
      logger.debug('Attempting bucket failover', {
        provider: this.provider,
        fromBucket: currentBucket,
        toBucket: nextBucket,
        bucketIndex: nextIndex,
        totalBuckets: this.buckets.length,
      });

      try {
        // Ensure the target bucket is usable before switching session state.
        const token = await this.oauthManager.getOAuthToken(
          this.provider,
          nextBucket,
        );
        if (!token) {
          throw new Error(
            `No OAuth token available for provider '${this.provider}' bucket '${nextBucket}'`,
          );
        }

        this.currentBucketIndex = nextIndex;
        this.oauthManager.setSessionBucket(this.provider, nextBucket);

        console.warn(
          `Bucket failover: switching from ${currentBucket} to ${nextBucket}`,
        );
        logger.debug('Bucket failover successful', {
          provider: this.provider,
          newBucket: nextBucket,
          bucketIndex: nextIndex,
        });

        return true;
      } catch (error) {
        logger.debug('Bucket failover failed - could not refresh token', {
          provider: this.provider,
          bucket: nextBucket,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    console.error(
      `Bucket failover: all buckets exhausted for provider ${this.provider}`,
    );
    logger.debug('No more buckets available for failover', {
      provider: this.provider,
      currentBucket,
      attemptedAll: true,
    });
    return false;
  }

  /**
   * Check if bucket failover is enabled
   * Returns true if there are multiple buckets configured
   */
  isEnabled(): boolean {
    return this.buckets.length > 1;
  }

  /**
   * Reset to the first bucket (useful for new sessions)
   */
  reset(): void {
    this.currentBucketIndex = 0;
    logger.debug('Bucket failover handler reset', {
      provider: this.provider,
    });
  }
}
