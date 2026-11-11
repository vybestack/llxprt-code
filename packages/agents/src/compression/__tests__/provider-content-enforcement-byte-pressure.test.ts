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

import { afterEach, describe, expect, it } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RetirementSession } from './image-retirement-harness.js';
import { readHistory, readCurated } from './retirement-source-fixture.js';
const sessions: Array<{ session: RetirementSession; directory: string }> = [];

import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import {
  RequestBodyByteOverflowError,
  RequestMediaByteOverflowError,
  RequestMediaResolutionError,
} from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
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

function pdfTurn(label: string, base64Length: number): IContent {
  return {
    speaker: 'human',
    blocks: [
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'application/pdf',
        data: 'd'.repeat(base64Length),
        semanticMetadata: {},
      },
    ],
    metadata: { turnId: `turn-${label}` },
  };
}

type Compression = (
  history: HistoryService,
) => Promise<PerformCompressionResult>;

function harness(
  compression: Compression,
  estimate?: (contents: IContent[]) => Promise<number>,
  requestMediaBudgetBytes?: number,
) {
  const directory = mkdtempSync(join(tmpdir(), 'byte-pressure-source-'));
  const session = new RetirementSession(
    directory,
    BYTE_BUDGET,
    undefined,
    requestMediaBudgetBytes ?? 15 * 1024 * 1024,
  );
  sessions.push({ session, directory });
  session.contextLimit = 200_000;
  session.useCompression(compression);
  session.estimateOverride = estimate;
  return {
    history: session.history,
    compressionRuns: () => session.compressionRuns,
    envelope: (pending: IContent[]) => ({ pendingContents: pending }),
    send: async (
      request: {
        pendingContents: IContent[] | undefined;
        contents?: IContent[];
      },
      _prompt: string,
    ): Promise<IContent[]> => {
      const { contents } = await session.send(
        request.pendingContents ?? [],
        true,
        { pending: request.pendingContents, contents: request.contents },
      );
      return contents;
    },
    callback: (pending: IContent[], _prompt: string) =>
      session.recomposeViaCallback(pending),
  };
}

