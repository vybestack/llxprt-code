/**
 * @license
 * Copyright 2025 Vybestack LLC
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

const ELLIPSIS = '...';

function truncatePathMiddle(
  text: string,
  maxLength: number,
  segments: string[],
): string | null {
  const firstDir = segments[0];
  const filename = segments[segments.length - 1];
  const parentDir = segments.length > 2 ? segments[segments.length - 2] : '';
  // Preserve leading slash for absolute paths (segments[0] === '' when
  // text starts with '/').
  const leadingSlash = text.startsWith('/') ? '/' : '';

  if (parentDir && segments.length >= 3) {
    const candidate =
      leadingSlash + firstDir + ELLIPSIS + '/' + parentDir + '/' + filename;
    if (candidate.length <= maxLength) {
      return candidate;
    }
  }

  const candidate2 = leadingSlash + firstDir + ELLIPSIS + '/' + filename;
  if (candidate2.length <= maxLength) {
    return candidate2;
  }

  if (maxLength <= 10) {
    const firstChar = firstDir.length > 0 ? firstDir.charAt(0) : '/';
    const availableForEnd = maxLength - firstChar.length - ELLIPSIS.length - 1;
    if (availableForEnd > 0) {
      const endPart =
        filename.length <= availableForEnd
          ? filename
          : filename.substring(filename.length - availableForEnd);
      return firstChar + ELLIPSIS + '/' + endPart;
    }
  }

  const availableForStart = maxLength - ELLIPSIS.length - filename.length - 1;
  if (availableForStart > 0) {
    const startPart = text.substring(0, availableForStart);
    return startPart + ELLIPSIS + '/' + filename;
  }

  return null;
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

  if (text.includes('/')) {
    const segments = text.split('/');
    if (segments.length >= 2) {
      const pathResult = truncatePathMiddle(text, maxLength, segments);
      if (pathResult !== null) {
        return pathResult;
      }
    }
  }

  const availableSpace = maxLength - ELLIPSIS.length;
  const startChars = Math.ceil(availableSpace / 2);
  const endChars = Math.floor(availableSpace / 2);

  const start = text.substring(0, startChars);
  const end = text.substring(text.length - endChars);

  return start + ELLIPSIS + end;
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

  const endChars = maxLength - ELLIPSIS.length;
  return ELLIPSIS + text.slice(-endChars);
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

  const keepChars = maxLength - ELLIPSIS.length;

  return text.substring(0, keepChars) + ELLIPSIS;
}
