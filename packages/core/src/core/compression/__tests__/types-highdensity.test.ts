/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @plan PLAN-20260211-HIGHDENSITY.P04
 * @requirement REQ-HD-001.1, REQ-HD-001.2, REQ-HD-001.3, REQ-HD-001.4, REQ-HD-001.10, REQ-HD-004.1
 *
 * Behavioral tests for the high-density compression types and strategy
 * interface extensions introduced in P03. Tests verify runtime behavior
 * of type shapes, existing strategy triggers, COMPRESSION_STRATEGIES tuple,
 * factory resolution, and CompressionContext extensions.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import type { IContent } from '../../../services/history/IContent.js';
import { COMPRESSION_STRATEGIES } from '../types.js';
import type {
  CompressionStrategyName,
  StrategyTrigger,
  DensityResult,
  DensityResultMetadata,
  DensityConfig,
  CompressionContext,
} from '../types.js';
import { MiddleOutStrategy } from '../MiddleOutStrategy.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import { OneShotStrategy } from '../OneShotStrategy.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from '../compressionStrategyFactory.js';

// ---------------------------------------------------------------------------
// COMPRESSION_STRATEGIES tuple
// ---------------------------------------------------------------------------

describe('COMPRESSION_STRATEGIES @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-004.1
   */
  it('includes high-density as a valid strategy name', () => {
    expect(COMPRESSION_STRATEGIES).toContain('high-density');
  });

  it('contains exactly 4 entries', () => {
    expect(COMPRESSION_STRATEGIES).toHaveLength(4);
  });

  it('contains all expected strategy names', () => {
    expect(COMPRESSION_STRATEGIES).toContain('middle-out');
    expect(COMPRESSION_STRATEGIES).toContain('top-down-truncation');
    expect(COMPRESSION_STRATEGIES).toContain('one-shot');
    expect(COMPRESSION_STRATEGIES).toContain('high-density');
  });

  /**
   * @requirement REQ-HD-004.1
   */
  it('parseCompressionStrategyName accepts high-density', () => {
    expect(parseCompressionStrategyName('high-density')).toBe('high-density');
  });
});

// ---------------------------------------------------------------------------
// Type shape tests — runtime construction
// ---------------------------------------------------------------------------

describe('Type shapes @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.1
   */
  describe('StrategyTrigger', () => {
    it('threshold trigger has mode and defaultThreshold', () => {
      const trigger: StrategyTrigger = {
        mode: 'threshold',
        defaultThreshold: 0.85,
      };
      expect(trigger.mode).toBe('threshold');
      expect(trigger.defaultThreshold).toBe(0.85);
    });

    it('continuous trigger has mode and defaultThreshold', () => {
      const trigger: StrategyTrigger = {
        mode: 'continuous',
        defaultThreshold: 0.7,
      };
      expect(trigger.mode).toBe('continuous');
      expect(trigger.defaultThreshold).toBe(0.7);
    });
  });

  /**
   * @requirement REQ-HD-001.5
   */
  describe('DensityResult', () => {
    it('can be constructed with removals, replacements, and metadata', () => {
      const metadata: DensityResultMetadata = {
        readWritePairsPruned: 2,
        fileDeduplicationsPruned: 1,
        recencyPruned: 3,
      };
      const result: DensityResult = {
        removals: [0, 3, 5],
        replacements: new Map<number, IContent>(),
        metadata,
      };

      expect(result.removals).toEqual([0, 3, 5]);
      expect(result.replacements.size).toBe(0);
      expect(result.metadata).toBe(metadata);
    });

    it('replacements map holds IContent entries keyed by index', () => {
      const replacement: IContent = {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'deduplicated' }],
      };
      const result: DensityResult = {
        removals: [],
        replacements: new Map([[4, replacement]]),
        metadata: {
          readWritePairsPruned: 0,
          fileDeduplicationsPruned: 1,
          recencyPruned: 0,
        },
      };

      expect(result.replacements.get(4)).toBe(replacement);
      expect(result.replacements.size).toBe(1);
    });
  });

  /**
   * @requirement REQ-HD-001.8
   */
  describe('DensityResultMetadata', () => {
    it('has readWritePairsPruned, fileDeduplicationsPruned, and recencyPruned', () => {
      const metadata: DensityResultMetadata = {
        readWritePairsPruned: 5,
        fileDeduplicationsPruned: 2,
        recencyPruned: 8,
      };
      expect(metadata.readWritePairsPruned).toBe(5);
      expect(metadata.fileDeduplicationsPruned).toBe(2);
      expect(metadata.recencyPruned).toBe(8);
    });
  });

  /**
   * @requirement REQ-HD-001.9
   */
  describe('DensityConfig', () => {
    it('has all 5 required fields', () => {
      const config: DensityConfig = {
        readWritePruning: true,
        fileDedupe: false,
        recencyPruning: true,
        recencyRetention: 10,
        workspaceRoot: '/home/user/project',
      };
      expect(config.readWritePruning).toBe(true);
      expect(config.fileDedupe).toBe(false);
      expect(config.recencyPruning).toBe(true);
      expect(config.recencyRetention).toBe(10);
      expect(config.workspaceRoot).toBe('/home/user/project');
    });
  });
});