const summarizeHistory: Compression = async (history) => {
  await history.clear();
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

/** Earlier non-image media: nothing the request view may retire. */
function seedDocuments(history: HistoryService): void {
  history.add(pdfTurn('a', 400));
  history.add(textTurn('ai', 'read a'));
  history.add(pdfTurn('b', 400));
  history.add(textTurn('ai', 'read b'));
}

function mediaCount(contents: readonly IContent[]): number {
  return contents.flatMap((content) =>
    content.blocks.filter((block) => block.type === 'media'),
  ).length;
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
  afterEach(async () => {
    for (const { session, directory } of sessions.splice(0).reverse()) {
      await session.dispose();
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('sends the request unchanged without compressing when bytes fit', async () => {
    const h = harness(summarizeHistory);
    h.history.add(imageTurn('a'));
    await h.history.waitForTokenUpdates();
    const pending = [imageTurn('p')];

    const result = await h.send(h.envelope(pending), 'p1');

    expect([result.length, h.compressionRuns()]).toStrictEqual([2, 0]);
  });

  it('compresses once under byte pressure and keeps the pending image', async () => {
    const h = harness(summarizeHistory);
    seedImages(h.history);
    await h.history.waitForTokenUpdates();
    const pending = [imageTurn('p')];

    const result = await h.send(h.envelope(pending), 'p2');

    const retainedImages = result.flatMap((content) =>
      content.blocks.filter((block) => block.type === 'media'),
    );
    expect(retainedImages).toHaveLength(1);
    expect(h.compressionRuns()).toBe(1);
  });

  it('retires every historical image and keeps the pending one when compression changes nothing (issue #4000)', async () => {
    const h = harness(() => Promise.resolve(PerformCompressionResult.NOOP));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const result = await h.send(h.envelope([imageTurn('p')]), 'p3');

    expect([mediaCount(result), h.compressionRuns()]).toStrictEqual([1, 1]);
  });

  it('retires every historical image and keeps the pending one when compression itself fails (issue #4000)', async () => {
    const h = harness(() => Promise.reject(new Error('summarizer offline')));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const result = await h.send(h.envelope([imageTurn('p')]), 'p4');

    expect([mediaCount(result), h.compressionRuns()]).toStrictEqual([1, 1]);
  });

  it('surfaces the typed byte error when compression changes nothing and only non-image media remains', async () => {
    const h = harness(() => Promise.resolve(PerformCompressionResult.NOOP));
    seedDocuments(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.send(h.envelope([imageTurn('p')]), 'p3-docs'),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 1]);
  });

  it('surfaces the typed byte error when compression itself fails and only non-image media remains', async () => {
    const h = harness(() => Promise.reject(new Error('summarizer offline')));
    seedDocuments(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(
      h.send(h.envelope([imageTurn('p')]), 'p4-docs'),
    );

    expect([
      error instanceof RequestMediaByteOverflowError,
      h.compressionRuns(),
    ]).toStrictEqual([true, 1]);
  });

  it('does not relabel the byte overflow as a token projection failure', async () => {
    const h = harness(() => Promise.resolve(PerformCompressionResult.NOOP));
    seedDocuments(h.history);
    await h.history.waitForTokenUpdates();

    const error = await rejection(h.send(h.envelope([imageTurn('p')]), 'p5'));

    expect(error instanceof Error ? error.message : '').toContain(
      'selected request media has reached at least',
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

      const result = await h.send(h.envelope([imageTurn('p')]), 'body-1');

      expect([result.length, h.compressionRuns()]).toStrictEqual([2, 1]);
    });

    it('retires every historical image when compression changes nothing and the body stays over the cap (issue #4000)', async () => {
      const history = new HistoryService();
      const h = harness(
        () => Promise.resolve(PerformCompressionResult.NOOP),
        bodyEstimate(history),
      );
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.send(
        h.envelope([imageTurn('p')]),
        'body-2-images',
      );

      expect([mediaCount(result), h.compressionRuns()]).toStrictEqual([1, 1]);
    });

    it('surfaces the typed body error unlabelled when compression changes nothing and only non-image media remains', async () => {
      const history = new HistoryService();
      const h = harness(
        () => Promise.resolve(PerformCompressionResult.NOOP),
        bodyEstimate(history),
      );
      seedDocuments(h.history);
      await h.history.waitForTokenUpdates();

      const error = await rejection(
        h.send(h.envelope([imageTurn('p')]), 'body-2'),
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

    const error = await rejection(h.send(h.envelope([oversizedPending]), 'p6'));

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

    const error = await rejection(h.send(h.envelope([imageTurn('p')]), 'p7'));

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
      h.send(h.envelope([imageTurn('p')]), 'p-abort'),
    );

    expect([error, h.compressionRuns()]).toStrictEqual([aborted, 1]);
  });

  it('relieves the pre-compression request, not half-rewritten history, when compression fails midway (issue #4000)', async () => {
    const h = harness(async (history) => {
      await history.detachedValues.replace([textTurn('ai', 'partial summary')]);
      await history.waitForTokenUpdates();
      throw new Error('summarizer crashed after truncating history');
    });
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const result = await h.send(h.envelope([imageTurn('p')]), 'p-partial');

    const texts = result.flatMap((content) =>
      content.blocks.flatMap((block) =>
        block.type === 'text' ? [block.text] : [],
      ),
    );
    expect({
      media: mediaCount(result),
      keepsEarlierConversation: texts.includes('seen a'),
      usesPartialSummary: texts.includes('partial summary'),
    }).toStrictEqual({
      media: 1,
      keepsEarlierConversation: true,
      usesPartialSummary: false,
    });
  });

  it('does not compress when the request is aborted', async () => {
    const aborted = new DOMException('aborted', 'AbortError');
    const h = harness(summarizeHistory, () => Promise.reject(aborted));
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    await rejection(h.send(h.envelope([imageTurn('p')]), 'p8'));

    expect(h.compressionRuns()).toBe(0);
  });

  it('retires historical images without compressing when the pending boundary is unrecoverable (issue #4000)', async () => {
    const h = harness(summarizeHistory);
    seedImages(h.history);
    await h.history.waitForTokenUpdates();

    const result = await h.send(
      {
        contents: [...(await readCurated(h.history)), imageTurn('p')],
        pendingContents: undefined,
      },
      'p9',
    );

    expect([mediaCount(result), h.compressionRuns()]).toStrictEqual([1, 0]);
  });

  describe('with historical image retirement enabled', () => {
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
      const before = JSON.stringify(await readHistory(h.history));

      const result = await h.send(h.envelope([imageTurn('p')]), 'r1');

      expect({
        media: mediaCount(result),
        notes: noteCount(result),
        compressionRuns: h.compressionRuns(),
        canonicalUnchanged:
          JSON.stringify(await readHistory(h.history)) === before,
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
      const before = JSON.stringify(await readHistory(h.history));

      const error = await rejection(
        h.send(h.envelope([oversizedPending]), 'r2'),
      );

      expect({
        typed: error instanceof PendingMediaBudgetError,
        stillByteOverflow: error instanceof RequestMediaByteOverflowError,
        compressionRuns: h.compressionRuns(),
        canonicalUnchanged:
          JSON.stringify(await readHistory(h.history)) === before,
      }).toStrictEqual({
        typed: true,
        stillByteOverflow: true,
        compressionRuns: 0,
        canonicalUnchanged: true,
      });
    });

    it('stops futile compression when pending PDF media alone is over budget, even with earlier non-image media', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      h.history.add(pdfTurn('earlier', 300));
      h.history.add(textTurn('ai', 'read the first document'));
      await h.history.waitForTokenUpdates();
      const before = JSON.stringify(await readHistory(h.history));

      const error = await rejection(
        h.send(h.envelope([pdfTurn('pending', 1200)]), 'r5'),
      );

      expect({
        typed: error instanceof PendingMediaBudgetError,
        compressionRuns: h.compressionRuns(),
        canonicalUnchanged:
          JSON.stringify(await readHistory(h.history)) === before,
        message: error instanceof Error ? error.message : undefined,
      }).toStrictEqual({
        typed: true,
        compressionRuns: 0,
        canonicalUnchanged: true,
        message:
          'The media attached to this request totals 1200 encoded bytes, over the 1000 byte request media budget on its own. Send fewer or smaller attachments; the conversation history was left unchanged.',
      });
    });

    it('judges pending media against the budget the request was rejected under, not the configured one', async () => {
      const h = harness(summarizeHistory, undefined, 5 * BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const error = await rejection(
        h.send(h.envelope([pdfTurn('pending', 1200)]), 'r6'),
      );

      expect([
        error instanceof PendingMediaBudgetError,
        h.compressionRuns(),
      ]).toStrictEqual([true, 0]);
    });

    it('still gives earlier media one compression pass when pending media fits the rejecting budget', async () => {
      const h = harness(summarizeHistory, undefined, 5 * BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.send(h.envelope([pdfTurn('pending', 600)]), 'r7');

      expect([h.compressionRuns(), mediaCount(result)]).toStrictEqual([1, 1]);
    });

    it('protects only the newest content and retires older images when the pending boundary is undefined (issue #4000)', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.send(
        {
          contents: [...(await readCurated(h.history)), imageTurn('p')],
          pendingContents: undefined,
        },
        'r3',
      );

      expect({
        media: mediaCount(result),
        notes: noteCount(result),
        compressionRuns: h.compressionRuns(),
      }).toStrictEqual({ media: 1, notes: 2, compressionRuns: 0 });
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

      const result = await h.send(h.envelope([imageTurn('p')]), 'r4');

      expect({
        compressionRuns: h.compressionRuns(),
        remainingMedia: mediaCount(result),
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
          const kept = (await readCurated(target)).filter((content) =>
            content.blocks.some((b) => b.type === 'media'),
          );
          await target.clear();
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

      const result = await h.send(h.envelope([imageTurn('p')]), 'r5');

      expect({
        compressionRuns: h.compressionRuns(),
        media: mediaCount(result),
        notes: noteCount(result),
        canonicalImages: mediaCount(await readHistory(h.history)),
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

      const first = await h.send(h.envelope(pending), 'r6a');
      const second = await h.send(h.envelope(pending), 'r6b');

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
      const before = JSON.stringify([await readHistory(h.history), pending]);

      const error = await rejection(h.send(h.envelope(pending), 'r7'));

      expect({
        rejected: error instanceof Error,
        unchanged:
          JSON.stringify([await readHistory(h.history), pending]) === before,
      }).toStrictEqual({ rejected: true, unchanged: true });
    });

    it('re-applies retirement through the compression callback entry point', async () => {
      const h = harness(summarizeHistory, undefined, BYTE_BUDGET);
      seedImages(h.history);
      await h.history.waitForTokenUpdates();

      const result = await h.callback([imageTurn('p')], 'r8');

      expect({
        media: mediaCount(result),
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

      const result = await h.send(h.envelope([imageTurn('p')]), 'r9');

      expect({
        compressionRuns: h.compressionRuns(),
        notes: noteCount(result),
      }).toStrictEqual({ compressionRuns: 1, notes: 0 });
    });
  });
});
