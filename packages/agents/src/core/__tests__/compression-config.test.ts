/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for compression configuration invariants.
 *
 * These tests assert module-level invariants of the exported compression
 * thresholds so that an invalid constant (e.g. NaN, out-of-range fraction,
 * non-positive char limit) cannot silently ship. They do NOT mock anything;
 * they validate the real exported values and the validation guard.
 */

import { describe, it, expect } from 'vitest';
import {
  COMPRESSION_TOKEN_THRESHOLD,
  COMPRESSION_PRESERVE_THRESHOLD,
  COMPRESSION_TOP_PRESERVE_THRESHOLD,
  MAX_MESSAGE_CHARS_IN_PRESERVED,
  validateCompressionConfig,
  type CompressionConfig,
} from '../compression-config.js';

describe('compression-config exported thresholds', () => {
  describe('COMPRESSION_TOKEN_THRESHOLD', () => {
    it('is a finite number strictly between 0 and 1', () => {
      expect(Number.isFinite(COMPRESSION_TOKEN_THRESHOLD)).toBe(true);
      expect(COMPRESSION_TOKEN_THRESHOLD).toBeGreaterThan(0);
      expect(COMPRESSION_TOKEN_THRESHOLD).toBeLessThan(1);
    });
  });

  describe('COMPRESSION_PRESERVE_THRESHOLD', () => {
    it('is a finite number strictly between 0 and 1', () => {
      expect(Number.isFinite(COMPRESSION_PRESERVE_THRESHOLD)).toBe(true);
      expect(COMPRESSION_PRESERVE_THRESHOLD).toBeGreaterThan(0);
      expect(COMPRESSION_PRESERVE_THRESHOLD).toBeLessThan(1);
    });

    it('is derived from the token threshold via 2 * (1 - token)', () => {
      expect(COMPRESSION_PRESERVE_THRESHOLD).toBeCloseTo(
        2 * (1 - COMPRESSION_TOKEN_THRESHOLD),
        10,
      );
    });
  });

  describe('COMPRESSION_TOP_PRESERVE_THRESHOLD', () => {
    it('is a finite number strictly between 0 and 1', () => {
      expect(Number.isFinite(COMPRESSION_TOP_PRESERVE_THRESHOLD)).toBe(true);
      expect(COMPRESSION_TOP_PRESERVE_THRESHOLD).toBeGreaterThan(0);
      expect(COMPRESSION_TOP_PRESERVE_THRESHOLD).toBeLessThan(1);
    });
  });

  describe('preserve invariant', () => {
    it('keeps combined top + middle preserve below the token threshold', () => {
      // The combined preserved fraction (top + middle) must not reach or exceed
      // the compression trigger threshold, otherwise compression would never
      // actually remove enough history to be worthwhile.
      const combined =
        COMPRESSION_TOP_PRESERVE_THRESHOLD + COMPRESSION_PRESERVE_THRESHOLD;
      expect(combined).toBeLessThan(COMPRESSION_TOKEN_THRESHOLD);
    });
  });

  describe('MAX_MESSAGE_CHARS_IN_PRESERVED', () => {
    it('is a positive integer', () => {
      expect(Number.isInteger(MAX_MESSAGE_CHARS_IN_PRESERVED)).toBe(true);
      expect(MAX_MESSAGE_CHARS_IN_PRESERVED).toBeGreaterThan(0);
    });
  });
});

describe('validateCompressionConfig', () => {
  it('returns a valid result for the real exported configuration', () => {
    const result = validateCompressionConfig({
      tokenThreshold: COMPRESSION_TOKEN_THRESHOLD,
      preserveThreshold: COMPRESSION_PRESERVE_THRESHOLD,
      topPreserveThreshold: COMPRESSION_TOP_PRESERVE_THRESHOLD,
      maxMessageCharsInPreserved: MAX_MESSAGE_CHARS_IN_PRESERVED,
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toStrictEqual([]);
  });

  it('rejects a token threshold at or beyond 1', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 1,
      preserveThreshold: 0.2,
      topPreserveThreshold: 0.1,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a token threshold at or below 0', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 0,
      preserveThreshold: 0.2,
      topPreserveThreshold: 0.1,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects NaN thresholds', () => {
    const result = validateCompressionConfig({
      tokenThreshold: Number.NaN,
      preserveThreshold: 0.2,
      topPreserveThreshold: 0.1,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a preserve threshold outside (0, 1)', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 0.85,
      preserveThreshold: 1.5,
      topPreserveThreshold: 0.1,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a top preserve threshold outside (0, 1)', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 0.85,
      preserveThreshold: 0.2,
      topPreserveThreshold: 0,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects a non-positive or non-integer max message chars', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 0.85,
      preserveThreshold: 0.2,
      topPreserveThreshold: 0.1,
      maxMessageCharsInPreserved: 0,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('rejects combined preserve that meets or exceeds the token threshold', () => {
    const result = validateCompressionConfig({
      tokenThreshold: 0.5,
      preserveThreshold: 0.3,
      topPreserveThreshold: 0.3,
      maxMessageCharsInPreserved: 5000,
    });
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('collects multiple errors rather than failing fast', () => {
    const result = validateCompressionConfig({
      tokenThreshold: Number.NaN,
      preserveThreshold: 5,
      topPreserveThreshold: -1,
      maxMessageCharsInPreserved: -10,
    } satisfies CompressionConfig);
    expect(result.valid).toBe(false);
    // At least one error per invalid field.
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
