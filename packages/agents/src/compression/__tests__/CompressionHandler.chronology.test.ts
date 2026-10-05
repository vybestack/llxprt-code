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

import { describe, it, expect, beforeEach, afterEach, vi } from 'bun:test';
import { collectRowsForAssertions } from '../../../../core/src/test-utils/collect-rows-for-assertions.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { CompressionProviderResult } from '@vybestack/llxprt-code-core/core/compression/types.js';
import type { RuntimeProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  makeUserMessage,
  buildRuntimeContext,
} from '../../core/__tests__/chatSession-density-helpers.js';
import { CompressionHandler } from '../CompressionHandler.js';
import { OneShotStrategy } from '../OneShotStrategy.js';

const original = { ...(await import('@vybestack/llxprt-code-settings')) };
void vi.mock('@vybestack/llxprt-code-settings', () => ({
  ...original,
  Storage: {
    ...original.Storage,
    getGlobalConfigDir: vi.fn(() => '/tmp/llxprt-test-config'),
  },
}));

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
  vi.spyOn(OneShotStrategy.prototype, 'compressDisk').mockImplementation(
    async (_context, candidate) => {
      for (const row of newHistory) candidate.append(row);
      return { kind: 'applied', top: 0 };
    },
  );
}

function makeChronologyHandler(
  historyService: HistoryService,
): CompressionHandler {
  const runtimeContext = buildRuntimeContext(historyService, {
    compressionStrategy: 'one-shot',
    contextLimit: 200_000,
    compressionThreshold: 0.8,
  });

  const provider = {
    name: 'test',
    generateChatCompletion: vi.fn(),
  } as unknown as RuntimeProvider;
  const providerResult: CompressionProviderResult = { provider };
  return new CompressionHandler(
    runtimeContext,
    historyService,
    {},
    vi.fn().mockResolvedValue(providerResult),
    vi.fn().mockResolvedValue(undefined),
  );
}

async function compressFourTurns(
  historyService: HistoryService,
  handler: CompressionHandler,
  newHistory: (seeded: readonly IContent[]) => IContent[],
  assertCompressed: (
    contentsForAssertions: readonly IContent[],
    outcome: PerformCompressionResult,
    retainedSeq: number | undefined,
  ) => void | Promise<void>,
): Promise<void> {
  historyService.add(makeUserMessage('first'));
  historyService.add(makeUserMessage('second'));
  historyService.add(makeUserMessage('third'));
  historyService.add(makeUserMessage('fourth'));
  await collectRowsForAssertions(
    historyService.getComprehensive(),
    async (seeded) => {
      const retainedSeq = seeded[3].metadata?.chronology?.seq;
      installStrategyReturning(newHistory(seeded));
      const outcome = await handler.performCompression('prompt-1');
      await collectRowsForAssertions(
        historyService.getComprehensive(),
        (rows) => assertCompressed(rows, outcome, retainedSeq),
      );
    },
  );
}

function retainTail(seeded: readonly IContent[]): IContent[] {
  return [summaryContent('summary'), seeded[3]];
}

function retainTruncatedTail(seeded: readonly IContent[]): IContent[] {
  return [seeded[2], seeded[3]];
}

function fourTurnCompression(
  historyService: HistoryService,
  handler: CompressionHandler,
): (
  newHistory: Parameters<typeof compressFourTurns>[2],
  assertCompressed: Parameters<typeof compressFourTurns>[3],
) => Promise<void> {
  return (newHistory, assertCompressed) =>
    compressFourTurns(historyService, handler, newHistory, assertCompressed);
}

describe('CompressionHandler chronology survival (#1721 C2)', () => {
  let compress: ReturnType<typeof fourTurnCompression>;
  beforeEach(() => {
    vi.clearAllMocks();
    const historyService = new HistoryService();
    compress = fourTurnCompression(
      historyService,
      makeChronologyHandler(historyService),
    );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** AC15 */
  it('annotates the summary with the span of destroyed sequence numbers', async () => {
    await compress(retainTail, (contentsForAssertions, outcome) => {
      expect(outcome).toBe(PerformCompressionResult.COMPRESSED);
      expect(
        contentsForAssertions[0].metadata?.chronologyReplaced,
      ).toStrictEqual({
        fromSeq: 1,
        toSeq: 3,
        itemCount: 3,
      });
    });
  });
  it('stamps the summary with its own chronology marker', async () => {
    await compress(retainTail, (contentsForAssertions) => {
      expect(contentsForAssertions[0].metadata?.chronology?.seq).toBe(5);
    });
  });
  it('preserves the chronology marker of every retained item', async () => {
    await compress(
      retainTail,
      (contentsForAssertions, _outcome, retainedSeq) => {
        expect(contentsForAssertions[1].metadata?.chronology?.seq).toBe(
          retainedSeq,
        );
      },
    );
  });
  it('leaves every item in history carrying a chronology marker', async () => {
    await compress(retainTail, (contentsForAssertions) => {
      for (const item of contentsForAssertions) {
        expect(item.metadata?.chronology).toBeDefined();
      }
    });
  });
  it('does not annotate a summary when compression destroyed nothing', async () => {
    await compress(
      (seeded) => [summaryContent('summary'), ...seeded],
      (contentsForAssertions) => {
        expect(
          contentsForAssertions[0].metadata?.chronologyReplaced,
        ).toBeUndefined();
      },
    );
  });
  it('records a truncation-only result as a gap without a summary annotation', async () => {
    await compress(retainTruncatedTail, (contentsForAssertions) => {
      const seqs = contentsForAssertions.map(
        (item) => item.metadata?.chronology?.seq,
      );
      expect(seqs).toStrictEqual([3, 4]);
    });
  });
  it('does not annotate retained items when compression only truncated', async () => {
    await compress(retainTruncatedTail, (contentsForAssertions) => {
      for (const item of contentsForAssertions) {
        expect(item.metadata?.chronologyReplaced).toBeUndefined();
      }
    });
  });
});
