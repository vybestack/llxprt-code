/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 * @plan PLAN-20250909-TOKTRACK.P08
 */

/**
 * Session token usage and cache statistics tracking.
 * Extracted from ProviderManager to keep the main file under the lint
 * line budget.
 */

import { DebugLogger } from '@vybestack/llxprt-code-core/debug/DebugLogger.js';

export interface SessionTokenUsage {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  total: number;
}

export interface CacheStatistics {
  totalCacheReads: number;
  /** null means provider doesn't report cache writes; 0 means explicitly reported as zero */
  totalCacheWrites: number | null;
  requestsWithCacheHits: number;
  requestsWithCacheWrites: number;
  hitRate: number;
}

export interface SessionUsageInput {
  input: number;
  output: number;
  cache: number;
  tool: number;
  thought: number;
  cacheReads?: number;
  cacheWrites?: number | null;
}

const logger = new DebugLogger('llxprt:provider:manager');

/** Helper to sanitize token values: undefined/NaN/-0 → 0, finite numbers preserved. */
function sanitizeTokenValue(value: number | null | undefined): number {
  if (value == null) return 0;
  if (Object.is(value, -0)) return 0;
  if (Number.isNaN(value)) return 0;
  return value;
}

export class TokenUsageTracker {
  private sessionTokenUsage: SessionTokenUsage = {
    input: 0,
    output: 0,
    cache: 0,
    tool: 0,
    thought: 0,
    total: 0,
  };
  private cacheStats: CacheStatistics = {
    totalCacheReads: 0,
    totalCacheWrites: null,
    requestsWithCacheHits: 0,
    requestsWithCacheWrites: 0,
    hitRate: 0,
  };

  /**
   * Accumulate token usage for the current session
   */
  accumulateSessionTokens(
    _providerName: string,
    usage: SessionUsageInput,
  ): void {
    logger.debug(
      () =>
        `[ProviderManager.accumulateSessionTokens] Called with: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}, cacheReads===undefined: ${usage.cacheReads === undefined}, cacheWrites===undefined: ${usage.cacheWrites === undefined}`,
    );

    const inputTokens = Math.max(0, sanitizeTokenValue(usage.input));
    const outputTokens = Math.max(0, sanitizeTokenValue(usage.output));
    const toolTokens = Math.max(0, sanitizeTokenValue(usage.tool));
    const thoughtTokens = Math.max(0, sanitizeTokenValue(usage.thought));

    this.sessionTokenUsage.input += inputTokens;
    this.sessionTokenUsage.output += outputTokens;

    // For cache field: use the explicit cache value OR cacheReads if cache is 0
    // This handles both Gemini (which uses cached_content_token_count) and
    // Anthropic (which uses cache_read_input_tokens)
    const cacheValue = Math.max(0, sanitizeTokenValue(usage.cache));
    const cacheReadValue = Math.max(0, sanitizeTokenValue(usage.cacheReads));
    const cacheTokens = cacheValue > 0 ? cacheValue : cacheReadValue;
    this.sessionTokenUsage.cache += cacheTokens;

    this.sessionTokenUsage.tool += toolTokens;
    this.sessionTokenUsage.thought += thoughtTokens;
    this.sessionTokenUsage.total +=
      inputTokens + outputTokens + toolTokens + thoughtTokens;

    // Track cache reads/writes if provided
    // Note: cacheWrites can be null (provider doesn't report) vs undefined (not in usage object)
    if (usage.cacheReads !== undefined || usage.cacheWrites !== undefined) {
      logger.debug(
        () =>
          `[ProviderManager.accumulateSessionTokens] Received cache usage: cacheReads=${usage.cacheReads}, cacheWrites=${usage.cacheWrites}`,
      );
      this.trackCacheUsage(
        Math.max(0, sanitizeTokenValue(usage.cacheReads)),
        usage.cacheWrites === null || usage.cacheWrites === undefined
          ? null
          : Math.max(0, sanitizeTokenValue(usage.cacheWrites)),
      );
    } else {
      logger.debug(
        () =>
          `[ProviderManager.accumulateSessionTokens] No cache usage in this request`,
      );
    }
  }

  /**
   * Reset session token usage counters
   */
  resetSessionTokenUsage(): void {
    this.sessionTokenUsage = {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    };
  }

  /**
   * Get current session token usage
   */
  getSessionTokenUsage(): SessionTokenUsage {
    return {
      input: sanitizeTokenValue(this.sessionTokenUsage.input),
      output: sanitizeTokenValue(this.sessionTokenUsage.output),
      cache: sanitizeTokenValue(this.sessionTokenUsage.cache),
      tool: sanitizeTokenValue(this.sessionTokenUsage.tool),
      thought: sanitizeTokenValue(this.sessionTokenUsage.thought),
      total: sanitizeTokenValue(this.sessionTokenUsage.total),
    };
  }

  get sessionInputTokens(): number {
    return this.sessionTokenUsage.input;
  }

  /**
   * Track cache read/write statistics from a request
   * @param cacheReads - Number of tokens read from cache
   * @param cacheWrites - Number of tokens written to cache, or null if provider doesn't report this
   */
  trackCacheUsage(cacheReads: number, cacheWrites: number | null): void {
    logger.debug(
      () =>
        `[ProviderManager.trackCacheUsage] Called with cacheReads=${cacheReads}, cacheWrites=${cacheWrites}`,
    );
    if (cacheReads > 0) {
      this.cacheStats.totalCacheReads += cacheReads;
      this.cacheStats.requestsWithCacheHits++;
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated totalCacheReads to ${this.cacheStats.totalCacheReads}`,
      );
    }
    // Only track cache writes if the provider reports them (not null)
    if (cacheWrites !== null) {
      // Initialize from null to 0 on first reported value
      this.cacheStats.totalCacheWrites ??= 0;
      this.cacheStats.totalCacheWrites += cacheWrites;
      if (cacheWrites > 0) {
        this.cacheStats.requestsWithCacheWrites++;
      }
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated totalCacheWrites to ${this.cacheStats.totalCacheWrites}`,
      );
    }

    // Recalculate hit rate
    // Hit rate = cache reads / total input tokens * 100
    // sessionTokenUsage.input includes cached tokens, so it is the total input
    const totalInputTokens = this.sessionTokenUsage.input;
    if (totalInputTokens > 0) {
      this.cacheStats.hitRate =
        (this.cacheStats.totalCacheReads / totalInputTokens) * 100;
      logger.debug(
        () =>
          `[ProviderManager.trackCacheUsage] Updated hitRate to ${this.cacheStats.hitRate}% (cacheReads=${this.cacheStats.totalCacheReads}, totalInput=${totalInputTokens})`,
      );
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStatistics(): CacheStatistics {
    return { ...this.cacheStats };
  }
}