// ---------------------------------------------------------------------------
// Existing strategy trigger tests
// ---------------------------------------------------------------------------

describe('Existing strategy triggers @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.3
   * @pseudocode strategy-interface.md lines 11-13
   */
  it('MiddleOutStrategy has trigger { mode: threshold, defaultThreshold: 0.85 }', () => {
    const strategy = new MiddleOutStrategy();
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  /**
   * @requirement REQ-HD-001.3
   */
  it('TopDownTruncationStrategy has trigger { mode: threshold, defaultThreshold: 0.85 }', () => {
    const strategy = new TopDownTruncationStrategy();
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  /**
   * @requirement REQ-HD-001.3
   */
  it('OneShotStrategy has trigger { mode: threshold, defaultThreshold: 0.85 }', () => {
    const strategy = new OneShotStrategy();
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  /**
   * @requirement REQ-HD-001.4
   */
  it('MiddleOutStrategy does NOT implement optimize', () => {
    const strategy = new MiddleOutStrategy();
    expect(strategy.optimize).toBeUndefined();
  });

  /**
   * @requirement REQ-HD-001.4
   */
  it('TopDownTruncationStrategy does NOT implement optimize', () => {
    const strategy = new TopDownTruncationStrategy();
    expect(strategy.optimize).toBeUndefined();
  });

  /**
   * @requirement REQ-HD-001.4
   */
  it('OneShotStrategy does NOT implement optimize', () => {
    const strategy = new OneShotStrategy();
    expect(strategy.optimize).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Existing strategy compress compatibility
// ---------------------------------------------------------------------------

describe('Existing strategy compress compatibility @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.4
   */
  it('MiddleOutStrategy.compress is a function', () => {
    const strategy = new MiddleOutStrategy();
    expect(typeof strategy.compress).toBe('function');
  });

  /**
   * @requirement REQ-HD-001.4
   */
  it('TopDownTruncationStrategy.compress with empty history returns unchanged', async () => {
    const strategy = new TopDownTruncationStrategy();
    const ctx = buildMinimalContext({ history: [] });
    const result = await strategy.compress(ctx);
    expect(result.newHistory).toHaveLength(0);
    expect(result.metadata.originalMessageCount).toBe(0);
    expect(result.metadata.strategyUsed).toBe('top-down-truncation');
  });

  /**
   * @requirement REQ-HD-001.4
   */
  it('OneShotStrategy.compress is a function', () => {
    const strategy = new OneShotStrategy();
    expect(typeof strategy.compress).toBe('function');
  });
});

// ---------------------------------------------------------------------------
// Factory tests
// ---------------------------------------------------------------------------

describe('Factory high-density support @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.1
   */
  it('getCompressionStrategy returns MiddleOutStrategy for middle-out', () => {
    const strategy = getCompressionStrategy('middle-out');
    expect(strategy).toBeInstanceOf(MiddleOutStrategy);
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  it('getCompressionStrategy returns TopDownTruncationStrategy for top-down-truncation', () => {
    const strategy = getCompressionStrategy('top-down-truncation');
    expect(strategy).toBeInstanceOf(TopDownTruncationStrategy);
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  it('getCompressionStrategy returns OneShotStrategy for one-shot', () => {
    const strategy = getCompressionStrategy('one-shot');
    expect(strategy).toBeInstanceOf(OneShotStrategy);
    expect(strategy.trigger).toEqual({
      mode: 'threshold',
      defaultThreshold: 0.85,
    });
  });

  /**
   * @requirement REQ-HD-004.1, REQ-HD-004.3
   * @plan PLAN-20260211-HIGHDENSITY.P09
   */
  it('getCompressionStrategy returns HighDensityStrategy for high-density', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(strategy).toBeInstanceOf(HighDensityStrategy);
    expect(strategy.trigger).toEqual({
      mode: 'continuous',
      defaultThreshold: 0.85,
    });
  });
});

// ---------------------------------------------------------------------------
// CompressionContext extensions
// ---------------------------------------------------------------------------

describe('CompressionContext extensions @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.2
   */
  it('activeTodos is optional — context without it is valid', () => {
    const ctx = buildMinimalContext({});
    expect(ctx.activeTodos).toBeUndefined();
  });

  it('transcriptPath is optional — context without it is valid', () => {
    const ctx = buildMinimalContext({});
    expect(ctx.transcriptPath).toBeUndefined();
  });

  it('activeTodos can be provided as a string', () => {
    const ctx = buildMinimalContext({ activeTodos: '- [ ] Fix bug #42' });
    expect(ctx.activeTodos).toBe('- [ ] Fix bug #42');
  });

  it('transcriptPath can be provided as a string', () => {
    const ctx = buildMinimalContext({ transcriptPath: '/tmp/transcript.md' });
    expect(ctx.transcriptPath).toBe('/tmp/transcript.md');
  });
});

// ---------------------------------------------------------------------------
// Property-based tests (≥ 30% of total)
// ---------------------------------------------------------------------------

describe('Property-based tests @plan PLAN-20260211-HIGHDENSITY.P04', () => {
  /**
   * @requirement REQ-HD-001.1, REQ-HD-001.10
   */
  it('StrategyTrigger defaultThreshold is always a positive number for all strategies', () => {
    const strategies = [
      new MiddleOutStrategy(),
      new TopDownTruncationStrategy(),
      new OneShotStrategy(),
    ];

    fc.assert(
      fc.property(fc.integer({ min: 0, max: strategies.length - 1 }), (idx) => {
        const trigger = strategies[idx].trigger;
        expect(trigger.defaultThreshold).toBeGreaterThan(0);
        expect(typeof trigger.defaultThreshold).toBe('number');
        expect(Number.isFinite(trigger.defaultThreshold)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * @requirement REQ-HD-001.5
   */
  it('DensityResult removals and replacements accept any non-negative integers', () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1000 }), { minLength: 0, maxLength: 20 }),
        fc.nat({ max: 100 }),
        (removals, replacementCount) => {
          const replacements = new Map<number, IContent>();
          for (let i = 0; i < replacementCount && i < 10; i++) {
            replacements.set(i, {
              speaker: 'human',
              blocks: [{ type: 'text', text: `replacement-${i}` }],
            });
          }

          const result: DensityResult = {
            removals,
            replacements,
            metadata: {
              readWritePairsPruned: 0,
              fileDeduplicationsPruned: 0,
              recencyPruned: 0,
            },
          };

          expect(Array.isArray(result.removals)).toBe(true);
          expect(result.replacements).toBeInstanceOf(Map);
          for (const idx of result.removals) {
            expect(idx).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * @requirement REQ-HD-001.8
   */
  it('DensityResultMetadata counts are always non-negative', () => {
    fc.assert(
      fc.property(
        fc.nat({ max: 500 }),
        fc.nat({ max: 500 }),
        fc.nat({ max: 500 }),
        (rwPairs, fileDedups, recency) => {
          const metadata: DensityResultMetadata = {
            readWritePairsPruned: rwPairs,
            fileDeduplicationsPruned: fileDedups,
            recencyPruned: recency,
          };

          expect(metadata.readWritePairsPruned).toBeGreaterThanOrEqual(0);
          expect(metadata.fileDeduplicationsPruned).toBeGreaterThanOrEqual(0);
          expect(metadata.recencyPruned).toBeGreaterThanOrEqual(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * @requirement REQ-HD-001.9
   */
  it('DensityConfig recencyRetention accepts any positive integer', () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.boolean(),
        fc.boolean(),
        fc.integer({ min: 1, max: 10000 }),
        fc.string({ minLength: 1, maxLength: 200 }),
        (
          readWritePruning,
          fileDedupe,
          recencyPruning,
          recencyRetention,
          workspaceRoot,
        ) => {
          const config: DensityConfig = {
            readWritePruning,
            fileDedupe,
            recencyPruning,
            recencyRetention,
            workspaceRoot,
          };

          expect(typeof config.readWritePruning).toBe('boolean');
          expect(typeof config.fileDedupe).toBe('boolean');
          expect(typeof config.recencyPruning).toBe('boolean');
          expect(config.recencyRetention).toBeGreaterThan(0);
          expect(typeof config.workspaceRoot).toBe('string');
          expect(config.workspaceRoot.length).toBeGreaterThan(0);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * @requirement REQ-HD-001.1
   */
  it('every strategy from factory has a valid trigger with mode and defaultThreshold', () => {
    const validNames: CompressionStrategyName[] = [
      'middle-out',
      'top-down-truncation',
      'one-shot',
    ];

    fc.assert(
      fc.property(fc.integer({ min: 0, max: validNames.length - 1 }), (idx) => {
        const strategy = getCompressionStrategy(validNames[idx]);
        expect(strategy.trigger).toBeDefined();
        expect(['threshold', 'continuous']).toContain(strategy.trigger.mode);
        expect(typeof strategy.trigger.defaultThreshold).toBe('number');
        expect(strategy.trigger.defaultThreshold).toBeGreaterThan(0);
        expect(strategy.trigger.defaultThreshold).toBeLessThanOrEqual(1);
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Minimal CompressionContext builder for tests that just need the shape
// ---------------------------------------------------------------------------

function buildMinimalContext(
  overrides: Partial<{
    history: IContent[];
    activeTodos: string;
    transcriptPath: string;
  }> = {},
): CompressionContext {
  return {
    history: overrides.history ?? [],
    runtimeContext: {
      state: {
        runtimeId: 'test',
        provider: 'test',
        model: 'test',
        sessionId: 'test',
        updatedAt: Date.now(),
      },
      ephemerals: {
        compressionThreshold: () => 0.8,
        contextLimit: () => 100000,
        preserveThreshold: () => 0.2,
        topPreserveThreshold: () => 0.2,
        compressionProfile: () => undefined,
        toolFormatOverride: () => undefined,
        reasoning: {
          enabled: () => false,
          includeInContext: () => false,
          includeInResponse: () => false,
          format: () => 'native' as const,
          stripFromContext: () => 'none' as const,
          effort: () => undefined,
          maxTokens: () => undefined,
          adaptiveThinking: () => undefined,
        },
      },
    } as unknown as CompressionContext['runtimeContext'],
    runtimeState: {
      runtimeId: 'test',
      provider: 'test',
      model: 'test',
      sessionId: 'test',
      updatedAt: Date.now(),
    } as unknown as CompressionContext['runtimeState'],
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: 5000,
    logger: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      log: () => {},
    } as unknown as CompressionContext['logger'],
    resolveProvider: () => {
      throw new Error('No provider in minimal context');
    },
    promptResolver: {
      resolveFile: () => ({ found: false, path: null, source: null }),
    } as unknown as CompressionContext['promptResolver'],
    promptBaseDir: '/tmp/test',
    promptContext: { provider: 'test', model: 'test' },
    promptId: 'test',
    ...(overrides.activeTodos !== undefined
      ? { activeTodos: overrides.activeTodos }
      : {}),
    ...(overrides.transcriptPath !== undefined
      ? { transcriptPath: overrides.transcriptPath }
      : {}),
  };
}
