/**
 * Pure-function rate limit handling for Anthropic provider
 * Extracted from AnthropicProvider.ts as part of issue #1572 decomposition
 */

/**
 * Rate limit information from Anthropic API response headers
 */
export interface AnthropicRateLimitInfo {
  requestsLimit?: number;
  requestsRemaining?: number;
  requestsReset?: Date;
  tokensLimit?: number;
  tokensRemaining?: number;
  tokensReset?: Date;
  inputTokensLimit?: number;
  inputTokensRemaining?: number;
}

/**
 * Decision whether to wait for rate limit reset
 */
export interface WaitDecision {
  shouldWait: boolean;
  waitMs: number;
  reason: string;
}

/**
 * Extract rate limit information from response headers
 */
export function extractRateLimitHeaders(
  headers: Headers,
  logger: { debug: (fn: () => string) => void },
): AnthropicRateLimitInfo {
  const info: AnthropicRateLimitInfo = {};

  // Extract requests rate limit info
  const requestsLimit = headers.get('anthropic-ratelimit-requests-limit');
  const requestsRemaining = headers.get(
    'anthropic-ratelimit-requests-remaining',
  );
  const requestsReset = headers.get('anthropic-ratelimit-requests-reset');

  if (requestsLimit) {
    info.requestsLimit = parseInt(requestsLimit, 10);
  }
  if (requestsRemaining) {
    info.requestsRemaining = parseInt(requestsRemaining, 10);
  }
  if (requestsReset) {
    const date = new Date(requestsReset);
    if (!Number.isNaN(date.getTime())) {
      info.requestsReset = date;
    } else {
      logger.debug(
        () => `Failed to parse requests reset date: ${requestsReset}`,
      );
    }
  }

  // Extract tokens rate limit info
  const tokensLimit = headers.get('anthropic-ratelimit-tokens-limit');
  const tokensRemaining = headers.get('anthropic-ratelimit-tokens-remaining');
  const tokensReset = headers.get('anthropic-ratelimit-tokens-reset');

  if (tokensLimit) {
    info.tokensLimit = parseInt(tokensLimit, 10);
  }
  if (tokensRemaining) {
    info.tokensRemaining = parseInt(tokensRemaining, 10);
  }
  if (tokensReset) {
    const date = new Date(tokensReset);
    if (!Number.isNaN(date.getTime())) {
      info.tokensReset = date;
    } else {
      logger.debug(() => `Failed to parse tokens reset date: ${tokensReset}`);
    }
  }

  // Extract input tokens rate limit info
  const inputTokensLimit = headers.get(
    'anthropic-ratelimit-input-tokens-limit',
  );
  const inputTokensRemaining = headers.get(
    'anthropic-ratelimit-input-tokens-remaining',
  );

  if (inputTokensLimit) {
    info.inputTokensLimit = parseInt(inputTokensLimit, 10);
  }
  if (inputTokensRemaining) {
    info.inputTokensRemaining = parseInt(inputTokensRemaining, 10);
  }

  return info;
}

/**
 * Check rate limits and log warnings if approaching limits
 */
export function checkRateLimits(
  info: AnthropicRateLimitInfo,
  logger: { debug: (fn: () => string) => void },
): void {
  // Check requests rate limit (warn at 10% remaining)
  if (
    info.requestsLimit !== undefined &&
    info.requestsRemaining !== undefined
  ) {
    const percentage = (info.requestsRemaining / info.requestsLimit) * 100;
    if (percentage < 10) {
      const resetTime = info.requestsReset
        ? ` (resets at ${info.requestsReset.toISOString()})`
        : '';
      logger.debug(
        () =>
          `WARNING: Approaching requests rate limit - ${info.requestsRemaining}/${info.requestsLimit} remaining (${percentage.toFixed(1)}%)${resetTime}`,
      );
    }
  }

  // Check tokens rate limit (warn at 10% remaining)
  if (info.tokensLimit !== undefined && info.tokensRemaining !== undefined) {
    const percentage = (info.tokensRemaining / info.tokensLimit) * 100;
    if (percentage < 10) {
      const resetTime = info.tokensReset
        ? ` (resets at ${info.tokensReset.toISOString()})`
        : '';
      logger.debug(
        () =>
          `WARNING: Approaching tokens rate limit - ${info.tokensRemaining}/${info.tokensLimit} remaining (${percentage.toFixed(1)}%)${resetTime}`,
      );
    }
  }

  // Check input tokens rate limit (warn at 10% remaining)
  if (
    info.inputTokensLimit !== undefined &&
    info.inputTokensRemaining !== undefined
  ) {
    const percentage =
      (info.inputTokensRemaining / info.inputTokensLimit) * 100;
    if (percentage < 10) {
      logger.debug(
        () =>
          `WARNING: Approaching input tokens rate limit - ${info.inputTokensRemaining}/${info.inputTokensLimit} remaining (${percentage.toFixed(1)}%)`,
      );
    }
  }
}

