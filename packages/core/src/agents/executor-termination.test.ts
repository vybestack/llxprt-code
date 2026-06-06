/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { checkAgentTermination } from './executor-termination.js';
import { AgentTerminateMode } from './types.js';
import {
  resolveGracePeriodSeconds,
  DEFAULT_GRACE_PERIOD_SECONDS,
} from './recovery.js';

describe('checkAgentTermination', () => {
  const baseConfig = { max_time_minutes: 5 };

  it('should return null when no limits are exceeded', () => {
    const startTime = Date.now() - 1000;
    const result = checkAgentTermination(baseConfig, startTime, 0);
    expect(result).toBeNull();
  });

  it('should return MAX_TURNS when turn limit is reached', () => {
    const config = { ...baseConfig, max_turns: 3 };
    const startTime = Date.now();
    const result = checkAgentTermination(config, startTime, 3);
    expect(result).toBe(AgentTerminateMode.MAX_TURNS);
  });

  it('should not terminate on max_turns of 0', () => {
    const config = { ...baseConfig, max_turns: 0 };
    const startTime = Date.now();
    const result = checkAgentTermination(config, startTime, 5);
    expect(result).toBeNull();
  });

  it('should return TIMEOUT when time limit is exceeded', () => {
    const startTime = Date.now() - 6 * 60 * 1000;
    const result = checkAgentTermination(baseConfig, startTime, 0);
    expect(result).toBe(AgentTerminateMode.TIMEOUT);
  });

  describe('recovery deadline', () => {
    it('should use recovery deadline instead of max_time_minutes when provided', () => {
      const config = { max_time_minutes: 5 };
      const startTime = Date.now() - 6 * 60 * 1000;
      const futureDeadline = Date.now() + 30 * 1000;
      const result = checkAgentTermination(
        config,
        startTime,
        0,
        futureDeadline,
      );
      expect(result).toBeNull();
    });

    it('should return TIMEOUT when recovery deadline has passed', () => {
      const config = { max_time_minutes: 5 };
      const startTime = Date.now() - 1000;
      const pastDeadline = Date.now() - 1;
      const result = checkAgentTermination(config, startTime, 0, pastDeadline);
      expect(result).toBe(AgentTerminateMode.TIMEOUT);
    });

    it('should return TIMEOUT when recovery deadline equals current time', () => {
      const config = { max_time_minutes: 60 };
      const startTime = Date.now() - 1000;
      const now = Date.now();
      const result = checkAgentTermination(config, startTime, 0, now);
      expect(result).toBe(AgentTerminateMode.TIMEOUT);
    });

    it('should NOT check max_turns when in recovery (recovery deadline bypasses turn limit)', () => {
      const config = { ...baseConfig, max_turns: 2 };
      const startTime = Date.now();
      const futureDeadline = Date.now() + 60 * 1000;
      // Turn 5 exceeds max_turns, but we're in recovery so it's bypassed
      const result = checkAgentTermination(
        config,
        startTime,
        5,
        futureDeadline,
      );
      expect(result).toBeNull();
    });

    it('should not use recovery deadline when undefined', () => {
      const config = { max_time_minutes: 1 };
      const startTime = Date.now() - 61 * 1000;
      const result = checkAgentTermination(config, startTime, 0, undefined);
      expect(result).toBe(AgentTerminateMode.TIMEOUT);
    });
  });
});

describe('resolveGracePeriodSeconds', () => {
  it('should return configured value when it is a valid positive number', () => {
    expect(resolveGracePeriodSeconds(30)).toBe(30);
    expect(resolveGracePeriodSeconds(120)).toBe(120);
    expect(resolveGracePeriodSeconds(0.5)).toBe(0.5);
  });

  it('should return default when configured value is undefined', () => {
    expect(resolveGracePeriodSeconds(undefined)).toBe(
      DEFAULT_GRACE_PERIOD_SECONDS,
    );
  });

  it('should return default when configured value is 0', () => {
    expect(resolveGracePeriodSeconds(0)).toBe(DEFAULT_GRACE_PERIOD_SECONDS);
  });

  it('should return default when configured value is negative', () => {
    expect(resolveGracePeriodSeconds(-10)).toBe(DEFAULT_GRACE_PERIOD_SECONDS);
    expect(resolveGracePeriodSeconds(-1)).toBe(DEFAULT_GRACE_PERIOD_SECONDS);
  });

  it('should return default when configured value is NaN', () => {
    expect(resolveGracePeriodSeconds(Number.NaN)).toBe(
      DEFAULT_GRACE_PERIOD_SECONDS,
    );
  });

  it('should return default when configured value is Infinity', () => {
    expect(resolveGracePeriodSeconds(Number.POSITIVE_INFINITY)).toBe(
      DEFAULT_GRACE_PERIOD_SECONDS,
    );
    expect(resolveGracePeriodSeconds(Number.NEGATIVE_INFINITY)).toBe(
      DEFAULT_GRACE_PERIOD_SECONDS,
    );
  });
});
