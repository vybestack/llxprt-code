/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Join streaming thinking deltas while preserving real-time updates.
 *
 * Why this exists:
 * Some providers (notably Kimi in specific turns) occasionally emit adjacent
 * text deltas without boundary whitespace. Naive concatenation then produces
 * fused words like "NowIhave...". This helper inserts a single space only when
 * both boundaries look like word characters and no explicit whitespace/punctuation
 * already exists.
 */
export function joinThinkingDelta(previous: string, delta: string): string {
  if (!delta) {
    return previous;
  }
  if (!previous) {
    return delta;
  }

  const prevLast = previous[previous.length - 1] ?? '';
  const nextFirst = delta[0] ?? '';

  // Respect explicit provider formatting.
  if (/\s/u.test(prevLast) || /\s/u.test(nextFirst)) {
    return previous + delta;
  }

  // Don't inject spaces around punctuation/symbol boundaries.
  // We only care about alnum-alnum joins that indicate fused prose words.
  if (/[A-Za-z0-9]/u.test(prevLast) && /[A-Za-z0-9]/u.test(nextFirst)) {
    return `${previous} ${delta}`;
  }

  return previous + delta;
}
