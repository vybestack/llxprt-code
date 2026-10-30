/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: request-byte pressure is a different budget from context
 * tokens. A request that has token headroom but exceeds the media byte budget
 * retires the oldest historical images from the request view, or gets exactly
 * one pass through the configured compression workflow when other media or the
 * request body is the pressure. Pending images are always kept, and the typed
 * byte error surfaces when nothing relieves the pressure.
 */

import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  assertRequestMediaBudget,
  RequestBodyByteOverflowError,
  RequestMediaByteOverflowError,
  RequestMediaResolutionError,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { createHistoryRuntimeFixture } from '../../core/__tests__/history-runtime-fixture.js';
import {
  ProviderContentEnforcer,
  type ProviderContentEnforcementDeps,
} from '../providerContentEnforcement.js';
import { PendingMediaBudgetError } from '../pendingMediaBudgetError.js';

const MODEL = 'test-model';
const BYTE_BUDGET = 1000;
const IMAGE_BASE64_LENGTH = 400;

function imageTurn(label: string): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `image ${label}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: label.repeat(IMAGE_BASE64_LENGTH).slice(0, IMAGE_BASE64_LENGTH),
        semanticMetadata: {},
      },
    ],
    metadata: { turnId: `turn-${label}` },
  };
}

function textTurn(speaker: IContent['speaker'], text: string): IContent {
  return { speaker, blocks: [{ type: 'text', text }] };
}

type Compression = (
  history: HistoryService,
) => Promise<PerformCompressionResult>;

interface Harness {
  readonly enforcer: ProviderContentEnforcer;
  readonly history: HistoryService;
  readonly compressionRuns: () => number;
  readonly envelope: (pending: IContent[]) => {
    contents: IContent[];
    pendingContents: IContent[];
  };
}

function harness(
  compression: Compression,
  estimate?: (contents: IContent[]) => Promise<number>,
  requestMediaBudgetBytes?: number,
): Harness {
  const history = new HistoryService();
  const runtimeContext = createHistoryRuntimeFixture({
    state: createAgentRuntimeState({
      runtimeId: 'byte-pressure',
      provider: 'test',
      model: MODEL,
      sessionId: 'byte-pressure-session',
    }),
    history,
    policy: {
      compressionThreshold: 0.8,
      contextLimit: 200_000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
      'reasoning.includeInContext': true,
    },
  });
  let runs = 0;
  const deps: ProviderContentEnforcementDeps = {
    historyService: history,
    runtimeContext,
    generationConfig: { maxOutputTokens: 1000 },
    readCompletionBudgetSetting: () =>
      runtimeContext.readCompletionBudgetSetting(),
    logger: DebugLogger.getLogger('test:issue3984:byte-pressure'),
    ensureDensityOptimized: () => Promise.resolve(),
    performCompression: async () => {
      runs += 1;
      return compression(history);
    },
    performFallbackCompression: () => Promise.resolve(false),
    getPromptTokenBaseline: () => null,
    resetPromptTokenBaseline: () => undefined,
    restorePromptTokenBaseline: () => undefined,
    ...(requestMediaBudgetBytes === undefined
      ? {}
      : { requestMediaBudgetBytes }),
    estimateFinalizedPromptTokens:
      estimate ??
      (async (contents) => {
        assertRequestMediaBudget(contents, 'turn-active', BYTE_BUDGET);
        return history.estimateTokensForContents(contents, MODEL);
      }),
  };
  return {
    enforcer: new ProviderContentEnforcer(deps),
    history,
    compressionRuns: () => runs,
    envelope: (pending) => ({
      contents: [...history.getCurated(), ...pending],
      pendingContents: pending,
    }),
  };
}

const summarizeHistory: Compression = async (history) => {
  history.clear();
  history.add(textTurn('ai', 'summary of earlier conversation'));
  await history.waitForTokenUpdates();
  return PerformCompressionResult.COMPRESSED;
};

function seedImages(history: HistoryService): void {
  history.add(imageTurn('a'));
  history.add(textTurn('ai', 'seen a'));
  history.add(imageTurn('b'));
  history.add(textTurn('ai', 'seen b'));
}

async function rejection(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error('Expected enforcement to reject');
}

describe('ProviderContentEnforcer byte pressure (issue #3984)', () => {
  it('sends the request unchanged without compressing when bytes fit', async () => {
    const h = harness(summarizeHistory);
    h.history.add(imageTurn('a'));
    await h.history.waitForTokenUpdates();
    const pending = [imageTurn('p')];

    const result = await h.enforcer.enforce(h.envelope(pending), 'p1');

    expect([result.length, h.compressionRuns()]).toStrictEqual([2, 0]);
  });

  it('compresses once under byte pressure and keeps the pending image', async () => {
    const h = harness(summarizeHistory);
    seedImages(h.history);
    await h.history.waitForTokenUpdates();
    const pending = [imageTurn('p')];

    const result = await h.enforcer.enforce(h.envelope(pending), 'p2');

    const retainedImages = result.flatMap((content) =>
      content.blocks.filter((block) => block.type === 'media'),
    );
    expect(retainedImages).toHaveLength(1);
    expect(h.compressionRuns()).toBe(1);
  });

  it('surfaces the typed byte error when compression changes nothing', async () => {
    const h = harness(() => Promise.resolve(PerformCompressionResult.NOOP));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p3'),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 1]);
  });

  it('surfaces the typed byte error when compression itself fails', async () => {
    const h = harness(() => Promise.reject(new Error('summarizer offline')));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p4'),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 1]);
  });

  it('does not relabel the byte overflow as a token projection failure', async () => {
    const h = harness(() => Promise.resolve(PerformCompressionResult.NOOP));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p5'),
    );

    expect(error instanceof Error ? error.message : '').toContain(
      'all selected images',
    );
  });

  describe('finalized request body overflow', () => {
    const BODY_LIMIT_CHARACTERS = 1000;

    function bodyEstimate(
      history: HistoryService,
    ): (contents: IContent[]) => Promise<number> {
      return async (contents) => {
        const characters = contents.reduce(
          (sum, content) =>
            sum +
            content.blocks.reduce(
              (blockSum, block) =>
                blockSum +
                (block.type === 'media' && block.encoding === 'base64'
                  ? block.data.length
                  : 0),
              0,
            ),
          0,
        );
        if (characters > BODY_LIMIT_CHARACTERS) {
          throw new RequestBodyByteOverflowError(
            characters,
            BODY_LIMIT_CHARACTERS,
          );
        }
        return history.estimateTokensForContents(contents, MODEL);
      };
    }

    it('shares the single bounded compression pass with media overflow', async () => {
      const history = new HistoryService();
      const h = harness(summarizeHistory, bodyEstimate(history));
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.enforcer.enforce(
        h.envelope([imageTurn('p')]),
        'body-1',
      );

      expect([result.length, h.compressionRuns()]).toStrictEqual([2, 1]);
    });

    it('surfaces the typed body error unlabelled when compression changes nothing', async () => {
      const history = new HistoryService();
      const h = harness(
        () => Promise.resolve(PerformCompressionResult.NOOP),
        bodyEstimate(history),
      );
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const error = await rejection(
        h.enforcer.enforce(h.envelope([imageTurn('p')]), 'body-2'),
      );

      expect([
        error instanceof RequestBodyByteOverflowError,
        h.compressionRuns(),
      ]).toStrictEqual([true, 1]);
    });
  });

  it('does not compress history when the pending image alone exceeds the budget', async () => {
    const h = harness(summarizeHistory);
    const oversizedPending: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'base64',
          mimeType: 'image/png',
          data: 'x'.repeat(BYTE_BUDGET + 1),
          semanticMetadata: {},
        },
      ],
    };

    const error = await rejection(
      h.enforcer.enforce(h.envelope([oversizedPending]), 'p6'),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 0]);
  });

  it('does not compress for missing media', async () => {
    const h = harness(summarizeHistory, () =>
      Promise.reject(
        new RequestMediaResolutionError('sha256:gone', 'turn-x', 'store read'),
      ),
    );
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p7'),
    );

    expect([error instanceof Error, h.compressionRuns()]).toStrictEqual([
      true,
      0,
    ]);
  });

  it('propagates cancellation raised during byte-pressure compression', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    const h = harness(() => Promise.reject(aborted));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p-abort'),
    );

    expect([error, h.compressionRuns()]).toStrictEqual([aborted, 1]);
  });

  it('does not treat a compression that fails but leaves a fitting request as success', async () => {
    const h = harness(async (history) => {
      history.clear();
      history.add(textTurn('ai', 'partial summary'));
      await history.waitForTokenUpdates();
      throw new Error('summarizer crashed after truncating history');
    });
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p-partial'),
    );

    expect(error instanceof RequestMediaByteOverflowError).toBe(true);
  });

  it('does not compress when the request is aborted', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    const h = harness(summarizeHistory, () => Promise.reject(aborted));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    await rejection(h.enforcer.enforce(h.envelope([imageTurn('p')]), 'p8'));

    expect(h.compressionRuns()).toBe(0);
  });

  it('does not attempt compression when the pending boundary is unrecoverable', async () => {
    const h = harness(summarizeHistory);
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.enforcer.enforce(
        {
          contents: [...h.history.getCurated(), imageTurn('p')],
          pendingContents: undefined,
        },
        'p9',
      ),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 0]);
  });

  describe('with historical image retirement enabled', () => {
    function mediaBlocks(contents: readonly IContent[]): number {
      return contents.flatMap((content) =>
        content.blocks.filter((block) => block.type === 'media'),
      ).length;
    }

    function noteCount(contents: readonly IContent[]): number {
      return contents.flatMap((content) =>
        content.blocks.filter(
          (block) =>
            block.type === 'text' &&
            block.text.includes('was omitted from this request'),
        ),
      ).length;
    }

    it('retires earlier images instead of compressing and keeps the pending image', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();
      const before = JSON.stringify(h.history.getAll());

      const result = await h.enforcer.enforce(
        h.envelope([imageTurn('p')]),
        'r1',
      );

      expect({
        media: mediaBlocks(result),
        notes: noteCount(result),
        compressionRuns: h.compressionRuns(),
        canonicalUnchanged: JSON.stringify(h.history.getAll()) === before,
      }).toStrictEqual({
        media: 1,
        notes: 2,
        compressionRuns: 0,
        canonicalUnchanged: true,
      });
    });

    it('reports a pending-only overflow without compressing or touching history', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();
      const oversizedPending: IContent = {
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'image/png',
            data: 'x'.repeat(BYTE_BUDGET + 1),
            semanticMetadata: {},
          },
        ],
      };
      const before = JSON.stringify(h.history.getAll());

      const error = await rejection(
        h.enforcer.enforce(h.envelope([oversizedPending]), 'r2'),
      );

      expect({
        typed: error instanceof PendingMediaBudgetError,
        stillByteOverflow: error instanceof RequestMediaByteOverflowError,
        compressionRuns: h.compressionRuns(),
        canonicalUnchanged: JSON.stringify(h.history.getAll()) === before,
      }).toStrictEqual({
        typed: true,
        stillByteOverflow: true,
        compressionRuns: 0,
        canonicalUnchanged: true,
      });
    });

    it('does not guess a pending boundary when it is undefined', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const error = await rejection(
        h.enforcer.enforce(
          {
            contents: [...h.history.getCurated(), imageTurn('p')],
            pendingContents: undefined,
          },
          'r3',
        ),
      );

      expect([
        error instanceof RequestMediaByteOverflowError,
        error instanceof PendingMediaBudgetError,
        h.compressionRuns(),
      ]).toStrictEqual([true, false, 0]);
    });

    it('leaves non-image media alone and still lets one compression pass relieve it', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      h.history.add({
        speaker: 'human',
        blocks: [
          {
            type: 'media',
            encoding: 'base64',
            mimeType: 'application/pdf',
            data: 'd'.repeat(700),
            semanticMetadata: {},
          },
        ],
      });
      h.history.add(textTurn('ai', 'read the document'));
      await h.history.waitForTokenUpdates();

      const result = await h.enforcer.enforce(
        h.envelope([imageTurn('p')]),
        'r4',
      );

      expect({
        compressionRuns: h.compressionRuns(),
        remainingMedia: mediaBlocks(result),
      }).toStrictEqual({ compressionRuns: 1, remainingMedia: 1 });
    });

    it('re-applies retirement to the recomposed contents after a real compression that keeps the images', async () => {
      const bloated = textTurn('human', 'filler '.repeat(500));
      const oversizedBody = (contents: IContent[]): number =>
        contents.reduce(
          (sum, content) =>
            sum +
            content.blocks.reduce(
              (blockSum, block) =>
                blockSum + (block.type === 'text' ? block.text.length : 0),
              0,
            ),
          0,
        );
      const history = new HistoryService();
      const h = harness(
        async (target) => {
          const kept = target
            .getCurated()
            .filter((content) =>
              content.blocks.some((b) => b.type === 'media'),
            );
          target.clear();
          for (const content of kept) target.add(content);
          await target.waitForTokenUpdates();
          return PerformCompressionResult.COMPRESSED;
        },
        async (contents) => {
          if (oversizedBody(contents) > 1000) {
            throw new RequestBodyByteOverflowError(
              oversizedBody(contents),
              1000,
            );
          }
          return history.estimateTokensForContents(contents, MODEL);
        },
        BYTE_BUDGET,
      );
      h.history.add(bloated);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.enforcer.enforce(
        h.envelope([imageTurn('p')]),
        'r5',
      );

      expect({
        compressionRuns: h.compressionRuns(),
        media: mediaBlocks(result),
        notes: noteCount(result),
        canonicalImages: mediaBlocks(h.history.getAll()),
      }).toStrictEqual({
        compressionRuns: 1,
        media: 1,
        notes: 2,
        canonicalImages: 2,
      });
    });

    it('returns an identical request view for repeated preparation of the same history', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();
      const pending = [imageTurn('p')];

      const first = await h.enforcer.enforce(h.envelope(pending), 'r6a');
      const second = await h.enforcer.enforce(h.envelope(pending), 'r6b');

      expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    });

    it('keeps canonical history and pending content when preparation is cancelled', async () => {
      const aborted = new DOMException('aborted', 'AbortError');
      const h = harness(
        summarizeHistory,
        () => Promise.reject(aborted),
        BYTE_BUDGET,
      );
      seedImages(h.history);
      await h.history.waitForTokenUpdates();
      const pending = [imageTurn('p')];
      const before = JSON.stringify([h.history.getAll(), pending]);

      const error = await rejection(
        h.enforcer.enforce(h.envelope(pending), 'r7'),
      );

      expect({
        rejected: error instanceof Error,
        unchanged: JSON.stringify([h.history.getAll(), pending]) === before,
      }).toStrictEqual({ rejected: true, unchanged: true });
    });

    it('re-applies retirement through the compression callback entry point', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.enforcer.compressAndRecompose(
        [imageTurn('p')],
        'r8',
      );

      expect({
        media: mediaBlocks(result),
        notes: noteCount(result),
      }).toStrictEqual({
        media: 1,
        notes: 2,
      });
    });

    it('does not retire anything for an explicit zero budget, leaving the existing policy path', async () => {
      const h = harness(summarizeHistory, undefined, 0);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.enforcer.enforce(
        h.envelope([imageTurn('p')]),
        'r9',
      );

      expect({
        compressionRuns: h.compressionRuns(),
        notes: noteCount(result),
      }).toStrictEqual({ compressionRuns: 1, notes: 0 });
    });
  });
});
