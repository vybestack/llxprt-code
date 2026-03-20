/**
 * Tests for AnthropicRateLimitHandler pure functions
 */

import { describe, it, expect } from 'vitest';
import {
  type AnthropicRateLimitInfo,
  extractRateLimitHeaders,
  checkRateLimits,
  calculateWaitTime,
  getRetryConfig,
  formatRateLimitSummary,
} from './AnthropicRateLimitHandler.js';

// Mock logger for tests
const mockLogger = {
  debug: () => {
    // no-op
  },
};

// Mock logger that captures debug messages
function createCapturingLogger(): {
  debug: (fn: () => string) => void;
  messages: string[];
} {
  const messages: string[] = [];
  return {
    debug: (fn: () => string) => {
      messages.push(fn());
    },
    messages,
  };
}

describe('extractRateLimitHeaders', () => {
  it('should extract all header types (requests, tokens, input_tokens)', () => {
    const headers = new Headers({
      'anthropic-ratelimit-requests-limit': '1000',
      'anthropic-ratelimit-requests-remaining': '500',
      'anthropic-ratelimit-requests-reset': '2026-03-20T16:00:00Z',
      'anthropic-ratelimit-tokens-limit': '100000',
      'anthropic-ratelimit-tokens-remaining': '50000',
      'anthropic-ratelimit-tokens-reset': '2026-03-20T16:00:00Z',
      'anthropic-ratelimit-input-tokens-limit': '50000',
      'anthropic-ratelimit-input-tokens-remaining': '25000',
    });

    const info = extractRateLimitHeaders(headers, mockLogger);

    expect(info.requestsLimit).toBe(1000);
    expect(info.requestsRemaining).toBe(500);
    expect(info.requestsReset).toBeInstanceOf(Date);
    expect(info.tokensLimit).toBe(100000);
    expect(info.tokensRemaining).toBe(50000);
    expect(info.tokensReset).toBeInstanceOf(Date);
    expect(info.inputTokensLimit).toBe(50000);
    expect(info.inputTokensRemaining).toBe(25000);
  });

  it('should handle missing headers gracefully', () => {
    const headers = new Headers({
      'anthropic-ratelimit-requests-limit': '1000',
    });

    const info = extractRateLimitHeaders(headers, mockLogger);

    expect(info.requestsLimit).toBe(1000);
    expect(info.requestsRemaining).toBeUndefined();
    expect(info.requestsReset).toBeUndefined();
    expect(info.tokensLimit).toBeUndefined();
    expect(info.tokensRemaining).toBeUndefined();
    expect(info.tokensReset).toBeUndefined();
  });

  it('should handle invalid date strings gracefully', () => {
    const logger = createCapturingLogger();
    const headers = new Headers({
      'anthropic-ratelimit-requests-limit': '1000',
      'anthropic-ratelimit-requests-remaining': '500',
      'anthropic-ratelimit-requests-reset': 'invalid-date',
    });

    const info = extractRateLimitHeaders(headers, logger);

    expect(info.requestsLimit).toBe(1000);
    expect(info.requestsRemaining).toBe(500);
    // Invalid date strings result in NaN time, which is gracefully skipped
    expect(info.requestsReset).toBeUndefined();
    // Note: Date constructor doesn't throw for invalid strings, it creates a Date with NaN time
    // So the debug log is not called in this case
  });

  it('should parse dates correctly', () => {
    const headers = new Headers({
      'anthropic-ratelimit-requests-reset': '2026-03-20T16:00:00Z',
    });

    const info = extractRateLimitHeaders(headers, mockLogger);

    expect(info.requestsReset).toBeInstanceOf(Date);
    expect(info.requestsReset?.toISOString()).toBe('2026-03-20T16:00:00.000Z');
  });
});

describe('checkRateLimits', () => {
  it('should log warning when requests below 10% threshold', () => {
    const logger = createCapturingLogger();
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 50, // 5%
      requestsReset: new Date('2026-03-20T16:00:00Z'),
    };

    checkRateLimits(info, logger);

    expect(logger.messages.length).toBe(1);
    expect(logger.messages[0]).toContain('WARNING');
    expect(logger.messages[0]).toContain('requests rate limit');
    expect(logger.messages[0]).toContain('50/1000');
  });

  it('should log warning when tokens below 10% threshold', () => {
    const logger = createCapturingLogger();
    const info: AnthropicRateLimitInfo = {
      tokensLimit: 100000,
      tokensRemaining: 5000, // 5%
      tokensReset: new Date('2026-03-20T16:00:00Z'),
    };

    checkRateLimits(info, logger);

    expect(logger.messages.length).toBe(1);
    expect(logger.messages[0]).toContain('WARNING');
    expect(logger.messages[0]).toContain('tokens rate limit');
    expect(logger.messages[0]).toContain('5000/100000');
  });

  it('should not log when above threshold', () => {
    const logger = createCapturingLogger();
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 500, // 50%
      tokensLimit: 100000,
      tokensRemaining: 50000, // 50%
    };

    checkRateLimits(info, logger);

    expect(logger.messages.length).toBe(0);
  });

  it('should handle undefined limits gracefully', () => {
    const logger = createCapturingLogger();
    const info: AnthropicRateLimitInfo = {};

    checkRateLimits(info, logger);

    expect(logger.messages.length).toBe(0);
  });

  it('should log warning for input tokens below threshold', () => {
    const logger = createCapturingLogger();
    const info: AnthropicRateLimitInfo = {
      inputTokensLimit: 50000,
      inputTokensRemaining: 2500, // 5%
    };

    checkRateLimits(info, logger);

    expect(logger.messages.length).toBe(1);
    expect(logger.messages[0]).toContain('WARNING');
    expect(logger.messages[0]).toContain('input tokens rate limit');
    expect(logger.messages[0]).toContain('2500/50000');
  });
});

