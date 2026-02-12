/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-COMPRESSION.P09
 * @requirement REQ-CS-001.2, REQ-CS-001.3
 *
 * Behavioral tests for the compression strategy factory.
 * Verifies that strategy instances are resolved by name and that
 * unknown names are rejected with actionable errors.
 */

import { describe, it, expect } from 'vitest';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from './compressionStrategyFactory.js';
import { MiddleOutStrategy } from './MiddleOutStrategy.js';
import { TopDownTruncationStrategy } from './TopDownTruncationStrategy.js';
import { OneShotStrategy } from './OneShotStrategy.js';
import { COMPRESSION_STRATEGIES, UnknownStrategyError } from './types.js';

describe('compressionStrategyFactory @plan PLAN-20260211-COMPRESSION.P09', () => {
  // -----------------------------------------------------------------------
  // getCompressionStrategy
  // -----------------------------------------------------------------------

  describe('getCompressionStrategy @requirement REQ-CS-001.2', () => {
    it('returns a MiddleOutStrategy instance for middle-out', () => {
      const strategy = getCompressionStrategy('middle-out');
      expect(strategy).toBeInstanceOf(MiddleOutStrategy);
    });

    it('returns a TopDownTruncationStrategy instance for top-down-truncation', () => {
      const strategy = getCompressionStrategy('top-down-truncation');
      expect(strategy).toBeInstanceOf(TopDownTruncationStrategy);
    });

    it('returned middle-out instance has correct name and requiresLLM', () => {
      const strategy = getCompressionStrategy('middle-out');
      expect(strategy.name).toBe('middle-out');
      expect(strategy.requiresLLM).toBe(true);
    });

    it('returned top-down-truncation instance has correct name and requiresLLM', () => {
      const strategy = getCompressionStrategy('top-down-truncation');
      expect(strategy.name).toBe('top-down-truncation');
      expect(strategy.requiresLLM).toBe(false);
    });

    it('returns an OneShotStrategy instance for one-shot', () => {
      const strategy = getCompressionStrategy('one-shot');
      expect(strategy).toBeInstanceOf(OneShotStrategy);
    });

    it('returned one-shot instance has correct name and requiresLLM', () => {
      const strategy = getCompressionStrategy('one-shot');
      expect(strategy.name).toBe('one-shot');
      expect(strategy.requiresLLM).toBe(true);
    });

    it('returns fresh instances on each call (not singletons)', () => {
      const a = getCompressionStrategy('middle-out');
      const b = getCompressionStrategy('middle-out');
      expect(a).not.toBe(b);
    });
  });

  // -----------------------------------------------------------------------
  // parseCompressionStrategyName
  // -----------------------------------------------------------------------

  describe('parseCompressionStrategyName @requirement REQ-CS-001.3', () => {
    it('returns middle-out for valid input', () => {
      expect(parseCompressionStrategyName('middle-out')).toBe('middle-out');
    });

    it('returns top-down-truncation for valid input', () => {
      expect(parseCompressionStrategyName('top-down-truncation')).toBe(
        'top-down-truncation',
      );
    });

    it('returns one-shot for valid input', () => {
      expect(parseCompressionStrategyName('one-shot')).toBe('one-shot');
    });

    it('throws UnknownStrategyError for an unknown name', () => {
      expect(() => parseCompressionStrategyName('nonexistent')).toThrow(
        UnknownStrategyError,
      );
    });

    it('error message includes the unknown name', () => {
      expect(() => parseCompressionStrategyName('nonexistent')).toThrow(
        /nonexistent/,
      );
    });
  });

  // -----------------------------------------------------------------------
  // Interface contract: every registered strategy satisfies CompressionStrategy
  // -----------------------------------------------------------------------

  describe('interface contract across all strategies @requirement REQ-CS-001.2', () => {
    for (const strategyName of COMPRESSION_STRATEGIES) {
      it(`${strategyName}: name matches, requiresLLM is boolean, compress is function`, () => {
        const strategy = getCompressionStrategy(strategyName);
        expect(strategy.name).toBe(strategyName);
        expect(typeof strategy.requiresLLM).toBe('boolean');
        expect(typeof strategy.compress).toBe('function');
      });
    }
  });
});
