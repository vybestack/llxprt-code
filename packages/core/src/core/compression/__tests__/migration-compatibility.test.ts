/**
 * @plan PLAN-20260211-HIGHDENSITY.P27
 * @requirement REQ-HD-009.1, REQ-HD-004.3
 *
 * Migration compatibility tests: verify existing strategies and settings
 * continue to work identically after high-density additions.
 */
import { describe, it, expect } from 'vitest';
import {
  COMPRESSION_STRATEGIES,
  type CompressionStrategyName,
} from '../types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from '../compressionStrategyFactory.js';

describe('Migration: Default Strategy Unchanged', () => {
  it('middle-out is still the first entry in COMPRESSION_STRATEGIES', () => {
    expect(COMPRESSION_STRATEGIES[0]).toBe('middle-out');
  });

  it('middle-out strategy resolves correctly', () => {
    const strategy = getCompressionStrategy('middle-out');
    expect(strategy.name).toBe('middle-out');
  });

  it('all pre-existing strategies still resolve', () => {
    const preExisting: CompressionStrategyName[] = [
      'middle-out',
      'top-down-truncation',
      'one-shot',
    ];
    for (const name of preExisting) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.name).toBe(name);
    }
  });
});

describe('Migration: No Breaking Changes to Strategy Interface', () => {
  it('all strategies have trigger property', () => {
    for (const name of COMPRESSION_STRATEGIES) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.trigger).toBeDefined();
      expect(strategy.trigger.mode).toBeTruthy();
    }
  });

  it('pre-existing strategies use threshold trigger', () => {
    const preExisting: CompressionStrategyName[] = [
      'middle-out',
      'top-down-truncation',
      'one-shot',
    ];
    for (const name of preExisting) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.trigger.mode).toBe('threshold');
    }
  });

  it('high-density uses continuous trigger', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(strategy.trigger.mode).toBe('continuous');
  });

  it('pre-existing strategies do NOT have optimize', () => {
    const preExisting: CompressionStrategyName[] = [
      'middle-out',
      'top-down-truncation',
      'one-shot',
    ];
    for (const name of preExisting) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.optimize).toBeUndefined();
    }
  });
});

describe('Migration: parseCompressionStrategyName compatibility', () => {
  it('rejects invalid names with UnknownStrategyError', () => {
    expect(() => parseCompressionStrategyName('invalid')).toThrow();
    expect(() => parseCompressionStrategyName('')).toThrow();
  });

  it('accepts all COMPRESSION_STRATEGIES entries', () => {
    for (const name of COMPRESSION_STRATEGIES) {
      expect(parseCompressionStrategyName(name)).toBe(name);
    }
  });
});
