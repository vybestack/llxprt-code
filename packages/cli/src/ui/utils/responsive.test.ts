/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import {
  BREAKPOINTS,
  getBreakpoint,
  isNarrowWidth,
  truncateMiddle,
  truncateEnd,
} from './responsive.js';

describe('BREAKPOINTS', () => {
  it('should define consistent breakpoint values', () => {
    expect(BREAKPOINTS).toEqual({
      NARROW: 80,
      STANDARD: 120,
      WIDE: 160,
    });
  });

  it('should have ascending breakpoint values', () => {
    expect(BREAKPOINTS.NARROW).toBeLessThan(BREAKPOINTS.STANDARD);
    expect(BREAKPOINTS.STANDARD).toBeLessThan(BREAKPOINTS.WIDE);
  });
});

describe('getBreakpoint', () => {
  it('should return NARROW for widths below narrow threshold', () => {
    expect(getBreakpoint(79)).toBe('NARROW');
    expect(getBreakpoint(50)).toBe('NARROW');
    expect(getBreakpoint(0)).toBe('NARROW');
  });

  it('should return STANDARD for width exactly at narrow threshold', () => {
    expect(getBreakpoint(80)).toBe('STANDARD');
  });

  it('should return STANDARD for widths between narrow and standard', () => {
    expect(getBreakpoint(81)).toBe('STANDARD');
    expect(getBreakpoint(100)).toBe('STANDARD');
    expect(getBreakpoint(119)).toBe('STANDARD');
  });

  it('should return STANDARD for width exactly at standard threshold', () => {
    expect(getBreakpoint(120)).toBe('STANDARD');
  });

  it('should return WIDE for widths at or above wide threshold', () => {
    expect(getBreakpoint(160)).toBe('WIDE');
    expect(getBreakpoint(200)).toBe('WIDE');
    expect(getBreakpoint(1000)).toBe('WIDE');
  });
});

describe('isNarrowWidth', () => {
  it('should return true for widths below narrow threshold', () => {
    expect(isNarrowWidth(79)).toBe(true);
    expect(isNarrowWidth(50)).toBe(true);
    expect(isNarrowWidth(0)).toBe(true);
  });

  it('should return false for widths at or above narrow threshold', () => {
    expect(isNarrowWidth(80)).toBe(false);
    expect(isNarrowWidth(100)).toBe(false);
    expect(isNarrowWidth(200)).toBe(false);
  });
});

describe('truncateMiddle', () => {
  it('should return original text when shorter than max length', () => {
    expect(truncateMiddle('short', 10)).toBe('short');
    expect(truncateMiddle('exactly10c', 10)).toBe('exactly10c');
  });

  it('should truncate long paths intelligently', () => {
    const longPath = '/users/john/projects/llxprt/src/components/index.ts';
    const result = truncateMiddle(longPath, 30);
    expect(result.length).toBeLessThanOrEqual(30);
    expect(result).toContain('...');
    expect(result).toContain('index.ts');
  });

  it('should handle very short max lengths', () => {
    const result = truncateMiddle('/very/long/path/file.ts', 10);
    expect(result.length).toBeLessThanOrEqual(10);
    expect(result).toContain('...');
  });

  it('should handle empty string', () => {
    expect(truncateMiddle('', 10)).toBe('');
  });

  it('should handle max length of 1', () => {
    expect(truncateMiddle('abc', 1)).toBe('.');
  });

  it('should preserve meaningful parts in path truncation', () => {
    const result = truncateMiddle('/a/very/long/path/to/important.tsx', 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result).toContain('...');
    expect(result).toContain('important.tsx');
  });
});

describe('truncateEnd', () => {
  it('should return original text when shorter than max length', () => {
    expect(truncateEnd('short text', 15)).toBe('short text');
    expect(truncateEnd('exactly15chars!', 15)).toBe('exactly15chars!');
  });

  it('should truncate with ellipsis at end', () => {
    expect(
      truncateEnd('This is a very long text that needs truncation', 20),
    ).toBe('This is a very lo...');
  });

  it('should handle very short max lengths', () => {
    expect(truncateEnd('long text', 5)).toBe('lo...');
  });

  it('should handle empty string', () => {
    expect(truncateEnd('', 10)).toBe('');
  });

  it('should handle max length of 1', () => {
    expect(truncateEnd('abc', 1)).toBe('.');
  });

  it('should handle max length less than ellipsis length', () => {
    expect(truncateEnd('text', 2)).toBe('..');
  });
});
