/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'bun:test';
import {
  formatTokensPerMinute,
  formatThrottleTime,
  formatSessionTokenUsage,
} from './tokenFormatters.js';

describe('formatTokensPerMinute', () => {
  it('returns the raw integer string below the 1K threshold', () => {
    expect(formatTokensPerMinute(0)).toBe('0');
    expect(formatTokensPerMinute(1)).toBe('1');
    expect(formatTokensPerMinute(999)).toBe('999');
  });

  it('appends a K suffix with one decimal at and above 1000', () => {
    expect(formatTokensPerMinute(1000)).toBe('1.0K');
    expect(formatTokensPerMinute(1500)).toBe('1.5K');
    expect(formatTokensPerMinute(12340)).toBe('12.3K');
    expect(formatTokensPerMinute(100000)).toBe('100.0K');
  });

  it('keeps the K band up to but not including 1,000,000', () => {
    // 999999 / 1000 = 999.999, rounds to 1000.0 under toFixed(1)
    expect(formatTokensPerMinute(999999)).toBe('1000.0K');
  });

  it('switches to an M suffix at and above 1,000,000', () => {
    expect(formatTokensPerMinute(1000000)).toBe('1.0M');
    expect(formatTokensPerMinute(1500000)).toBe('1.5M');
    expect(formatTokensPerMinute(1234567)).toBe('1.2M');
  });
});

describe('formatThrottleTime', () => {
  it('reports sub-second waits in milliseconds', () => {
    expect(formatThrottleTime(0)).toBe('0ms');
    expect(formatThrottleTime(1)).toBe('1ms');
    expect(formatThrottleTime(999)).toBe('999ms');
  });

  it('reports waits from 1000ms up to one minute in seconds with one decimal', () => {
    expect(formatThrottleTime(1000)).toBe('1.0s');
    expect(formatThrottleTime(1500)).toBe('1.5s');
    expect(formatThrottleTime(45000)).toBe('45.0s');
    // 59999ms / 1000 = 59.999, rounds up to 60.0 seconds (still below the
    // 60000ms minute threshold, so it stays in the seconds band).
    expect(formatThrottleTime(59999)).toBe('60.0s');
  });

  it('switches to a minutes suffix at and above 60000ms', () => {
    expect(formatThrottleTime(60000)).toBe('1.0m');
    expect(formatThrottleTime(125000)).toBe('2.1m');
  });
});

// `formatSessionTokenUsage` groups numbers with `toLocaleString()` and no
// explicit locale, so the separator follows the host locale. Expectations are
// composed the same way rather than hard-coding en-US separators, which would
// make these assertions fail on a runner with a different default locale.
const grouped = (value: number): string => value.toLocaleString();

describe('formatSessionTokenUsage', () => {
  it('renders every category with locale grouping in a single line', () => {
    const usage = {
      input: 12345,
      output: 8901,
      cache: 2345,
      tool: 567,
      thought: 123,
      total: 24281,
    };

    expect(formatSessionTokenUsage(usage)).toBe(
      `Session Tokens - Input: ${grouped(12345)}, Output: ${grouped(8901)}, ` +
        `Cache: ${grouped(2345)}, Tool: ${grouped(567)}, ` +
        `Thought: ${grouped(123)}, Total: ${grouped(24281)}`,
    );
  });

  it('renders an all-zero session without hiding any category', () => {
    const usage = {
      input: 0,
      output: 0,
      cache: 0,
      tool: 0,
      thought: 0,
      total: 0,
    };

    expect(formatSessionTokenUsage(usage)).toBe(
      'Session Tokens - Input: 0, Output: 0, Cache: 0, Tool: 0, Thought: 0, Total: 0',
    );
  });

  it('groups large values with locale thousands separators', () => {
    const usage = {
      input: 1234567,
      output: 987654,
      cache: 456789,
      tool: 123456,
      thought: 78901,
      total: 2881367,
    };

    const formatted = formatSessionTokenUsage(usage);

    expect(formatted).toContain(`Input: ${grouped(1234567)}`);
    expect(formatted).toContain(`Output: ${grouped(987654)}`);
    expect(formatted).toContain(`Cache: ${grouped(456789)}`);
    expect(formatted).toContain(`Tool: ${grouped(123456)}`);
    expect(formatted).toContain(`Thought: ${grouped(78901)}`);
    expect(formatted).toContain(`Total: ${grouped(2881367)}`);
    // Grouping actually happened: the raw digits alone are not what is shown.
    expect(grouped(1234567)).not.toBe('1234567');
  });

  it('always orders the categories as input, output, cache, tool, thought, total', () => {
    const usage = {
      input: 1,
      output: 2,
      cache: 3,
      tool: 4,
      thought: 5,
      total: 15,
    };

    const formatted = formatSessionTokenUsage(usage);
    const inputPos = formatted.indexOf('Input:');
    const outputPos = formatted.indexOf('Output:');
    const cachePos = formatted.indexOf('Cache:');
    const toolPos = formatted.indexOf('Tool:');
    const thoughtPos = formatted.indexOf('Thought:');
    const totalPos = formatted.indexOf('Total:');

    expect(inputPos).toBeLessThan(outputPos);
    expect(outputPos).toBeLessThan(cachePos);
    expect(cachePos).toBeLessThan(toolPos);
    expect(toolPos).toBeLessThan(thoughtPos);
    expect(thoughtPos).toBeLessThan(totalPos);
  });
});
