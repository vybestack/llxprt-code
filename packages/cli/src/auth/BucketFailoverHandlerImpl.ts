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
  type FailoverContext,
  type BucketFailureReason,
  type OAuthToken,
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
  private triedBucketsThisSession: Set<string>;

  /**
   * @plan PLAN-20260223-ISSUE1598.P05
   * @requirement REQ-1598-IC09
   * Record of failure reasons for buckets evaluated during last failover attempt
   */
  private lastFailoverReasons: Record<string, BucketFailureReason> = {};

  constructor(buckets: string[], provider: string, oauthManager: OAuthManager) {
    this.buckets = buckets;
    this.currentBucketIndex = 0;
    this.provider = provider;
    this.oauthManager = oauthManager;
    this.triedBucketsThisSession = new Set<string>();

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
   * @plan PLAN-20260223-ISSUE1598.P05
   * @requirement REQ-1598-FL01, CL01, CL02, CL03, CL04, CL07, CL09, FL12
   * @pseudocode failover-handler.md lines 1-58
   *
   * This method implements the three-pass failover algorithm:
   * Pass 1: Classify the triggering bucket based on context and token state
   * Pass 2: Find next candidate with valid/refreshable token
   * Pass 3: Attempt foreground reauth for expired/missing tokens
   */
  async tryFailover(context?: FailoverContext): Promise<boolean> {
    // Clear reasons from previous attempt (REQ-1598-CL09)
    this.lastFailoverReasons = {};

    const currentBucket = this.getCurrentBucket();

    // ============================================================
    // PASS 1: CLASSIFY TRIGGERING BUCKET
    // ============================================================

    if (!currentBucket) {
      logger.debug('No current bucket to classify');
      return false;
    }

    let reason: BucketFailureReason | null = null;

    // Check for explicit 429/402 status (REQ-1598-CL01)
    if (
      context?.triggeringStatus === 429 ||
      context?.triggeringStatus === 402
    ) {
      reason = 'quota-exhausted';
      logger.debug('Classified triggering bucket as quota-exhausted', {
        provider: this.provider,
        bucket: currentBucket,
        status: context.triggeringStatus,
      });
    } else {
      // Check if token exists and its state (expired vs valid)
      // Use getTokenStore() to read raw token state without triggering refresh
      let storedToken: OAuthToken | null = null;
      try {
        storedToken = await this.oauthManager
          .getTokenStore()
          .getToken(this.provider, currentBucket);
      } catch (error) {
        // Token-store read error (REQ-1598-CL04)
        logger.warn(
          `Token read failed for ${this.provider}/${currentBucket}:`,
          error,
        );
        reason = 'no-token';
      }

      if (storedToken && reason === null) {
        const nowSec = Math.floor(Date.now() / 1000);
        const remainingSec = storedToken.expiry - nowSec;

        if (remainingSec <= 0) {
          // Token expired — attempt refresh via getOAuthToken (REQ-1598-CL02, CL07)
          try {
            const refreshedToken = await this.oauthManager.getOAuthToken(
              this.provider,
              currentBucket,
            );
            if (refreshedToken && refreshedToken.expiry > nowSec) {
              // Refresh succeeded for triggering bucket — no failover needed (REQ-1598-CL07)
              logger.debug(
                'Refresh succeeded for triggering bucket — no failover needed',
                {
                  provider: this.provider,
                  bucket: currentBucket,
                },
              );
              return true;
            }
          } catch (refreshError) {
            logger.debug(`Refresh failed for triggering bucket:`, refreshError);
          }
          // Refresh failed or returned null
          reason = 'expired-refresh-failed';
        } else if (
          context?.triggeringStatus === 401 ||
          context?.triggeringStatus === 403
        ) {
          // Token looks valid locally but was rejected server-side (revoked).
          // getOAuthToken would return this same token, so classify directly
          // for Pass 3 foreground reauth instead of marking 'skipped'.
          reason = 'expired-refresh-failed';
        } else {
          // Token exists and is not expired — failure isn't credential-related
          reason = 'skipped';
        }
      } else if (reason === null) {
        // No token in store (REQ-1598-CL03)
        reason = 'no-token';
      }
    }

    // Record reason and mark bucket as tried (REQ-1598-FL12)
    this.lastFailoverReasons[currentBucket] = reason;
    this.triedBucketsThisSession.add(currentBucket);

    logger.debug('Pass 1 complete: triggering bucket classified', {
      provider: this.provider,
      bucket: currentBucket,
      reason,
    });

    // ============================================================
    // PASS 2: FIND NEXT CANDIDATE WITH VALID/REFRESHABLE TOKEN
    // @plan PLAN-20260223-ISSUE1598.P11
    // @requirement REQ-1598-FL03, FL04, FL05, FL06, FL13, FL14, FL17, FL18, CL05
    // @pseudocode failover-handler.md lines 60-121
    // ============================================================

    for (const bucket of this.buckets) {
      // Skip buckets already tried in this session (REQ-1598-FL13)
      if (this.triedBucketsThisSession.has(bucket)) {
        // Only mark as skipped if not already classified in Pass 1
        if (!this.lastFailoverReasons[bucket]) {
          this.lastFailoverReasons[bucket] = 'skipped';
        }
        continue;
      }

      // Check if token exists in store WITHOUT triggering refresh
      let storedToken: OAuthToken | null = null;
      try {
        storedToken = await this.oauthManager
          .getTokenStore()
          .getToken(this.provider, bucket);
      } catch (error) {
        logger.warn(`Token read failed for ${this.provider}/${bucket}:`, error);
        this.lastFailoverReasons[bucket] = 'no-token';
        continue;
      }

      if (storedToken === null) {
        this.lastFailoverReasons[bucket] = 'no-token';
        continue;
      }

      const nowSec = Math.floor(Date.now() / 1000);
      const remainingSec = storedToken.expiry - nowSec;

      // Token expired — attempt refresh (REQ-1598-FL17)
      if (remainingSec <= 0) {
        try {
          const refreshedToken = await this.oauthManager.getOAuthToken(
            this.provider,
            bucket,
          );
          if (refreshedToken && refreshedToken.expiry > nowSec) {
            // Refresh succeeded — switch bucket
            const bucketIndex = this.buckets.indexOf(bucket);
            if (bucketIndex >= 0) {
              this.currentBucketIndex = bucketIndex;
            }
            this.triedBucketsThisSession.add(bucket);
            try {
              this.oauthManager.setSessionBucket(this.provider, bucket);
            } catch (setError) {
              logger.warn(
                `Failed to set session bucket during pass-2 refresh: ${setError}`,
              );
              // Continue anyway — setSessionBucket failure should not abort failover
            }
            logger.warn(
              () =>
                `Bucket failover: switched to ${bucket} after refresh from ${currentBucket}`,
            );
            return true;
          }
        } catch (refreshError) {
          logger.debug(`Refresh failed for ${bucket}:`, refreshError);
        }
        this.lastFailoverReasons[bucket] = 'expired-refresh-failed';
        continue;
      }

      // Valid token found — use getOAuthToken to ensure it's still valid (might trigger refresh)
      let token: OAuthToken | null = null;
      try {
        token = await this.oauthManager.getOAuthToken(this.provider, bucket);
      } catch (error) {
        logger.warn(
          `Failed to get token for ${this.provider}/${bucket}:`,
          error,
        );
        this.lastFailoverReasons[bucket] = 'no-token';
        continue;
      }

      if (token === null) {
        this.lastFailoverReasons[bucket] = 'no-token';
        continue;
      }

      // Valid token confirmed — switch and succeed (REQ-1598-FL03, FL18)
      const bucketIndex = this.buckets.indexOf(bucket);
      if (bucketIndex >= 0) {
        this.currentBucketIndex = bucketIndex;
      }
      this.triedBucketsThisSession.add(bucket);
      try {
        this.oauthManager.setSessionBucket(this.provider, bucket);
      } catch (setError) {
        logger.warn(
          `Failed to set session bucket during pass-2 switch: ${setError}`,
        );
        // Continue anyway
      }
      logger.warn(
        () => `Bucket failover: switched from ${currentBucket} to ${bucket}`,
      );
      return true;
    }

    // ============================================================
    // PASS 3: FOREGROUND REAUTH FOR EXPIRED/MISSING TOKENS
    // @plan PLAN-20260223-ISSUE1598.P11
    // @requirement REQ-1598-FL07, FL08, FL09, FL10, FL14, FR01, FR03
    // @pseudocode failover-handler.md lines 123-170
    // ============================================================

    // Find first bucket classified as expired-refresh-failed or no-token.
    // Prefer untried buckets first; if none are available, fall back to the
    // triggering bucket itself — this covers the common single-bucket case
    // where the only bucket has an expired token whose refresh failed.
    let candidateBucket: string | undefined = undefined;
    for (const bucket of this.buckets) {
      const bucketReason = this.lastFailoverReasons[bucket];
      const reauthEligible =
        bucketReason === 'expired-refresh-failed' ||
        bucketReason === 'no-token';
      if (reauthEligible && !this.triedBucketsThisSession.has(bucket)) {
        candidateBucket = bucket;
        break;
      }
    }
    // Fallback: allow the triggering bucket when no untried candidate exists
    if (
      candidateBucket === undefined &&
      currentBucket &&
      (this.lastFailoverReasons[currentBucket] === 'expired-refresh-failed' ||
        this.lastFailoverReasons[currentBucket] === 'no-token')
    ) {
      candidateBucket = currentBucket;
    }

    if (candidateBucket !== undefined) {
      try {
        logger.debug(
          `Attempting foreground reauth for bucket: ${candidateBucket}`,
        );
        await this.oauthManager.authenticate(this.provider, candidateBucket);

        // Verify token exists after reauth (REQ-1598-FL08)
        const token = await this.oauthManager.getOAuthToken(
          this.provider,
          candidateBucket,
        );
        if (token === null) {
          logger.warn(
            `Foreground reauth succeeded but token is null for bucket: ${candidateBucket}`,
          );
          this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
          this.triedBucketsThisSession.add(candidateBucket);
        } else {
          // Reauth succeeded — switch bucket
          const bucketIndex = this.buckets.indexOf(candidateBucket);
          if (bucketIndex >= 0) {
            this.currentBucketIndex = bucketIndex;
          }
          this.triedBucketsThisSession.add(candidateBucket);
          try {
            this.oauthManager.setSessionBucket(this.provider, candidateBucket);
          } catch (setError) {
            logger.warn(
              `Failed to set session bucket during pass-3 reauth: ${setError}`,
            );
            // Continue anyway
          }
          logger.warn(
            () =>
              `Bucket failover: switched from ${currentBucket} to ${candidateBucket} after reauth`,
          );
          return true;
        }
      } catch (reauthError) {
        logger.warn(
          `Foreground reauth failed for bucket ${candidateBucket}:`,
          reauthError,
        );
        this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
        this.triedBucketsThisSession.add(candidateBucket);
      }
    }

    // All passes exhausted — failover unsuccessful
    logger.error(
      () =>
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
   * Reset the session tracking so failover can try buckets again in a new request.
   * Call this at the start of each new request to prevent infinite cycling.
   */
  resetSession(): void {
    this.triedBucketsThisSession.clear();
    logger.debug('Bucket failover session reset', {
      provider: this.provider,
    });
  }

  /**
   * Reset to the first bucket (useful for new sessions)
   */
  reset(): void {
    this.currentBucketIndex = 0;
    this.triedBucketsThisSession.clear();
    if (this.buckets.length > 0) {
      this.oauthManager.setSessionBucket(this.provider, this.buckets[0]);
    }
    logger.debug('Bucket failover handler reset', {
      provider: this.provider,
    });
  }

  /**
   * @plan PLAN-20260223-ISSUE1598.P05
   * @requirement REQ-1598-IC09
   * Get the failure reasons for buckets that were skipped during last failover
   * Returns a shallow copy to prevent external mutation
   */
  getLastFailoverReasons(): Record<string, BucketFailureReason> {
    return { ...this.lastFailoverReasons };
  }
}
