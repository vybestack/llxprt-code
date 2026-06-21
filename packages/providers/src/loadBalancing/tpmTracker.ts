/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20251212issue489 - Phase 4
 * TPM (tokens-per-minute) tracking for load-balancer backends using a
 * 5-minute rolling window. Extracted from LoadBalancingProvider.
 */

import type { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

/** Number of minutes in the rolling TPM window. */
export const TPM_ROLLING_WINDOW_MINUTES = 5;

export class TPMTracker {
  constructor(
    private readonly buckets: Map<number, Map<string, number>>,
    private readonly logger: DebugLogger,
  ) {}

  updateTPM(profileName: string, tokensUsed: number): void {
    const now = Date.now();
    const minute = Math.floor(now / 60000);

    let bucket = this.buckets.get(minute);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(minute, bucket);
    }

    const current = bucket.get(profileName) ?? 0;
    bucket.set(profileName, current + tokensUsed);

    this.pruneOldBuckets(minute);
  }

  calculateTPM(profileName: string): number {
    const now = Date.now();
    const currentMinute = Math.floor(now / 60000);

    // Collect (minute, tokens) pairs for the rolling window.
    const entries: Array<{ minute: number; tokens: number }> = [];
    for (let i = 0; i < TPM_ROLLING_WINDOW_MINUTES; i++) {
      const minute = currentMinute - i;
      const bucket = this.buckets.get(minute);
      const tokens = bucket?.get(profileName) ?? 0;
      if (tokens > 0) {
        entries.push({ minute, tokens });
      }
    }

    if (entries.length === 0) {
      return 0;
    }

    const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
    const oldestBucket = entries.reduce(
      (min, e) => (e.minute < min ? e.minute : min),
      entries[0].minute,
    );

    // Calculate TPM from oldest bucket to current minute (elapsed time).
    // This ensures TPM decreases as time passes with no new tokens.
    const elapsedMinutes = currentMinute - oldestBucket + 1;
    return totalTokens / elapsedMinutes;
  }

  shouldSkipOnTPM(
    profileName: string,
    tpmThreshold: number | undefined,
  ): boolean {
    // Use explicit undefined check to avoid different-types-comparison
    if (tpmThreshold === undefined || tpmThreshold <= 0) {
      return false;
    }

    const currentTPM = this.calculateTPM(profileName);
    // Only skip if we have some history and TPM is below threshold
    if (currentTPM > 0 && currentTPM < tpmThreshold) {
      this.logger.debug(
        () =>
          `[LB:tpm] ${profileName}: TPM (${currentTPM.toFixed(0)}) below threshold (${tpmThreshold})`,
      );
      return true;
    }

    return false;
  }

  private pruneOldBuckets(currentMinute: number): void {
    const cutoff = currentMinute - TPM_ROLLING_WINDOW_MINUTES;
    for (const [bucketMinute] of this.buckets) {
      if (bucketMinute < cutoff) {
        this.buckets.delete(bucketMinute);
      }
    }
  }
}
