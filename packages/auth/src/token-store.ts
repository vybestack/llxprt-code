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
import type { OwnerLiveness } from './lock-owner.js';

export type LockSchemaClassification =
  | 'absent'
  | 'versioned'
  | 'legacy'
  | 'malformed';

export type LockStartTimeSource = 'canonical' | 'approximate' | 'unavailable';

/**
 * Advisory visibility of the token stored for this provider+bucket.
 *
 * This is intentionally decoupled from filesystem lock safety. A keychain
 * backend error yields 'unknown' so status, safe recovery, and forced
 * recovery can still operate; the diagnostic is surfaced for CLI display.
 * 'valid' means a non-expired token is present; 'invalid' means absent or
 * expired.
 */
export type TokenVisibility =
  | { readonly status: 'valid' }
  | { readonly status: 'invalid' }
  | { readonly status: 'unknown'; readonly diagnostic: string };

export interface AuthLockStatus {
  readonly provider: string;
  readonly bucket: string;
  readonly exists: boolean;
  readonly canonicalPath: string;
  readonly classification: LockSchemaClassification;
  readonly ownerPid: number | null;
  readonly ownerHostname: string | null;
  readonly ownerStartTimeMs: number | null;
  readonly ownerStartTimeSource: LockStartTimeSource;
  readonly liveness: OwnerLiveness;
  readonly ageMs: number | null;
  /**
   * Advisory token visibility, decoupled from lock safety.
   * Replaces the former boolean `hasValidToken`.
   */
  readonly tokenVisibility: TokenVisibility;
}

export interface AuthLockRecoveryResult {
  readonly provider: string;
  readonly bucket: string;
  readonly recovered: boolean;
  readonly reason: string;
  readonly canonicalPath: string;
  readonly cleanupDiagnostic?: string;
}

export interface ForceRecoverOptions {
  readonly acknowledgeAllStopped: boolean;
}

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
   *   - bucket: Optional bucket name for multi-account support
   * @returns true if lock was acquired, false otherwise
   */
  acquireRefreshLock(
    provider: string,
    options?: { waitMs?: number; bucket?: string },
  ): Promise<boolean>;

  /**
   * Release the refresh lock for a provider
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   */
  releaseRefreshLock(provider: string, bucket?: string): Promise<void>;

  /**
   * Acquire an auth lock for a provider to prevent concurrent interactive authentication
   * @param provider - The provider name
   * @param options - Optional configuration for lock behavior
   *   - waitMs: Maximum time to wait for lock (default: 60000ms)
   *   - bucket: Optional bucket name for multi-account support
   * @returns true if lock was acquired, false otherwise
   */
  acquireAuthLock(
    provider: string,
    options?: {
      waitMs?: number;
      bucket?: string;
      onWait?: () => Promise<boolean>;
    },
  ): Promise<boolean>;

  /**
   * Release the auth lock for a provider
   * @param provider - The provider name
   * @param bucket - Optional bucket name for multi-account support
   */
  releaseAuthLock(provider: string, bucket?: string): Promise<void>;

  /**
   * Optionally inspect the auth lock status for a provider+bucket without
   * modifying it. Never exposes owner tokens or credentials. Callers must
   * check that this method exists before invoking it.
   */
  inspectAuthLock?(provider: string, bucket?: string): Promise<AuthLockStatus>;

  /**
   * Attempt fenced recovery of a proven-dead auth lock.
   * Only succeeds when the lock owner is definitively absent.
   */
  recoverAuthLock?(
    provider: string,
    bucket?: string,
  ): Promise<AuthLockRecoveryResult>;

  /**
   * Force-remove a stuck auth lock.
   * Refuses verified-live owners.
   * For legacy/malformed/unverifiable residue, requires explicit acknowledgment
   * that all LLxprt processes sharing the path have been stopped.
   * Removes only the lock file, never tokens.
   */
  forceRecoverAuthLock?(
    provider: string,
    bucket?: string,
    options?: ForceRecoverOptions,
  ): Promise<AuthLockRecoveryResult>;
}