describe('calculateWaitTime', () => {
  it('should return shouldWait=false when no rate limit data', () => {
    const decision = calculateWaitTime({} as AnthropicRateLimitInfo, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now: Date.now(),
    });

    expect(decision.shouldWait).toBe(false);
    expect(decision.waitMs).toBe(0);
  });

  it('should return shouldWait=false when throttle is disabled', () => {
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 10, // 1%
      requestsReset: new Date(Date.now() + 10000),
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'off',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now: Date.now(),
    });

    expect(decision.shouldWait).toBe(false);
  });

  it('should return shouldWait=true when requests below threshold with future reset', () => {
    const now = Date.now();
    const resetTime = now + 10000; // 10 seconds in future
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 30, // 3%
      requestsReset: new Date(resetTime),
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now,
    });

    expect(decision.shouldWait).toBe(true);
    expect(decision.waitMs).toBe(10000);
    expect(decision.reason).toContain('requests at 3.0%');
  });

  it('should cap waitMs at maxWaitMs', () => {
    const now = Date.now();
    const resetTime = now + 120000; // 2 minutes in future
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 30, // 3%
      requestsReset: new Date(resetTime),
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now,
    });

    expect(decision.shouldWait).toBe(true);
    expect(decision.waitMs).toBe(60000); // capped at maxWaitMs
    expect(decision.reason).toContain('capped from 120000ms');
  });

  it('should return shouldWait=false when reset time is in the past', () => {
    const now = Date.now();
    const resetTime = now - 10000; // 10 seconds in past
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 30, // 3%
      requestsReset: new Date(resetTime),
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now,
    });

    expect(decision.shouldWait).toBe(false);
  });

  it('should check tokens when requests are fine', () => {
    const now = Date.now();
    const resetTime = now + 10000;
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 500, // 50% - above threshold
      tokensLimit: 100000,
      tokensRemaining: 3000, // 3% - below threshold
      tokensReset: new Date(resetTime),
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now,
    });

    expect(decision.shouldWait).toBe(true);
    expect(decision.waitMs).toBe(10000);
    expect(decision.reason).toContain('tokens at 3.0%');
  });

  it('should log warning for input tokens without waiting', () => {
    const info: AnthropicRateLimitInfo = {
      inputTokensLimit: 50000,
      inputTokensRemaining: 2000, // 4% - below threshold
    };

    const decision = calculateWaitTime(info, {
      throttleEnabled: 'on',
      thresholdPercentage: 5,
      maxWaitMs: 60000,
      now: Date.now(),
    });

    expect(decision.shouldWait).toBe(false);
    expect(decision.reason).toContain('input tokens at 4.0%');
    expect(decision.reason).toContain('no reset time available');
  });
});

describe('getRetryConfig', () => {
  it('should return defaults when no settings', () => {
    const config = getRetryConfig({});

    expect(config.maxAttempts).toBe(6);
    expect(config.initialDelayMs).toBe(4000);
  });

  it('should use provided settings values', () => {
    const config = getRetryConfig({
      retries: 10,
      retrywait: 2000,
    });

    expect(config.maxAttempts).toBe(10);
    expect(config.initialDelayMs).toBe(2000);
  });

  it('should handle missing keys with defaults', () => {
    const config = getRetryConfig({
      retries: 8,
      // retrywait missing
    });

    expect(config.maxAttempts).toBe(8);
    expect(config.initialDelayMs).toBe(4000);
  });
});

describe('formatRateLimitSummary', () => {
  it('should format all three rate limit types', () => {
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 500,
      tokensLimit: 100000,
      tokensRemaining: 50000,
      inputTokensLimit: 50000,
      inputTokensRemaining: 25000,
    };

    const summary = formatRateLimitSummary(info);

    expect(summary).toBe(
      'Rate limits: requests=500/1000, tokens=50000/100000, input_tokens=25000/50000',
    );
  });

  it('should handle partial data', () => {
    const info: AnthropicRateLimitInfo = {
      requestsLimit: 1000,
      requestsRemaining: 500,
    };

    const summary = formatRateLimitSummary(info);

    expect(summary).toBe('Rate limits: requests=500/1000');
  });

  it('should return "no data" when empty', () => {
    const info: AnthropicRateLimitInfo = {};

    const summary = formatRateLimitSummary(info);

    expect(summary).toBe('Rate limits: no data');
  });
});
