/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenStore } from './types.js';

/**
 * Bucket status information
 */
export interface BucketStatus {
  bucket: string;
  authenticated: boolean;
  expiry?: number;
  expiresIn?: number;
}

/**
 * Manages OAuth bucket state and resolution
 * Provides session bucket overrides, bucket resolution, and failover support
 */
export class OAuthBucketManager {
  private readonly tokenStore: TokenStore;
  private readonly sessionBuckets: Map<string, string>;

  constructor(tokenStore: TokenStore) {
    this.tokenStore = tokenStore;
    this.sessionBuckets = new Map();
  }

  /**
   * Set session bucket override for a provider
   * Session state is in-memory only and not persisted
   */
  setSessionBucket(provider: string, bucket: string): void {
    this.sessionBuckets.set(provider, bucket);
  }

  /**
   * Get session bucket override for a provider
   * Returns undefined if no session override set
   */
  getSessionBucket(provider: string): string | undefined {
    return this.sessionBuckets.get(provider);
  }

  /**
   * Clear session bucket override for a provider
   */
  clearSessionBucket(provider: string): void {
    this.sessionBuckets.delete(provider);
  }

  /**
   * Resolve bucket for a provider
   * Priority: session override > first profile bucket > 'default'
   */
  resolveBucket(provider: string, profileBuckets?: string[]): string {
    const sessionBucket = this.sessionBuckets.get(provider);
    if (sessionBucket) {
      return sessionBucket;
    }

    if (profileBuckets && profileBuckets.length > 0) {
      return profileBuckets[0];
    }

    return 'default';
  }

  /**
   * Get bucket status including authentication and expiry information
   */
  async getBucketStatus(
    provider: string,
    bucket: string,
  ): Promise<BucketStatus> {
    const token = await this.tokenStore.getToken(provider, bucket);

    if (!token) {
      return {
        bucket,
        authenticated: false,
      };
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    const expiresIn = token.expiry - nowSeconds;

    return {
      bucket,
      authenticated: true,
      expiry: token.expiry,
      expiresIn,
    };
  }

  /**
   * Get status for all buckets of a provider
   */
  async getAllBucketStatus(provider: string): Promise<BucketStatus[]> {
    const buckets = await this.tokenStore.listBuckets(provider);
    const statuses: BucketStatus[] = [];

    for (const bucket of buckets) {
      const status = await this.getBucketStatus(provider, bucket);
      statuses.push(status);
    }

    return statuses;
  }

  /**
   * Validate that a bucket exists for a provider
   * Throws error if bucket not found
   */
  async validateBucketExists(provider: string, bucket: string): Promise<void> {
    const token = await this.tokenStore.getToken(provider, bucket);

    if (!token) {
      throw new Error(
        `OAuth bucket '${bucket}' for provider '${provider}' not found. ` +
          `Use /auth ${provider} login ${bucket} to authenticate.`,
      );
    }
  }

  /**
   * Get next bucket in failover chain
   * Returns undefined if no more buckets available
   */
  getNextBucket(
    provider: string,
    currentBucket: string,
    profileBuckets: string[],
  ): string | undefined {
    const currentIndex = profileBuckets.indexOf(currentBucket);

    if (currentIndex === -1) {
      return undefined;
    }

    const nextIndex = currentIndex + 1;
    if (nextIndex >= profileBuckets.length) {
      return undefined;
    }

    return profileBuckets[nextIndex];
  }
}
