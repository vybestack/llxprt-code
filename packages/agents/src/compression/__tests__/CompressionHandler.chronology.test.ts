/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioural tests for issue #1721 constraint C2: chronology must survive
 * summarization. Compression destroys history items, so the summary that
 * replaces them must record the span it stands in for, and every item that
 * survives must keep the chronology marker it already had.
 *
 * These drive the real CompressionHandler write-back path against a real
 * HistoryService. Only the compression strategy (which would otherwise need a
 * live model) is substituted.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from '../../testApi.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type {
  CompressionProviderResult,
  CompressionStrategy,
  CompressionResultMetadata,
} from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';
import * as compressionFactory from '../compressionStrategyFactory.js';

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: {
    ...original.Storage,
    getGlobalConfigDir: vi.fn(() => '/tmp/llxprt-test-config'),
  },
}));

const STRATEGY_METADATA: CompressionResultMetadata = {
  originalMessageCount: 0,
  compressedMessageCount: 0,
  strategyUsed: 'one-shot',
};

function summaryContent(text: string): IContent {
  return {
    speaker: 'human',
    blocks: [{ type: 'text', text }],
    metadata: {
      isSummary: true,
      synthetic: true,
      reason: 'compression-state-snapshot',
    },
  };
}

/**
 * Install a compression strategy that returns the supplied history verbatim.
 * The strategy is the only substituted collaborator; the write-back path,
 * HistoryService, and chronology stamping are all real.
 */
function installStrategyReturning(newHistory: IContent[]): void {
  const strategy: CompressionStrategy = {
    name: 'one-shot',
    requiresLLM: true,
    trigger: 'threshold',
    compress: async () => ({
      kind: 'applied',
      newHistory,
      metadata: STRATEGY_METADATA,
    }),
  };
  vi.spyOn(compressionFactory, 'getCompressionStrategy').mockReturnValue(
    strategy,
  );
}

describe('CompressionHandler chronology survival (#1721 C2)', () => {
  let historyService: HistoryService;
  let runtimeContext: AgentRuntimeContext;
  let handler: CompressionHandler;

  beforeEach(() => {
    vi.clearAllMocks();
    historyService = new HistoryService();
    runtimeContext = buildRuntimeContext(historyService, {
      contextLimit: 200_000,
      compressionThreshold: 0.8,
    });

    const provider = {
      name: 'test',
      generateChatCompletion: vi.fn(),
    } as unknown as RuntimeProvider;
    const providerResult: CompressionProviderResult = { provider };
    handler = new CompressionHandler(
      runtimeContext,
      historyService,
      {},
      vi.fn().mockResolvedValue(providerResult),
      vi.fn().mockResolvedValue(undefined),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function seedFourTurns(): IContent[] {
    historyService.add(makeUserMessage('first'));
    historyService.add(makeUserMessage('second'));
    historyService.add(makeUserMessage('third'));
    historyService.add(makeUserMessage('fourth'));
    return [...historyService.getAll()];
  }

  /** AC15 */
  it('annotates the summary with the span of destroyed sequence numbers', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([summaryContent('summary'), seeded[3]]);

    const outcome = await handler.performCompression('prompt-1');

    expect(outcome).toBe(PerformCompressionResult.COMPRESSED);
    expect(
      historyService.getAll()[0].metadata?.chronologyReplaced,
    ).toStrictEqual({
      fromSeq: 1,
      toSeq: 3,
      itemCount: 3,
    });
  });

  it('stamps the summary with its own chronology marker', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([summaryContent('summary'), seeded[3]]);

    await handler.performCompression('prompt-1');

    expect(historyService.getAll()[0].metadata?.chronology?.seq).toBe(5);
  });

  it('preserves the chronology marker of every retained item', async () => {
    const seeded = seedFourTurns();
    const retainedSeq = seeded[3].metadata?.chronology?.seq;
    installStrategyReturning([summaryContent('summary'), seeded[3]]);

    await handler.performCompression('prompt-1');

    expect(historyService.getAll()[1].metadata?.chronology?.seq).toBe(
      retainedSeq,
    );
  });

  it('leaves every item in history carrying a chronology marker', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([summaryContent('summary'), seeded[3]]);

    await handler.performCompression('prompt-1');

    for (const item of historyService.getAll()) {
      expect(item.metadata?.chronology).toBeDefined();
    }
  });

  it('does not annotate a summary when compression destroyed nothing', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([summaryContent('summary'), ...seeded]);

    await handler.performCompression('prompt-1');

    expect(
      historyService.getAll()[0].metadata?.chronologyReplaced,
    ).toBeUndefined();
  });

  it('records a truncation-only result as a gap without a summary annotation', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([seeded[2], seeded[3]]);

    await handler.performCompression('prompt-1');

    const seqs = historyService
      .getAll()
      .map((item) => item.metadata?.chronology?.seq);
    expect(seqs).toStrictEqual([3, 4]);
  });

  it('does not annotate retained items when compression only truncated', async () => {
    const seeded = seedFourTurns();
    installStrategyReturning([seeded[2], seeded[3]]);

    await handler.performCompression('prompt-1');

    for (const item of historyService.getAll()) {
      expect(item.metadata?.chronologyReplaced).toBeUndefined();
    }
  });
});