function checkBucketThreshold(
  remaining: number | undefined,
  limit: number | undefined,
  resetDate: Date | undefined,
  bucketName: string,
  options: {
    thresholdPercentage: number;
    maxWaitMs: number;
    now: number;
  },
): WaitDecision | undefined {
  if (remaining === undefined || limit === undefined) {
    return undefined;
  }

  const percentage = (remaining / limit) * 100;

  if (percentage >= options.thresholdPercentage) {
    return undefined;
  }

  if (!resetDate) {
    return {
      shouldWait: false,
      waitMs: 0,
      reason: `Rate limit warning: ${bucketName} at ${percentage.toFixed(1)}% (${remaining}/${limit}), no reset time available`,
    };
  }

  const resetTime = resetDate.getTime();
  const waitMs = resetTime - options.now;

  if (waitMs <= 0) {
    return undefined;
  }

  const actualWaitMs = Math.min(waitMs, options.maxWaitMs);
  const cappedMsg =
    waitMs > options.maxWaitMs ? ` (capped from ${waitMs}ms)` : '';
  return {
    shouldWait: true,
    waitMs: actualWaitMs,
    reason: `Rate limit throttle: ${bucketName} at ${percentage.toFixed(1)}% (${remaining}/${limit}), waiting ${actualWaitMs}ms until reset${cappedMsg}`,
  };
}

/**
 * Calculate wait time based on rate limit state
 * This is the pure decision logic extracted from waitForRateLimitIfNeeded
 */
export function calculateWaitTime(
  info: AnthropicRateLimitInfo,
  options: {
    throttleEnabled: string;
    thresholdPercentage: number;
    maxWaitMs: number;
    now?: number;
  },
): WaitDecision {
  if (options.throttleEnabled === 'off') {
    return { shouldWait: false, waitMs: 0, reason: 'Throttling disabled' };
  }

  const now = options.now ?? Date.now();
  const bucketOptions = {
    thresholdPercentage: options.thresholdPercentage,
    maxWaitMs: options.maxWaitMs,
    now,
  };

  const decisions = [
    checkBucketThreshold(
      info.requestsRemaining,
      info.requestsLimit,
      info.requestsReset,
      'requests',
      bucketOptions,
    ),
    checkBucketThreshold(
      info.tokensRemaining,
      info.tokensLimit,
      info.tokensReset,
      'tokens',
      bucketOptions,
    ),
    checkBucketThreshold(
      info.inputTokensRemaining,
      info.inputTokensLimit,
      undefined,
      'input tokens',
      bucketOptions,
    ),
  ];

  // Prefer any bucket that requires waiting over warning-only decisions
  const waitDecision = decisions.find((d) => d?.shouldWait);
  if (waitDecision) {
    return waitDecision;
  }

  // Fall back to first warning-only decision if no bucket requires waiting
  const warningDecision = decisions.find((d) => d !== undefined);
  if (warningDecision) {
    return warningDecision;
  }

  return { shouldWait: false, waitMs: 0, reason: 'No throttling needed' };
}

/**
 * Get retry configuration from ephemeral settings
 */
export function getRetryConfig(ephemeralSettings: Record<string, unknown>): {
  maxAttempts: number;
  initialDelayMs: number;
} {
  const maxAttempts = (ephemeralSettings['retries'] as number | undefined) ?? 6;
  const initialDelayMs =
    (ephemeralSettings['retrywait'] as number | undefined) ?? 4000;
  return { maxAttempts, initialDelayMs };
}

/**
 * Format rate limit information as a summary string for logging
 */
export function formatRateLimitSummary(info: AnthropicRateLimitInfo): string {
  const parts: string[] = [];
  if (
    info.requestsRemaining !== undefined &&
    info.requestsLimit !== undefined
  ) {
    parts.push(`requests=${info.requestsRemaining}/${info.requestsLimit}`);
  }
  if (info.tokensRemaining !== undefined && info.tokensLimit !== undefined) {
    parts.push(`tokens=${info.tokensRemaining}/${info.tokensLimit}`);
  }
  if (
    info.inputTokensRemaining !== undefined &&
    info.inputTokensLimit !== undefined
  ) {
    parts.push(
      `input_tokens=${info.inputTokensRemaining}/${info.inputTokensLimit}`,
    );
  }
  return parts.length > 0
    ? `Rate limits: ${parts.join(', ')}`
    : 'Rate limits: no data';
}
