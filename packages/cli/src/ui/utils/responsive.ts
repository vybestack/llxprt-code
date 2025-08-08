/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

export const BREAKPOINTS = {
  NARROW: 80,
  STANDARD: 120,
  WIDE: 160,
} as const;

export type Breakpoint = keyof typeof BREAKPOINTS;

export function getBreakpoint(width: number): Breakpoint {
  if (width < BREAKPOINTS.NARROW) {
    return 'NARROW';
  }
  if (width <= BREAKPOINTS.STANDARD) {
    return 'STANDARD';
  }
  return 'WIDE';
}

export function isNarrowWidth(width: number): boolean {
  return width < BREAKPOINTS.NARROW;
}

export function truncateMiddle(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return '.';
  }

  if (maxLength <= 3) {
    return '..';
  }

  const ellipsis = '...';

  // For path-like strings, use smart path truncation
  if (text.includes('/')) {
    const segments = text.split('/');
    if (segments.length < 2) {
      // Not really a path, fall back to standard truncation
    } else {
      const firstDir = segments[0];
      const filename = segments[segments.length - 1];
      const parentDir =
        segments.length > 2 ? segments[segments.length - 2] : '';

      // Try: firstDir + ... + parentDir + filename
      if (parentDir && segments.length >= 3) {
        const candidate =
          firstDir + ellipsis + '/' + parentDir + '/' + filename;
        if (candidate.length <= maxLength) {
          return candidate;
        }
      }

      // Try: firstDir + ... + filename
      const candidate2 = firstDir + ellipsis + '/' + filename;
      if (candidate2.length <= maxLength) {
        return candidate2;
      }

      // Try: /firstChar + ... + endOfFilename (for very constrained cases)
      if (maxLength <= 10) {
        const firstChar = firstDir.length > 0 ? firstDir.charAt(0) : '/';
        const availableForEnd =
          maxLength - firstChar.length - ellipsis.length - 1; // -1 for '/'
        if (availableForEnd > 0) {
          const endPart =
            filename.length <= availableForEnd
              ? filename
              : filename.substring(filename.length - availableForEnd);
          return firstChar + ellipsis + '/' + endPart;
        }
      }

      // Character-based fallback
      const availableForStart =
        maxLength - ellipsis.length - filename.length - 1; // -1 for '/'
      if (availableForStart > 0) {
        const startPart = text.substring(0, availableForStart);
        return startPart + ellipsis + '/' + filename;
      }
    }
  }

  // Standard middle truncation for non-path strings
  const availableSpace = maxLength - ellipsis.length;
  const startChars = Math.ceil(availableSpace / 2);
  const endChars = Math.floor(availableSpace / 2);

  const start = text.substring(0, startChars);
  const end = text.substring(text.length - endChars);

  return start + ellipsis + end;
}

export function truncateStart(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return '.';
  }

  if (maxLength <= 3) {
    return '.'.repeat(maxLength);
  }

  const ellipsis = '...';
  const endChars = maxLength - ellipsis.length;
  return ellipsis + text.slice(-endChars);
}

export function truncateEnd(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return '.';
  }

  if (maxLength <= 3) {
    return '.'.repeat(maxLength);
  }

  const ellipsis = '...';
  const keepChars = maxLength - ellipsis.length;

  return text.substring(0, keepChars) + ellipsis;
}
