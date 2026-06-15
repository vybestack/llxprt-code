/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TokenStore, OAuthTokenRequestMetadata } from './types.js';

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
  getSessionBucketScopeKey(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): string {
    const profileId =
      typeof metadata?.profileId === 'string' &&
      metadata.profileId.trim() !== ''
        ? metadata.profileId.trim()
        : undefined;

    return profileId ? `${provider}::${profileId}` : provider;
  }

  /**
   * Set session bucket override for a provider
   * Session state is in-memory only and not persisted
   */
  setSessionBucket(
    provider: string,
    bucket: string,
    metadata?: OAuthTokenRequestMetadata,
  ): void {
    this.sessionBuckets.set(
      this.getSessionBucketScopeKey(provider, metadata),
      bucket,
    );
  }

  /**
   * Get session bucket override for a provider
   * Returns undefined if no session override set
   */
  getSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): string | undefined {
    return this.sessionBuckets.get(
      this.getSessionBucketScopeKey(provider, metadata),
    );
  }

  /**
   * Clear session bucket override for a provider
   */
  clearSessionBucket(
    provider: string,
    metadata?: OAuthTokenRequestMetadata,
  ): void {
    this.sessionBuckets.delete(
      this.getSessionBucketScopeKey(provider, metadata),
    );
  }

  /**
   * Clear all session bucket overrides for a provider
   */
  clearAllSessionBuckets(provider: string): void {
    for (const key of Array.from(this.sessionBuckets.keys())) {
      if (key === provider || key.startsWith(`${provider}::`)) {
        this.sessionBuckets.delete(key);
      }
    }
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
