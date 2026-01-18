/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { promises as fs } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  type OAuthToken,
  OAuthTokenSchema,
  type BucketStats,
} from './types.js';

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

interface LockInfo {
  pid: number;
  timestamp: number;
}

/**
 * Implementation of multi-provider token storage
 * Stores tokens securely in ~/.llxprt/oauth/ directory
 */
export class MultiProviderTokenStore implements TokenStore {
  private readonly basePath: string;
  private readonly DEFAULT_LOCK_WAIT_MS = 10000; // 10 seconds
  private readonly DEFAULT_STALE_THRESHOLD_MS = 30000; // 30 seconds

  constructor(basePath?: string) {
    this.basePath = basePath ?? join(homedir(), '.llxprt', 'oauth');
  }

  /**
   * Save an OAuth token for a specific provider
   */
  async saveToken(
    provider: string,
    token: OAuthToken,
    bucket?: string,
  ): Promise<void> {
    // Validate provider name
    if (!provider || provider.trim() === '') {
      throw new Error('Provider name cannot be empty');
    }

    // Validate bucket name if provided
    if (bucket) {
      this.validateBucketName(bucket);
    }

    // Validate token structure, but allow extra provider-specific fields (e.g., account_id for Codex)
    const validatedToken = OAuthTokenSchema.passthrough().parse(token);

    // Ensure directory exists with secure permissions
    await this.ensureDirectory();

    // Generate file paths
    const tokenPath = this.getTokenPath(provider, bucket);
    const tempPath = `${tokenPath}.tmp-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

    try {
      // Write to temporary file first (atomic operation)
      await fs.writeFile(tempPath, JSON.stringify(validatedToken, null, 2), {
        mode: 0o600,
      });

      // Set secure permissions explicitly (skip on Windows)
      if (process.platform !== 'win32') {
        await fs.chmod(tempPath, 0o600);
      }

      // Atomic rename to final location
      await fs.rename(tempPath, tokenPath);
    } catch (error) {
      // Cleanup temp file if it exists
      try {
        await fs.unlink(tempPath);
      } catch {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Retrieve an OAuth token for a specific provider
   */
  async getToken(
    provider: string,
    bucket?: string,
  ): Promise<OAuthToken | null> {
    // Validate bucket name if provided
    if (bucket) {
      this.validateBucketName(bucket);
    }

    try {
      const tokenPath = this.getTokenPath(provider, bucket);
      const content = await fs.readFile(tokenPath, 'utf8');
      const parsed = JSON.parse(content);

      // Validate token structure, but allow extra provider-specific fields (e.g., account_id for Codex)
      const validatedToken = OAuthTokenSchema.passthrough().parse(parsed);
      return validatedToken;
    } catch (_error) {
      // Token not found
      return null;
    }
  }

  /**
   * Remove an OAuth token for a specific provider
   */
  async removeToken(provider: string, bucket?: string): Promise<void> {
    // Validate bucket name if provided
    if (bucket) {
      this.validateBucketName(bucket);
    }

    try {
      const tokenPath = this.getTokenPath(provider, bucket);
      await fs.unlink(tokenPath);
    } catch (error) {
      // Check if error is because file doesn't exist
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        // File doesn't exist - operation succeeds silently
        return;
      }
      // Re-throw other errors
      throw error;
    }
  }

  /**
   * List all providers that have stored tokens
   */
  async listProviders(): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      const providers = files
        .filter((file) => file.endsWith('.json'))
        .map((file) => file.replace('.json', ''))
        .sort();
      return providers;
    } catch (error) {
      // If directory doesn't exist, return empty array
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * List all buckets for a specific provider
   */
  async listBuckets(provider: string): Promise<string[]> {
    try {
      const files = await fs.readdir(this.basePath);
      const providerPrefix = `${provider}`;
      const buckets = files
        .filter(
          (file) => file.startsWith(providerPrefix) && file.endsWith('.json'),
        )
        .map((file) => {
          const name = file.slice(0, -5); // Remove .json extension
          if (name === provider) {
            return 'default';
          }
          // Remove "provider-" prefix to get bucket name
          return name.slice(provider.length + 1);
        })
        .sort();
      return buckets;
    } catch (error) {
      // If directory doesn't exist, return empty array
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Get usage statistics for a specific bucket
   * Returns placeholder statistics for now
   */
  async getBucketStats(
    provider: string,
    bucket: string,
  ): Promise<BucketStats | null> {
    // Validate bucket name if provided
    if (bucket) {
      this.validateBucketName(bucket);
    }

    // Check if bucket exists
    const token = await this.getToken(provider, bucket);
    if (!token) {
      return null;
    }

    // Return placeholder stats - actual implementation would track usage
    return {
      bucket,
      requestCount: 0,
      percentage: 0,
      lastUsed: undefined,
    };
  }

  /**
   * Ensure the OAuth directory exists with secure permissions
   */
  private async ensureDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.basePath, { recursive: true, mode: 0o700 });

      // Ensure permissions are correct even if directory already existed (skip on Windows)
      if (process.platform !== 'win32') {
        await fs.chmod(this.basePath, 0o700);

        // Also ensure parent .llxprt directory has secure permissions
        const parentDir = join(homedir(), '.llxprt');
        await fs.chmod(parentDir, 0o700);
      }
    } catch (error) {
      // If chmod fails because directory doesn't exist, that's fine
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }
      throw error;
    }
  }

  /**
   * Generate secure file path for a provider token
   * Uses path.join to prevent path traversal attacks
   */
  private getTokenPath(provider: string, bucket?: string): string {
    const bucketSuffix = bucket && bucket !== 'default' ? `-${bucket}` : '';
    return join(this.basePath, `${provider}${bucketSuffix}.json`);
  }

  /**
   * Validate bucket name for filesystem safety
   * Rejects characters that could cause issues with file paths
   */
  private validateBucketName(bucket: string): void {
    const invalidChars = /[:/\\<>"|?*]/;
    if (invalidChars.test(bucket)) {
      throw new Error(
        `Invalid bucket name: "${bucket}". Bucket names cannot contain: : / \\ < > " | ? *`,
      );
    }
  }

  /**
   * Acquire a refresh lock for a provider to prevent concurrent token refreshes
   * Implements the lock mechanism required for issue #1159
   *
   * @param provider - The provider name
   * @param options - Configuration for lock behavior
   *   - waitMs: Maximum time to wait for lock (default: 10s)
   *   - staleMs: Threshold for considering a lock stale (default: 30s)
   *   - bucket: Optional bucket name for multi-account support
   * @returns true if lock was acquired, false otherwise
   */
  async acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; staleMs?: number; bucket?: string },
  ): Promise<boolean> {
    // Validate bucket name if provided
    if (options?.bucket) {
      this.validateBucketName(options.bucket);
    }

    const lockPath = this.getLockPath(provider, options?.bucket);
    const waitMs = options?.waitMs ?? this.DEFAULT_LOCK_WAIT_MS;
    const staleMs = options?.staleMs ?? this.DEFAULT_STALE_THRESHOLD_MS;
    const startTime = Date.now();

    // Ensure directory exists
    await this.ensureDirectory();

    while (Date.now() - startTime < waitMs) {
      try {
        // Try to read existing lock
        const lockContent = await fs.readFile(lockPath, 'utf8');
        const lockInfo: LockInfo = JSON.parse(lockContent);
        const lockAge = Date.now() - lockInfo.timestamp;

        // Check if lock is stale
        if (lockAge > staleMs) {
          // Lock is stale, break it and acquire
          await this.breakLock(lockPath);
          // Continue to next iteration to try creating lock
          continue;
        }

        // Lock is recent, wait and retry
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        // Handle different error cases
        if (
          error &&
          typeof error === 'object' &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          // Lock file doesn't exist, try to create it
          const created = await this.createLock(lockPath);
          if (created) {
            return true;
          }
          // EEXIST race - another process created it first, continue waiting
          continue;
        }
        // If JSON parse fails (corrupted lock), break it and retry
        await this.breakLock(lockPath);
        continue;
      }
    }

    // Timeout waiting for lock
    return false;
  }

  /**
   * Release the refresh lock for a provider
   *
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   */
  async releaseRefreshLock(provider: string, bucket?: string): Promise<void> {
    // Validate bucket name if provided
    if (bucket) {
      this.validateBucketName(bucket);
    }

    const lockPath = this.getLockPath(provider, bucket);
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      // Ignore errors if lock doesn't exist
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }

  /**
   * Create a lock file with current process info
   */
  private async createLock(lockPath: string): Promise<boolean> {
    try {
      const lockInfo: LockInfo = {
        pid: process.pid,
        timestamp: Date.now(),
      };
      await fs.writeFile(lockPath, JSON.stringify(lockInfo), {
        flag: 'wx', // Exclusive write - fails if file exists
        mode: 0o600,
      });
      return true;
    } catch (error) {
      // Lock already exists, another process beat us to it
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'EEXIST'
      ) {
        return false;
      }
      throw error;
    }
  }

  /**
   * Break a stale lock by removing it
   */
  private async breakLock(lockPath: string): Promise<void> {
    try {
      await fs.unlink(lockPath);
    } catch (error) {
      // Ignore if already removed
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
    }
  }

  /**
   * Get the lock file path for a provider (with optional bucket support)
   */
  private getLockPath(provider: string, bucket?: string): string {
    const bucketSuffix = bucket && bucket !== 'default' ? `-${bucket}` : '';
    return join(this.basePath, `${provider}${bucketSuffix}-refresh.lock`);
  }
}
