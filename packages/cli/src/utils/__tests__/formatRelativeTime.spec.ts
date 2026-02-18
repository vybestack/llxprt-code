/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260214-SESSIONBROWSER.P04
 * @requirement REQ-RT-001, REQ-RT-002, REQ-RT-003, REQ-RT-004
 *
 * Comprehensive behavioral tests for formatRelativeTime utility.
 * Tests are deterministic using explicit `now` parameter - no Date mocking.
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatRelativeTime } from '../formatRelativeTime.js';

// Fixed reference time for deterministic tests
const NOW = new Date('2026-02-16T12:00:00.000Z');

// Helper to create dates relative to NOW
const ago = (ms: number) => new Date(NOW.getTime() - ms);
const ahead = (ms: number) => new Date(NOW.getTime() + ms);

// Time constants
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('formatRelativeTime', () => {
  describe('long mode (REQ-RT-001)', () => {
    it('returns "just now" for current time', () => {
      expect(formatRelativeTime(NOW, { mode: 'long', now: NOW })).toBe(
        'just now',
      );
    });

    it('returns "just now" for timestamps ≤30 seconds ago', () => {
      expect(
        formatRelativeTime(ago(15 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('just now');
    });

    it('returns "just now" for exactly 30 seconds ago', () => {
      expect(
        formatRelativeTime(ago(30 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('just now');
    });

    it('returns "1 minute ago" for 31 seconds ago', () => {
      expect(
        formatRelativeTime(ago(31 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('1 minute ago');
    });

    it('returns "1 minute ago" for exactly 90 seconds ago', () => {
      expect(
        formatRelativeTime(ago(90 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('1 minute ago');
    });

    it('returns "2 minutes ago" for 91 seconds ago', () => {
      expect(
        formatRelativeTime(ago(91 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('2 minutes ago');
    });

    it('returns "N minutes ago" for >90 seconds to <45 minutes', () => {
      expect(
        formatRelativeTime(ago(5 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('5 minutes ago');
      expect(
        formatRelativeTime(ago(30 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('30 minutes ago');
      expect(
        formatRelativeTime(ago(44 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('44 minutes ago');
    });

    it('returns "1 hour ago" for exactly 45 minutes ago', () => {
      expect(
        formatRelativeTime(ago(45 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('1 hour ago');
    });

    it('returns "1 hour ago" for 45-89 minutes ago', () => {
      expect(
        formatRelativeTime(ago(60 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('1 hour ago');
      expect(
        formatRelativeTime(ago(89 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('1 hour ago');
    });

    it('returns "N hours ago" for 90 minutes to <22 hours', () => {
      expect(
        formatRelativeTime(ago(90 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('2 hours ago');
      expect(
        formatRelativeTime(ago(5 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('5 hours ago');
      expect(
        formatRelativeTime(ago(21 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('21 hours ago');
    });

    it('returns "yesterday" for exactly 22 hours ago', () => {
      expect(
        formatRelativeTime(ago(22 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('yesterday');
    });

    it('returns "yesterday" for 22-35 hours ago', () => {
      expect(
        formatRelativeTime(ago(24 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('yesterday');
      expect(
        formatRelativeTime(ago(35 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('yesterday');
    });

    it('returns "N days ago" for 36 hours to <7 days', () => {
      expect(
        formatRelativeTime(ago(35.9 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('1 day ago');
      expect(
        formatRelativeTime(ago(36 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('2 days ago');
      expect(formatRelativeTime(ago(3 * DAY), { mode: 'long', now: NOW })).toBe(
        '3 days ago',
      );
      expect(formatRelativeTime(ago(6 * DAY), { mode: 'long', now: NOW })).toBe(
        '6 days ago',
      );
    });

    it('returns "N weeks ago" for 7 to <26 days', () => {
      expect(formatRelativeTime(ago(7 * DAY), { mode: 'long', now: NOW })).toBe(
        '1 week ago',
      );
      expect(
        formatRelativeTime(ago(14 * DAY), { mode: 'long', now: NOW }),
      ).toBe('2 weeks ago');
      expect(
        formatRelativeTime(ago(25 * DAY), { mode: 'long', now: NOW }),
      ).toBe('3 weeks ago');
    });

    it('returns formatted date "MMM D, YYYY" for >45 days', () => {
      // 46 days ago from 2026-02-16 is 2026-01-01
      const date46 = ago(46 * DAY);
      const result = formatRelativeTime(date46, { mode: 'long', now: NOW });
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(result).toBe('Jan 1, 2026');
    });

    it('returns formatted date for dates over a year ago', () => {
      const date365 = ago(365 * DAY);
      const result = formatRelativeTime(date365, { mode: 'long', now: NOW });
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(result).toBe('Feb 16, 2025');
    });
  });

  describe('short mode (REQ-RT-002)', () => {
    it('returns "now" for current time', () => {
      expect(formatRelativeTime(NOW, { mode: 'short', now: NOW })).toBe('now');
    });

    it('returns "now" for timestamps ≤30 seconds ago', () => {
      expect(
        formatRelativeTime(ago(15 * SECOND), { mode: 'short', now: NOW }),
      ).toBe('now');
      expect(
        formatRelativeTime(ago(30 * SECOND), { mode: 'short', now: NOW }),
      ).toBe('now');
    });

    it('returns "Nm ago" for minutes', () => {
      expect(
        formatRelativeTime(ago(31 * SECOND), { mode: 'short', now: NOW }),
      ).toBe('1m ago');
      expect(
        formatRelativeTime(ago(5 * MINUTE), { mode: 'short', now: NOW }),
      ).toBe('5m ago');
      expect(
        formatRelativeTime(ago(44 * MINUTE), { mode: 'short', now: NOW }),
      ).toBe('44m ago');
    });

    it('returns "Nh ago" for hours', () => {
      expect(
        formatRelativeTime(ago(45 * MINUTE), { mode: 'short', now: NOW }),
      ).toBe('1h ago');
      expect(
        formatRelativeTime(ago(2 * HOUR), { mode: 'short', now: NOW }),
      ).toBe('2h ago');
      expect(
        formatRelativeTime(ago(21 * HOUR), { mode: 'short', now: NOW }),
      ).toBe('21h ago');
    });

    it('returns "Nd ago" for days', () => {
      expect(
        formatRelativeTime(ago(22 * HOUR), { mode: 'short', now: NOW }),
      ).toBe('1d ago');
      expect(
        formatRelativeTime(ago(3 * DAY), { mode: 'short', now: NOW }),
      ).toBe('3d ago');
      expect(
        formatRelativeTime(ago(6 * DAY), { mode: 'short', now: NOW }),
      ).toBe('6d ago');
    });

    it('returns "Nw ago" for weeks', () => {
      expect(
        formatRelativeTime(ago(7 * DAY), { mode: 'short', now: NOW }),
      ).toBe('1w ago');
      expect(
        formatRelativeTime(ago(14 * DAY), { mode: 'short', now: NOW }),
      ).toBe('2w ago');
      expect(
        formatRelativeTime(ago(25 * DAY), { mode: 'short', now: NOW }),
      ).toBe('3w ago');
    });

    it('returns short date "MMM D" for older dates within same year', () => {
      const date46 = ago(46 * DAY);
      const result = formatRelativeTime(date46, { mode: 'short', now: NOW });
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}$/);
      expect(result).toBe('Jan 1');
    });

    it('returns "MMM D, YYYY" for dates in previous year', () => {
      const datePrevYear = ago(365 * DAY);
      const result = formatRelativeTime(datePrevYear, {
        mode: 'short',
        now: NOW,
      });
      expect(result).toMatch(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/);
      expect(result).toBe('Feb 16, 2025');
    });
  });

  describe('edge cases (REQ-RT-003, REQ-RT-004)', () => {
    it('clamps future dates to "just now" in long mode', () => {
      expect(
        formatRelativeTime(ahead(5 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('just now');
    });

    it('clamps future dates to "now" in short mode', () => {
      expect(
        formatRelativeTime(ahead(5 * MINUTE), { mode: 'short', now: NOW }),
      ).toBe('now');
    });

    it('clamps far future dates to "just now" in long mode', () => {
      expect(
        formatRelativeTime(ahead(365 * DAY), { mode: 'long', now: NOW }),
      ).toBe('just now');
    });

    it('clamps far future dates to "now" in short mode', () => {
      expect(
        formatRelativeTime(ahead(365 * DAY), { mode: 'short', now: NOW }),
      ).toBe('now');
    });

    it('defaults to long mode when mode is not specified', () => {
      expect(formatRelativeTime(ago(5 * MINUTE), { now: NOW })).toBe(
        '5 minutes ago',
      );
      expect(formatRelativeTime(ago(2 * HOUR), { now: NOW })).toBe(
        '2 hours ago',
      );
    });

    it('uses current time when now is not specified', () => {
      // Create a date 5 minutes before actual current time
      const fiveMinAgo = new Date(Date.now() - 5 * MINUTE);
      const result = formatRelativeTime(fiveMinAgo);
      // Result should be close to "5 minutes ago" (allowing for test execution time)
      expect(result).toMatch(/^\d+ minutes? ago$/);
    });
  });

  describe('boundary tests', () => {
    it('exactly 30 seconds returns "just now"', () => {
      expect(
        formatRelativeTime(ago(30 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('just now');
    });

    it('exactly 31 seconds returns "1 minute ago"', () => {
      expect(
        formatRelativeTime(ago(31 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('1 minute ago');
    });

    it('exactly 90 seconds returns "1 minute ago"', () => {
      expect(
        formatRelativeTime(ago(90 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('1 minute ago');
    });

    it('exactly 91 seconds returns "2 minutes ago"', () => {
      expect(
        formatRelativeTime(ago(91 * SECOND), { mode: 'long', now: NOW }),
      ).toBe('2 minutes ago');
    });

    it('exactly 45 minutes returns "1 hour ago"', () => {
      expect(
        formatRelativeTime(ago(45 * MINUTE), { mode: 'long', now: NOW }),
      ).toBe('1 hour ago');
    });

    it('exactly 22 hours returns "yesterday"', () => {
      expect(
        formatRelativeTime(ago(22 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('yesterday');
    });

    it('exactly 36 hours returns "2 days ago"', () => {
      expect(
        formatRelativeTime(ago(36 * HOUR), { mode: 'long', now: NOW }),
      ).toBe('2 days ago');
    });

    it('exactly 7 days returns "1 week ago"', () => {
      expect(formatRelativeTime(ago(7 * DAY), { mode: 'long', now: NOW })).toBe(
        '1 week ago',
      );
    });
  });

  describe('property-based tests', () => {
    it('long mode never returns empty string for past dates', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 365 * DAY }), (delta) => {
          const date = ago(delta);
          const result = formatRelativeTime(date, { mode: 'long', now: NOW });
          return result.length > 0;
        }),
      );
    });

    it('short mode never returns empty string for past dates', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 365 * DAY }), (delta) => {
          const date = ago(delta);
          const result = formatRelativeTime(date, { mode: 'short', now: NOW });
          return result.length > 0;
        }),
      );
    });

    it('short mode output ≤ long mode length for same delta', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 26 * DAY }), (delta) => {
          const date = ago(delta);
          const longResult = formatRelativeTime(date, {
            mode: 'long',
            now: NOW,
          });
          const shortResult = formatRelativeTime(date, {
            mode: 'short',
            now: NOW,
          });
          return shortResult.length <= longResult.length;
        }),
      );
    });

    it('future dates always return "just now" in long mode', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 365 * DAY }), (delta) => {
          const future = ahead(delta);
          const result = formatRelativeTime(future, { mode: 'long', now: NOW });
          return result === 'just now';
        }),
      );
    });

    it('future dates always return "now" in short mode', () => {
      fc.assert(
        fc.property(fc.integer({ min: 1, max: 365 * DAY }), (delta) => {
          const future = ahead(delta);
          const result = formatRelativeTime(future, {
            mode: 'short',
            now: NOW,
          });
          return result === 'now';
        }),
      );
    });

    it('result format is consistent across time deltas', () => {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 45 * DAY }), (delta) => {
          const date = ago(delta);
          const longResult = formatRelativeTime(date, {
            mode: 'long',
            now: NOW,
          });
          const shortResult = formatRelativeTime(date, {
            mode: 'short',
            now: NOW,
          });

          // Long mode should contain words
          const hasWords =
            longResult.includes('just now') ||
            longResult.includes('minute') ||
            longResult.includes('hour') ||
            longResult.includes('yesterday') ||
            longResult.includes('day') ||
            longResult.includes('week') ||
            /^[A-Z][a-z]{2}/.test(longResult);

          // Short mode should be abbreviated or date
          const isShortFormat =
            shortResult === 'now' ||
            /^\d+[mhdw] ago$/.test(shortResult) ||
            /^[A-Z][a-z]{2}/.test(shortResult);

          return hasWords && isShortFormat;
        }),
      );
    });

    it('monotonic: larger deltas never produce "more recent" labels', () => {
      // Define order: just now < minutes < hours < yesterday < days < weeks < dates
      const getOrder = (result: string): number => {
        if (result === 'just now' || result === 'now') return 0;
        if (result.includes('minute') || /^\d+m ago$/.test(result)) return 1;
        if (result.includes('hour') || /^\d+h ago$/.test(result)) return 2;
        if (result === 'yesterday' || /^1d ago$/.test(result)) return 3;
        if (result.includes('day') || /^\d+d ago$/.test(result)) return 4;
        if (result.includes('week') || /^\d+w ago$/.test(result)) return 5;
        return 6; // formatted dates
      };

      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 45 * DAY }),
          fc.integer({ min: 0, max: 45 * DAY }),
          (delta1, delta2) => {
            const [smaller, larger] =
              delta1 <= delta2 ? [delta1, delta2] : [delta2, delta1];

            const smallerResult = formatRelativeTime(ago(smaller), {
              mode: 'long',
              now: NOW,
            });
            const largerResult = formatRelativeTime(ago(larger), {
              mode: 'long',
              now: NOW,
            });

            return getOrder(smallerResult) <= getOrder(largerResult);
          },
        ),
      );
    });
  });
});
