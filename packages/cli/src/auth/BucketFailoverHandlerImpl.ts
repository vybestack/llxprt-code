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
  type BucketFailoverHandler,
  DebugLogger,
  flushRuntimeAuthScope,
  type FailoverContext,
  type BucketFailureReason,
  type OAuthToken,
  type OAuthTokenRequestMetadata,
} from '@vybestack/llxprt-code-core';
import type { BucketFailoverOAuthManagerLike } from './types.js';

const logger = new DebugLogger('llxprt:bucket:failover:handler');

type BucketSwitchStage =
  | 'pass-2 refresh'
  | 'pass-2 switch'
  | 'pass-3 token re-check switch'
  | 'final pass-3 token re-check switch'
  | 'pass-3 reauth';

type TriggerClassificationResult = {
  reason: BucketFailureReason;
  completed: boolean;
};

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
  private readonly oauthManager: BucketFailoverOAuthManagerLike;
  private readonly metadata?: OAuthTokenRequestMetadata;
  private triedBucketsThisSession: Set<string>;
  private ensureBucketsAuthInFlight: Promise<void> | null = null;
  private foregroundReauthInFlightByBucket = new Map<
    string,
    Promise<boolean>
  >();

  /**
   * @plan PLAN-20260223-ISSUE1598.P05
   * @requirement REQ-1598-IC09
   * Record of failure reasons for buckets evaluated during last failover attempt
   */
  private lastFailoverReasons: Record<string, BucketFailureReason> = {};

  constructor(
    buckets: string[],
    provider: string,
    oauthManager: BucketFailoverOAuthManagerLike,
    metadata?: OAuthTokenRequestMetadata,
  ) {
    this.buckets = buckets;
    this.currentBucketIndex = 0;
    this.provider = provider;
    this.oauthManager = oauthManager;
    this.metadata = metadata;
    this.triedBucketsThisSession = new Set<string>();

    // Align the handler state with any existing session override.
    const sessionBucket = this.oauthManager.getSessionBucket(
      provider,
      this.metadata,
    );
    if (sessionBucket) {
      const existingIndex = this.buckets.indexOf(sessionBucket);
      if (existingIndex >= 0) {
        this.currentBucketIndex = existingIndex;
      }
    } else if (this.buckets.length > 0) {
      // Default to the first configured bucket for this session.
      this.oauthManager.setSessionBucket(
        provider,
        this.buckets[0],
        this.metadata,
      );
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

  getRequestMetadata(): OAuthTokenRequestMetadata | undefined {
    return this.metadata;
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
    this.lastFailoverReasons = {};
    this.syncCursorFromSession();

    const currentBucket = this.getCurrentBucket();
    if (!currentBucket) {
      logger.debug('No current bucket to classify');
      return false;
    }

    const classification = await this.classifyTriggeringBucket(
      currentBucket,
      context,
    );
    if (classification.completed) return true;
    this.recordTriggeringBucket(currentBucket, classification.reason);

    if (await this.tryPassTwoFailover(currentBucket)) return true;

    const candidateBucket = this.findPassThreeCandidate(currentBucket);
    if (candidateBucket !== undefined) {
      return this.tryForegroundReauth(currentBucket, candidateBucket);
    }

    this.logAllBucketsExhausted(currentBucket);
    return false;
  }

  private syncCursorFromSession(): void {
    const sessionBucket = this.oauthManager.getSessionBucket(
      this.provider,
      this.metadata,
    );
    if (sessionBucket) {
      const idx = this.buckets.indexOf(sessionBucket);
      if (idx >= 0) {
        this.currentBucketIndex = idx;
      }
    }
  }

  private async classifyTriggeringBucket(
    currentBucket: string,
    context?: FailoverContext,
  ): Promise<TriggerClassificationResult> {
    if (this.isQuotaStatus(context)) {
      logger.debug('Classified triggering bucket as quota-exhausted', {
        provider: this.provider,
        bucket: currentBucket,
        status: context?.triggeringStatus,
      });
      return { reason: 'quota-exhausted', completed: false };
    }

    const storedToken = await this.readStoredToken(currentBucket);
    if (storedToken === null) return { reason: 'no-token', completed: false };
    return this.classifyStoredToken(currentBucket, storedToken, context);
  }

  private isQuotaStatus(context?: FailoverContext): boolean {
    return (
      context?.triggeringStatus === 429 || context?.triggeringStatus === 402
    );
  }

  private async readStoredToken(bucket: string): Promise<OAuthToken | null> {
    try {
      return await this.oauthManager
        .getTokenStore()
        .getToken(this.provider, bucket);
    } catch (error) {
      logger.warn(`Token read failed for ${this.provider}/${bucket}:`, error);
      return null;
    }
  }

  private async classifyStoredToken(
    bucket: string,
    storedToken: OAuthToken,
    context?: FailoverContext,
  ): Promise<TriggerClassificationResult> {
    const nowSec = Math.floor(Date.now() / 1000);
    const remainingSec = storedToken.expiry - nowSec;

    if (remainingSec <= 0) {
      const completed = await this.refreshTriggeringBucket(bucket, nowSec);
      return { reason: 'expired-refresh-failed', completed };
    }
    if (
      context?.triggeringStatus === 401 ||
      context?.triggeringStatus === 403
    ) {
      return { reason: 'expired-refresh-failed', completed: false };
    }
    return { reason: 'skipped', completed: false };
  }

  private async refreshTriggeringBucket(
    bucket: string,
    nowSec: number,
  ): Promise<boolean> {
    try {
      const refreshedToken = await this.oauthManager.getOAuthToken(
        this.provider,
        bucket,
      );
      if (refreshedToken && refreshedToken.expiry > nowSec) {
        logger.debug(
          'Refresh succeeded for triggering bucket — no failover needed',
          {
            provider: this.provider,
            bucket,
          },
        );
        return true;
      }
    } catch (refreshError) {
      logger.debug(`Refresh failed for triggering bucket:`, refreshError);
    }
    return false;
  }

  private recordTriggeringBucket(
    currentBucket: string,
    reason: BucketFailureReason,
  ): void {
    this.lastFailoverReasons[currentBucket] = reason;
    this.triedBucketsThisSession.add(currentBucket);
    logger.debug('Pass 1 complete: triggering bucket classified', {
      provider: this.provider,
      bucket: currentBucket,
      reason,
    });
  }

  /**
   * PASS 2: FIND NEXT CANDIDATE WITH VALID/REFRESHABLE TOKEN
   * @plan PLAN-20260223-ISSUE1598.P11
   * @requirement REQ-1598-FL03, FL04, FL05, FL06, FL13, FL14, FL17, FL18, CL05
   * @pseudocode failover-handler.md lines 60-121
   */

  private async tryPassTwoFailover(currentBucket: string): Promise<boolean> {
    for (const bucket of this.buckets) {
      if (await this.tryPassTwoBucket(bucket, currentBucket)) return true;
    }
    return false;
  }

  private async tryPassTwoBucket(
    bucket: string,
    currentBucket: string,
  ): Promise<boolean> {
    if (this.triedBucketsThisSession.has(bucket)) {
      this.lastFailoverReasons[bucket] ??= 'skipped';
      return false;
    }

    const storedToken = await this.readPassTwoToken(bucket);
    if (storedToken === null) return false;

    const nowSec = Math.floor(Date.now() / 1000);
    if (storedToken.expiry - nowSec <= 0) {
      return this.tryRefreshCandidate(bucket, currentBucket, nowSec);
    }
    return this.tryValidCandidate(bucket, currentBucket);
  }

  private async readPassTwoToken(bucket: string): Promise<OAuthToken | null> {
    const storedToken = await this.readStoredToken(bucket);
    if (storedToken === null) {
      this.lastFailoverReasons[bucket] = 'no-token';
    }
    return storedToken;
  }

  private async tryRefreshCandidate(
    bucket: string,
    currentBucket: string,
    nowSec: number,
  ): Promise<boolean> {
    try {
      const refreshedToken = await this.oauthManager.getOAuthToken(
        this.provider,
        bucket,
      );
      if (refreshedToken && refreshedToken.expiry > nowSec) {
        this.switchToBucket(bucket, 'pass-2 refresh');
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
    return false;
  }

  private async tryValidCandidate(
    bucket: string,
    currentBucket: string,
  ): Promise<boolean> {
    let token: OAuthToken | null = null;
    try {
      token = await this.oauthManager.getOAuthToken(this.provider, bucket);
    } catch (error) {
      logger.warn(`Failed to get token for ${this.provider}/${bucket}:`, error);
      this.lastFailoverReasons[bucket] = 'no-token';
      return false;
    }

    if (token === null) {
      this.lastFailoverReasons[bucket] = 'no-token';
      return false;
    }

    this.switchToBucket(bucket, 'pass-2 switch');
    logger.warn(
      () => `Bucket failover: switched from ${currentBucket} to ${bucket}`,
    );
    return true;
  }

  private switchToBucket(bucket: string, stage: BucketSwitchStage): void {
    const bucketIndex = this.buckets.indexOf(bucket);
    if (bucketIndex >= 0) {
      this.currentBucketIndex = bucketIndex;
    }
    this.triedBucketsThisSession.add(bucket);
    try {
      this.oauthManager.setSessionBucket(this.provider, bucket, this.metadata);
    } catch (setError) {
      logger.warn(`Failed to set session bucket during ${stage}: ${setError}`);
    }
  }

  private findPassThreeCandidate(currentBucket: string): string | undefined {
    for (const bucket of this.buckets) {
      const bucketReason = this.lastFailoverReasons[bucket];
      const reauthEligible =
        bucketReason === 'expired-refresh-failed' ||
        bucketReason === 'no-token';
      if (reauthEligible && !this.triedBucketsThisSession.has(bucket)) {
        return bucket;
      }
    }
    if (this.isTriggeringBucketReauthEligible(currentBucket))
      return currentBucket;
    return undefined;
  }

  private isTriggeringBucketReauthEligible(currentBucket: string): boolean {
    const reason = this.lastFailoverReasons[currentBucket];
    return reason === 'expired-refresh-failed' || reason === 'no-token';
  }

  private async tryForegroundReauth(
    currentBucket: string,
    candidateBucket: string,
  ): Promise<boolean> {
    const existingForegroundReauth =
      this.foregroundReauthInFlightByBucket.get(candidateBucket);
    if (existingForegroundReauth) return existingForegroundReauth;

    const pass3Promise = this.runPassThreeReauth(
      currentBucket,
      candidateBucket,
    );
    this.foregroundReauthInFlightByBucket.set(candidateBucket, pass3Promise);
    try {
      return await pass3Promise;
    } finally {
      const current =
        this.foregroundReauthInFlightByBucket.get(candidateBucket);
      if (current === pass3Promise) {
        this.foregroundReauthInFlightByBucket.delete(candidateBucket);
      }
    }
  }
  /**
   * PASS 3: FOREGROUND REAUTH FOR EXPIRED/MISSING TOKENS
   * @plan PLAN-20260223-ISSUE1598.P11
   * @requirement REQ-1598-FL07, FL08, FL09, FL10, FL14, FR01, FR03
   * @pseudocode failover-handler.md lines 123-170
   */

  private async runPassThreeReauth(
    currentBucket: string,
    candidateBucket: string,
  ): Promise<boolean> {
    await this.waitForEagerAuth(
      candidateBucket,
      'Foreground reauth waiting for in-flight eager auth',
      'In-flight eager auth failed before pass-3 reauth',
    );
    if (await this.tryPassThreeTokenRecheck(currentBucket, candidateBucket)) {
      return true;
    }

    await this.waitForEagerAuth(
      candidateBucket,
      'Foreground reauth detected late in-flight eager auth',
      'Late in-flight eager auth failed before pass-3 reauth',
    );
    if (
      await this.tryFinalPassThreeTokenRecheck(currentBucket, candidateBucket)
    ) {
      return true;
    }

    return this.performForegroundReauth(currentBucket, candidateBucket);
  }

  private async waitForEagerAuth(
    candidateBucket: string,
    waitingMessage: string,
    failureMessage: string,
  ): Promise<void> {
    const eagerAuthInFlight = this.ensureBucketsAuthInFlight;
    if (!eagerAuthInFlight) return;

    logger.debug(
      `${waitingMessage} (provider=${this.provider}, bucket=${candidateBucket})`,
    );
    try {
      await eagerAuthInFlight;
    } catch (error) {
      logger.debug(`${failureMessage} for ${candidateBucket}:`, error);
    }
  }

  private async tryPassThreeTokenRecheck(
    currentBucket: string,
    candidateBucket: string,
  ): Promise<boolean> {
    return this.tryTokenRecheckSwitch(
      currentBucket,
      candidateBucket,
      'pass-3 token re-check switch',
      `Token re-check failed before pass-3 reauth for ${candidateBucket}:`,
      `Bucket failover: switched from ${currentBucket} to ${candidateBucket} after token became available`,
    );
  }

  private async tryFinalPassThreeTokenRecheck(
    currentBucket: string,
    candidateBucket: string,
  ): Promise<boolean> {
    return this.tryTokenRecheckSwitch(
      currentBucket,
      candidateBucket,
      'final pass-3 token re-check switch',
      `Final token re-check failed before pass-3 reauth for ${candidateBucket}:`,
      `Bucket failover: switched from ${currentBucket} to ${candidateBucket} after final token re-check`,
    );
  }

  private async tryTokenRecheckSwitch(
    currentBucket: string,
    candidateBucket: string,
    stage: BucketSwitchStage,
    failureMessage: string,
    successMessage: string,
  ): Promise<boolean> {
    let token: OAuthToken | null = null;
    try {
      token = await this.oauthManager.getOAuthToken(
        this.provider,
        candidateBucket,
      );
    } catch (error) {
      logger.debug(failureMessage, error);
    }
    if (token === null) return false;

    this.switchToBucket(candidateBucket, stage);
    logger.warn(() => successMessage);
    return true;
  }

  private async performForegroundReauth(
    currentBucket: string,
    candidateBucket: string,
  ): Promise<boolean> {
    try {
      logger.debug(
        `Attempting foreground reauth for bucket: ${candidateBucket}`,
      );
      await this.oauthManager.authenticate(this.provider, candidateBucket);
      const token = await this.oauthManager.getOAuthToken(
        this.provider,
        candidateBucket,
      );
      if (token === null) {
        this.recordReauthFailure(candidateBucket);
        return false;
      }

      this.switchToBucket(candidateBucket, 'pass-3 reauth');
      logger.warn(
        () =>
          `Bucket failover: switched from ${currentBucket} to ${candidateBucket} after reauth`,
      );
      return true;
    } catch (reauthError) {
      logger.warn(
        `Foreground reauth failed for bucket ${candidateBucket}:`,
        reauthError,
      );
      this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
      this.triedBucketsThisSession.add(candidateBucket);
      return false;
    }
  }

  private recordReauthFailure(candidateBucket: string): void {
    logger.warn(
      `Foreground reauth succeeded but token is null for bucket: ${candidateBucket}`,
    );
    this.lastFailoverReasons[candidateBucket] = 'reauth-failed';
    this.triedBucketsThisSession.add(candidateBucket);
  }

  private logAllBucketsExhausted(currentBucket: string): void {
    logger.error(
      () =>
        `Bucket failover: all buckets exhausted for provider ${this.provider}`,
    );
    logger.debug('No more buckets available for failover', {
      provider: this.provider,
      currentBucket,
      attemptedAll: true,
    });
  }

  /**
   * Check if bucket failover is enabled
   * Returns true if there are multiple buckets configured
   */
  isEnabled(): boolean {
    return this.buckets.length > 1;
  }

  /**
   * @fix issue1616
   * Eagerly authenticate all unauthenticated buckets at turn boundaries.
   * Delegates to OAuthManager.authenticateMultipleBuckets which respects
   * auth-bucket-prompt/delay ephemerals and skips already-authenticated buckets.
   * No-op for single-bucket profiles (no failover needed).
   */
  async ensureBucketsAuthenticated(): Promise<void> {
    if (this.buckets.length <= 1) {
      return;
    }

    if (this.ensureBucketsAuthInFlight) {
      await this.ensureBucketsAuthInFlight;
      return;
    }

    const authPromise = this.oauthManager
      .authenticateMultipleBuckets(this.provider, this.buckets, this.metadata)
      .finally(() => {
        if (this.ensureBucketsAuthInFlight === authPromise) {
          this.ensureBucketsAuthInFlight = null;
        }
      });

    this.ensureBucketsAuthInFlight = authPromise;
    await authPromise;
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
      this.oauthManager.setSessionBucket(
        this.provider,
        this.buckets[0],
        this.metadata,
      );
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
  /**
   * Invalidate the auth cache for a runtime, forcing fresh keychain reads.
   * Called at turn boundaries and after auth errors.
   */
  invalidateAuthCache(runtimeId: string): void {
    flushRuntimeAuthScope(runtimeId);
    logger.debug('Auth cache invalidated for runtime', { runtimeId });
  }
}
