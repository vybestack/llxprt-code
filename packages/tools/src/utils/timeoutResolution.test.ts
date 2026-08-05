/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  resolveTimeout,
  resolveTimeoutSeconds,
  describeTimeoutClamp,
  describeTimeoutTermination,
  requireEffectiveTimeoutSeconds,
  validateTimeoutSeconds,
} from './timeoutResolution.js';

describe('resolveTimeout ceiling semantics (issue #3031)', () => {
  it.each([
    {
      label: 'requested below max is honoured exactly',
      requested: 300,
      default: 900,
      max: 1800,
      expected: 300,
      clamped: false,
    },
    {
      label: 'requested equal to max is not clamped',
      requested: 1800,
      default: 900,
      max: 1800,
      expected: 1800,
      clamped: false,
    },
    {
      label: 'requested above max is clamped to max',
      requested: 3600,
      default: 900,
      max: 1800,
      expected: 1800,
      clamped: true,
    },
    {
      label: 'requested -1 under finite max resolves to max (clamped)',
      requested: -1,
      default: 900,
      max: 1800,
      expected: 1800,
      clamped: true,
    },
    {
      label: 'omitted request uses default under max',
      requested: undefined,
      default: 900,
      max: 1800,
      expected: 900,
      clamped: false,
    },
    {
      label: 'default above max is clamped to max',
      requested: undefined,
      default: 3600,
      max: 1800,
      expected: 1800,
      clamped: true,
    },
    {
      label: 'default -1 under finite max resolves to max (clamped)',
      requested: undefined,
      default: -1,
      max: 1800,
      expected: 1800,
      clamped: true,
    },
    {
      label: 'requested -1 under no ceiling (max -1) is unbounded',
      requested: -1,
      default: 900,
      max: -1,
      expected: undefined,
      clamped: false,
    },
    {
      label: 'default -1 under no ceiling (max -1) is unbounded',
      requested: undefined,
      default: -1,
      max: -1,
      expected: undefined,
      clamped: false,
    },
    {
      label: 'finite request under no ceiling (max -1) passes through',
      requested: 3600,
      default: 900,
      max: -1,
      expected: 3600,
      clamped: false,
    },
  ])(
    '$label',
    ({
      requested,
      default: defaultSeconds,
      max,
      expected,
      clamped,
    }: {
      label: string;
      requested: number | undefined;
      default: number;
      max: number;
      expected: number | undefined;
      clamped: boolean;
    }) => {
      const resolution = resolveTimeout(requested, defaultSeconds, max);

      expect(resolution.effectiveTimeoutSeconds).toBe(expected);
      expect(resolution.clamped).toBe(clamped);
      expect(resolution.requestedTimeoutSeconds).toBe(requested);
      expect(resolution.defaultTimeoutSeconds).toBe(defaultSeconds);
      expect(resolution.maxTimeoutSeconds).toBe(max);
    },
  );

  it('resolveTimeoutSeconds returns only the effective seconds', () => {
    expect(resolveTimeoutSeconds(-1, 900, 1800)).toBe(1800);
    expect(resolveTimeoutSeconds(300, 900, 1800)).toBe(300);
    expect(resolveTimeoutSeconds(-1, 900, -1)).toBeUndefined();
  });
});

describe('describeTimeoutClamp (issue #3031)', () => {
  it('returns undefined when not clamped', () => {
    const resolution = resolveTimeout(300, 900, 1800);
    expect(
      describeTimeoutClamp(resolution, {
        defaultSetting: 'task-default-timeout-seconds',
        maxSetting: 'task-max-timeout-seconds',
      }),
    ).toBeUndefined();
  });

  it('names the requested value, the applied value, and the max setting when a finite request is clamped', () => {
    const resolution = resolveTimeout(3600, 900, 1800);
    const message = describeTimeoutClamp(resolution, {
      defaultSetting: 'task-default-timeout-seconds',
      maxSetting: 'task-max-timeout-seconds',
    });

    expect(typeof message).toBe('string');
    expect(message).toContain('3600');
    expect(message).toContain('1800');
    expect(message).toContain('task-max-timeout-seconds');
  });

  it('names the unlimited request (-1), the applied value, and the max setting when -1 is clamped', () => {
    const resolution = resolveTimeout(-1, 900, 1800);
    const message = describeTimeoutClamp(resolution, {
      defaultSetting: 'shell-default-timeout-seconds',
      maxSetting: 'shell-max-timeout-seconds',
    });

    expect(message).toContain('1800');
    expect(message).toContain('-1');
    expect(message).toContain('shell-max-timeout-seconds');
  });
});

describe('describeTimeoutTermination (issue #3031)', () => {
  it('names the effective timeout value and both setting names', () => {
    const message = describeTimeoutTermination(120, {
      defaultSetting: 'task-default-timeout-seconds',
      maxSetting: 'task-max-timeout-seconds',
    });

    expect(message).toContain('120');
    expect(message).toContain('task-max-timeout-seconds');
    expect(message).toContain('task-default-timeout-seconds');
    expect(message).toContain('timeout_seconds');
  });
});

describe('requireEffectiveTimeoutSeconds (issue #3031)', () => {
  it('returns the effective seconds when the resolution is bounded', () => {
    const resolution = resolveTimeout(300, 900, 1800);
    expect(requireEffectiveTimeoutSeconds(resolution)).toBe(300);
  });

  it('throws when the resolution is unbounded (no ceiling, unbounded ask)', () => {
    const resolution = resolveTimeout(-1, 900, -1);
    // Sanity: this resolution is genuinely unbounded.
    expect(resolution.effectiveTimeoutSeconds).toBeUndefined();

    expect(() => requireEffectiveTimeoutSeconds(resolution)).toThrow(
      /finite effective timeout/,
    );
  });
});

describe('validateTimeoutSeconds (issue #3031)', () => {
  it('accepts -1', () => {
    expect(validateTimeoutSeconds(-1)).toBeNull();
  });

  it('accepts a finite value greater than zero', () => {
    expect(validateTimeoutSeconds(300)).toBeNull();
    expect(validateTimeoutSeconds(0.5)).toBeNull();
  });

  it('accepts undefined (omitted)', () => {
    expect(validateTimeoutSeconds(undefined)).toBeNull();
  });

  it('rejects 0 with a message naming what is allowed', () => {
    const error = validateTimeoutSeconds(0);
    expect(error).not.toBeNull();
    expect(error).toContain('0');
    expect(error).toContain('-1');
    expect(error!.toLowerCase()).toContain('greater than zero');
  });

  it('rejects -2 with a message naming what is allowed', () => {
    const error = validateTimeoutSeconds(-2);
    expect(error).not.toBeNull();
    expect(error).toContain('-2');
    expect(error).toContain('-1');
  });

  it('rejects NaN', () => {
    expect(validateTimeoutSeconds(Number.NaN)).not.toBeNull();
  });

  it('rejects Infinity', () => {
    expect(validateTimeoutSeconds(Number.POSITIVE_INFINITY)).not.toBeNull();
  });
});
