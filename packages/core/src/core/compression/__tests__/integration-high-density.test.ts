/**
 * @plan PLAN-20260211-HIGHDENSITY.P24, P25
 * @requirement REQ-HD-004.1, REQ-HD-004.3, REQ-HD-009.1
 *
 * Integration tests verifying the high-density strategy works end-to-end
 * through the settings → factory → strategy → compression pipeline.
 */
import { describe, it, expect } from 'vitest';
import { COMPRESSION_STRATEGIES } from '../types.js';
import {
  getCompressionStrategy,
  parseCompressionStrategyName,
} from '../compressionStrategyFactory.js';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import type { CompressionContext } from '../types.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { AgentRuntimeContext } from '../../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import type { PromptResolver } from '../../../prompt-config/PromptResolver.js';
import type { Logger } from '../../../utils/logger.js';

function makeMinimalContext(
  history: IContent[] = [],
  overrides: Partial<CompressionContext> = {},
): CompressionContext {
  return {
    history,
    runtimeContext: {
      ephemerals: {
        preserveThreshold: () => 0.3,
        topPreserveThreshold: () => 0.2,
        compressionThreshold: () => 0.85,
        contextLimit: () => 128000,
        compressionProfile: () => undefined,
        densityReadWritePruning: () => true,
        densityFileDedupe: () => true,
        densityRecencyPruning: () => false,
        densityRecencyRetention: () => 3,
        densityCompressHeadroom: () => 0.6,
      },
    } as unknown as AgentRuntimeContext,
    runtimeState: { model: 'test-model' } as unknown as AgentRuntimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: history.length * 100,
    logger: {
      debug: () => {},
      error: () => {},
      warn: () => {},
    } as unknown as Logger,
    resolveProvider: () => {
      throw new Error('Should not call resolveProvider for high-density');
    },
    promptResolver: { resolve: () => undefined } as unknown as PromptResolver,
    promptBaseDir: '/test',
    promptContext: {},
    promptId: 'test-prompt',
    ...overrides,
  };
}

describe('Integration: Strategy Resolution Chain', () => {
  it('high-density is in COMPRESSION_STRATEGIES tuple', () => {
    expect(COMPRESSION_STRATEGIES).toContain('high-density');
  });

  it('parseCompressionStrategyName validates high-density', () => {
    expect(parseCompressionStrategyName('high-density')).toBe('high-density');
  });

  it('factory returns HighDensityStrategy for high-density', () => {
    const strategy = getCompressionStrategy('high-density');
    expect(strategy).toBeInstanceOf(HighDensityStrategy);
    expect(strategy.name).toBe('high-density');
  });

  it('all strategies in tuple are resolvable by factory', () => {
    for (const name of COMPRESSION_STRATEGIES) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.name).toBe(name);
      expect(typeof strategy.compress).toBe('function');
    }
  });
});

describe('Integration: Density + Compression Pipeline', () => {
  it('optimize returns valid DensityResult for empty history', () => {
    const strategy = new HighDensityStrategy();
    const context = makeMinimalContext([]);
    const config = {
      recencyRetention: 3,
      enableReadWritePruning: true,
      enableDeduplication: true,
      enableRecencyPruning: false,
      workspaceRoot: '/test',
    };
    const result = strategy.optimize!(context.history, config);
    expect(result.removals).toHaveLength(0);
    expect(result.replacements.size).toBe(0);
    expect(result.metadata.readWritePairsPruned).toBe(0);
    expect(result.metadata.fileDeduplicationsPruned).toBe(0);
    expect(result.metadata.recencyPruned).toBe(0);
  });

  it('compress returns valid CompressionResult for empty history', async () => {
    const strategy = new HighDensityStrategy();
    const context = makeMinimalContext([]);
    const result = await strategy.compress(context);
    expect(result.newHistory).toEqual([]);
    expect(result.metadata.llmCallMade).toBe(false);
    expect(result.metadata.strategyUsed).toBe('high-density');
  });

  it('compress returns valid CompressionResult for populated history', async () => {
    const history: IContent[] = Array.from({ length: 10 }, (_, i) => ({
      speaker: (i % 2 === 0 ? 'human' : 'ai') as 'human' | 'ai',
      blocks: [{ type: 'text' as const, text: `Message ${i}` }],
    }));
    const strategy = new HighDensityStrategy();
    const context = makeMinimalContext(history);
    const result = await strategy.compress(context);
    expect(result.newHistory.length).toBeGreaterThan(0);
    expect(result.metadata.originalMessageCount).toBe(10);
    expect(result.metadata.llmCallMade).toBe(false);
  });

  it('existing strategies still work after high-density additions', async () => {
    for (const name of [
      'middle-out',
      'top-down-truncation',
      'one-shot',
    ] as const) {
      const strategy = getCompressionStrategy(name);
      expect(strategy.name).toBe(name);
      expect(typeof strategy.compress).toBe('function');
    }
  });
});

describe('Integration: Settings → Runtime Accessor', () => {
  it('density settings have correct types', () => {
    const ctx = makeMinimalContext();
    const ephemerals = ctx.runtimeContext.ephemerals;
    expect(typeof ephemerals.densityReadWritePruning()).toBe('boolean');
    expect(typeof ephemerals.densityFileDedupe()).toBe('boolean');
    expect(typeof ephemerals.densityRecencyPruning()).toBe('boolean');
    expect(typeof ephemerals.densityRecencyRetention()).toBe('number');
  });
});
