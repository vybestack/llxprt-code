/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260213-KEYRINGTOKENSTORE.P10
 * @requirement R13.2
 */

import { type OAuthToken, type BucketStats } from './types.js';

/**
 * Interface for multi-provider OAuth token storage
 */
export interface TokenStore {
  /**
   * Save an OAuth token for a specific provider
   * @param provider - The provider name (e.g., 'gemini', 'qwen')
   * @param token - The OAuth token to save
   * @param bucket - Optional bucket name for multi-account support
   */
  saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void>;

  /**
   * Retrieve an OAuth token for a specific provider
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   * @returns The token if found, null otherwise
   */
  getToken(provider: string, bucket?: string): Promise<OAuthToken | null>;

  /**
   * Remove an OAuth token for a specific provider
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   */
  removeToken(provider: string, bucket?: string): Promise<void>;

  /**
   * List all providers that have stored tokens
   * @returns Array of provider names with stored tokens
   */
  listProviders(): Promise<string[]>;

  /**
   * List all buckets for a specific provider
   * @param provider - The provider name
   * @returns Array of bucket names for the provider
   */
  listBuckets(provider: string): Promise<string[]>;

  /**
   * Get usage statistics for a specific bucket
   * @param provider - The provider name
   * @param bucket - The bucket name
   * @returns Bucket statistics if available, null otherwise
   */
  getBucketStats(provider: string, bucket: string): Promise<BucketStats | null>;

  /**
   * Acquire a refresh lock for a provider to prevent concurrent refreshes
   * @param provider - The provider name
   * @param options - Optional configuration for lock behavior
   *   - waitMs: Maximum time to wait for lock
   *   - staleMs: Threshold for considering a lock stale
   *   - bucket: Optional bucket name for multi-account support
   * @returns true if lock was acquired, false otherwise
   */
  acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean>;

  /**
   * Release the refresh lock for a provider
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   */
  releaseRefreshLock(provider: string, bucket?: string): Promise<void>;
}
