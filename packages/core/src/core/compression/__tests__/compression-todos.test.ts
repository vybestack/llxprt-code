/**
 * @plan PLAN-20260211-HIGHDENSITY.P22
 * @requirement REQ-HD-011.3, REQ-HD-011.4, REQ-HD-012.2
 */
import { describe, it, expect } from 'vitest';
import { HighDensityStrategy } from '../HighDensityStrategy.js';
import { TopDownTruncationStrategy } from '../TopDownTruncationStrategy.js';
import type { CompressionContext } from '../types.js';
import type { IContent } from '../../../services/history/IContent.js';
import type { AgentRuntimeContext } from '../../../runtime/AgentRuntimeContext.js';
import type { AgentRuntimeState } from '../../../runtime/AgentRuntimeState.js';
import type { PromptResolver } from '../../../prompt-config/PromptResolver.js';
import type { Logger } from '../../../utils/logger.js';

function makeHistory(count: number): IContent[] {
  const entries: IContent[] = [];
  for (let i = 0; i < count; i++) {
    entries.push({
      speaker: i % 2 === 0 ? 'human' : 'ai',
      blocks: [{ type: 'text', text: `Message ${i}` }],
    });
  }
  return entries;
}

function makeContext(
  overrides: Partial<CompressionContext> = {},
): CompressionContext {
  const history = overrides.history ?? makeHistory(20);
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
    runtimeState: {
      model: 'test-model',
    } as unknown as AgentRuntimeState,
    estimateTokens: async (contents: readonly IContent[]) =>
      contents.length * 100,
    currentTokenCount: history.length * 100,
    logger: {
      debug: () => {},
      error: () => {},
      warn: () => {},
    } as unknown as Logger,
    resolveProvider: () => {
      throw new Error('resolveProvider should not be called in non-LLM tests');
    },
    promptResolver: {
      resolve: () => undefined,
    } as unknown as PromptResolver,
    promptBaseDir: '/test',
    promptContext: {},
    promptId: 'test-prompt',
    ...overrides,
  };
}

describe('HighDensityStrategy ignores activeTodos (REQ-HD-011.4)', () => {
  it('compress result is unaffected by activeTodos', async () => {
    const strategy = new HighDensityStrategy();
    const contextWithout = makeContext({ activeTodos: undefined });
    const contextWith = makeContext({
      activeTodos:
        '- [pending] Fix the auth bug\n- [in_progress] Refactor DB layer',
    });

    const resultWithout = await strategy.compress(contextWithout);
    const resultWith = await strategy.compress(contextWith);

    expect(resultWith.metadata.strategyUsed).toBe('high-density');
    expect(resultWith.newHistory.length).toBe(resultWithout.newHistory.length);
  });
});

describe('TopDownTruncationStrategy ignores activeTodos (REQ-HD-011.4)', () => {
  it('compress result is unaffected by activeTodos', async () => {
    const strategy = new TopDownTruncationStrategy();
    const contextWithout = makeContext({ activeTodos: undefined });
    const contextWith = makeContext({
      activeTodos:
        '- [pending] Fix the auth bug\n- [in_progress] Refactor DB layer',
    });

    const resultWithout = await strategy.compress(contextWithout);
    const resultWith = await strategy.compress(contextWith);

    expect(resultWith.metadata.strategyUsed).toBe('top-down-truncation');
    expect(resultWith.newHistory.length).toBe(resultWithout.newHistory.length);
  });
});
