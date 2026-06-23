/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Unit tests for sanitizePromptCacheKey (issue #2135).
 */

import { describe, it, expect } from 'vitest';
import {
  sanitizePromptCacheKey,
  MAX_PROMPT_CACHE_KEY_LENGTH,
} from '../sanitizePromptCacheKey.js';

describe('sanitizePromptCacheKey @issue:2135', () => {
  it('returns a runtimeId at exactly 64 chars unchanged', () => {
    const id64 = 'a'.repeat(64);
    expect(sanitizePromptCacheKey(id64)).toBe(id64);
    expect(sanitizePromptCacheKey(id64).length).toBe(64);
  });

  it('returns a short runtimeId unchanged (trimmed)', () => {
    expect(sanitizePromptCacheKey('test-runtime-id-123')).toBe(
      'test-runtime-id-123',
    );
  });

  it('trims leading/trailing whitespace', () => {
    expect(sanitizePromptCacheKey('  test-id  ')).toBe('test-id');
  });

  it('maps a long compression-style runtimeId to <=64 chars deterministically', () => {
    // This is the exact shape from issue #2135 (69 chars).
    const longId =
      'cli-isolated-abcdefghij0::compression-profile:compression-profile';
    expect(longId.length).toBeGreaterThan(MAX_PROMPT_CACHE_KEY_LENGTH);

    const sanitized = sanitizePromptCacheKey(longId);
    expect(sanitized.length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY_LENGTH);
    expect(sanitized.startsWith('rk:')).toBe(true);

    // Deterministic: same input -> same output
    expect(sanitizePromptCacheKey(longId)).toBe(sanitized);
  });

  it('produces distinct keys for distinct long runtimeIds (no naive truncation collision)', () => {
    const base =
      'cli-isolated-session-0000000000000000000000000000000000000000';
    const longA = `${base}::compression-profile:profileA`;
    const longB = `${base}::compression-profile:profileB`;

    // Naive truncation to 64 chars would yield the same key for both.
    expect(longA.slice(0, 64)).toBe(longB.slice(0, 64));

    const sanitizedA = sanitizePromptCacheKey(longA);
    const sanitizedB = sanitizePromptCacheKey(longB);
    expect(sanitizedA).not.toBe(sanitizedB);
    expect(sanitizedA.length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY_LENGTH);
    expect(sanitizedB.length).toBeLessThanOrEqual(MAX_PROMPT_CACHE_KEY_LENGTH);
  });
});
