/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 2: history media relief is bounded but never skips
 * the other limits. After relief the request is still held to the context
 * window, a failed compression never lets half-rewritten history be sent, the
 * pending boundary used to classify an overflow is the one retirement uses,
 * and the provider compression callback shares the same relief. Real
 * LocalMediaStore, HistoryService, ProviderContentEnforcer, production send
 * seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { ContextOverflowError } from '../contextOverflowError.js';
import { PendingMediaBudgetError } from '../pendingMediaBudgetError.js';
import {
  RetirementSession,
  aiTurn,
  collectImageData,
  collectText,
  countRetirementNotes,
  imageTurn,
  rejection,
  type AdmittedImage,
} from './image-retirement-harness.js';

const BUDGET = 1_000_000;
/** Retirement budget far above the provider's: only the provider rejects. */
const IDLE_RETIREMENT = 1_000_000_000;
/** Normalized base64 length of every image in these cases. */
const IMAGE_BASE64 = 400_000;
const IMAGE_BYTES = (IMAGE_BASE64 / 4) * 3;
/** About 21,000 estimated tokens of text, over this window by itself. */
const TIGHT_CONTEXT = 20_000;
const BIG_TEXT = 'word '.repeat(20_000);
const REAL_SIZE_TIMEOUT_MS = 30_000;

function textTurn(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function mediaBlocks(contents: readonly IContent[]): number {
  return contents.flatMap((content) =>
    content.blocks.filter((block) => block.type === 'media'),
  ).length;
}

function noteBlocks(contents: readonly IContent[]): number {
  return contents.flatMap((content) =>
    content.blocks.filter(
      (block) =>
        block.type === 'text' &&
        block.text.includes('was omitted from this request'),
    ),
  ).length;
}

describe('history media relief keeps the other limits (issue #4000 review round 2)', () => {
  let directory = '';
  let session: RetirementSession;
  let nextFill = 1;

  async function startSession(
    budget: number | undefined,
    enforcerBudget: number | undefined = budget,
  ): Promise<void> {
    session.dispose();
    session = new RetirementSession(
      directory,
      budget,
      512 * 1024 * 1024,
      enforcerBudget,
    );
  }

  async function admitImage(bytes = IMAGE_BYTES): Promise<AdmittedImage> {
    const fill = nextFill;
    nextFill += 1;
    return session.admit(bytes, fill);
  }

  /** Image turns separated by answers, in wire order; returns the images. */
  async function seedImages(count: number): Promise<AdmittedImage[]> {
    const images: AdmittedImage[] = [];
    for (let index = 0; index < count; index += 1) {
      const image = await admitImage();
      images.push(image);
      session.history.add(imageTurn(image.reference, `hist-${index}`));
      session.history.add(aiTurn(`seen ${index}`));
    }
    return images;
  }

  function seedBigText(): void {
    session.history.add(textTurn(BIG_TEXT));
    session.history.add(aiTurn('noted the long text'));
  }

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-issue4000-r2-'));
    session = new RetirementSession(directory, undefined);
    nextFill = 1;
  });
  afterEach(async () => {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  describe('finding 1: token limits after media relief', () => {
    beforeEach(async () => {
      await startSession(BUDGET, IDLE_RETIREMENT);
      session.contextLimit = TIGHT_CONTEXT;
    });

    it('fails with the context error instead of sending a request over the window', async () => {
      await seedImages(3);
      seedBigText();
      session.useCompressionOutcome(PerformCompressionResult.SKIPPED_COOLDOWN);

      const error = await rejection(session.send([textTurn('next question')]));

      expect({
        contextOverflow: error instanceof ContextOverflowError,
        sent: session.sent.length,
      }).toStrictEqual({ contextOverflow: true, sent: 0 });
    });

    it('reduces the relieved request under the window and never brings retired pixels back', async () => {
      const images = await seedImages(3);
      seedBigText();
      let runs = 0;
      session.useCompression(async (history) => {
        runs += 1;
        if (runs === 1) throw new Error('summarizer offline on the byte pass');
        history.clear();
        history.add(aiTurn('short summary of the earlier conversation'));
        images.forEach((image, index) =>
          history.add(imageTurn(image.reference, `kept-${index}`)),
        );
        await history.waitForTokenUpdates();
      });

      await session.send([textTurn('next question')]);

      const body = session.lastBody();
      expect({
        requests: session.sent.length,
        compressionRuns: session.compressionRuns,
        sentImages: collectImageData(body, []).length,
        notes: countRetirementNotes(body),
        summarySent: collectText(body, []).join('\n'),
      }).toMatchObject({
        requests: 1,
        compressionRuns: 2,
        sentImages: 0,
        notes: 3,
        summarySent: expect.stringContaining('short summary'),
      });
    });

    it('throws the unrecoverable-boundary error when the boundary is unknown and the relieved request is over the window', async () => {
      await seedImages(3);
      seedBigText();

      const error = await rejection(
        session.send([textTurn('next question')], true, { pending: undefined }),
      );

      expect({
        message: error instanceof Error ? error.message : '',
        sent: session.sent.length,
      }).toMatchObject({
        message: expect.stringContaining('boundary is unrecoverable'),
        sent: 0,
      });
    });

    it('sends the relieved request when it fits the window', async () => {
      session.contextLimit = 1_000_000;
      await seedImages(3);

      await session.send([textTurn('next question')]);

      expect({
        requests: session.sent.length,
        sentImages: collectImageData(session.lastBody(), []).length,
      }).toStrictEqual({ requests: 1, sentImages: 0 });
    });
  });

  describe('finding 3: a failed compression never leaks half-rewritten history', () => {
    it('sends the original conversation, relieved, when compression crashes after replacing history with oversized images', async () => {
      await startSession(BUDGET, IDLE_RETIREMENT);
      await seedImages(3);
      const replacements = [
        await admitImage(),
        await admitImage(),
        await admitImage(),
      ];
      session.useCompression(async (history) => {
        history.clear();
        history.add(aiTurn('PARTIAL SUMMARY'));
        replacements.forEach((image, index) =>
          history.add(imageTurn(image.reference, `replacement-${index}`)),
        );
        await history.waitForTokenUpdates();
        throw new Error('summarizer crashed after rewriting history');
      });

      await session.send([textTurn('carry on')]);

      const body = session.lastBody();
      const text = collectText(body, []).join('\n');
      expect({
        requests: session.sent.length,
        sentImages: collectImageData(body, []).length,
        notes: countRetirementNotes(body),
        partialSummary: text.includes('PARTIAL SUMMARY'),
        originalConversation: ['seen 0', 'seen 1', 'seen 2', 'carry on'].map(
          (expected) => text.includes(expected),
        ),
      }).toStrictEqual({
        requests: 1,
        sentImages: 0,
        notes: 3,
        partialSummary: false,
        originalConversation: [true, true, true, true],
      });
    });
  });

  describe('finding 5: classification uses the retirement boundary', () => {
    it('relieves a request whose declared pending count would have swallowed historical images', async () => {
      await startSession(500_000, IDLE_RETIREMENT);
      const images = await seedImages(3);
      session.useCompressionOutcome(PerformCompressionResult.SKIPPED_COOLDOWN);
      const before = JSON.stringify(session.history.getAll());
      const declared = ['a', 'b', 'c', 'd', 'e'].map((label) =>
        textTurn(`declared ${label}`),
      );

      await session.send([textTurn('merged by a hook')], true, {
        pending: declared,
      });

      const body = session.lastBody();
      expect({
        requests: session.sent.length,
        sentImages: collectImageData(body, []).length,
        notes: countRetirementNotes(body),
        canonicalUnchanged: JSON.stringify(session.history.getAll()) === before,
      }).toStrictEqual({
        requests: 1,
        sentImages: 0,
        notes: images.length,
        canonicalUnchanged: true,
      });
    });

    it('still reports a protected pending image that alone exceeds the rejecting budget', async () => {
      await startSession(500_000, IDLE_RETIREMENT);
      await seedImages(2);
      const oversized = await admitImage(IMAGE_BYTES * 2);

      const error = await rejection(
        session.send([imageTurn(oversized.reference, 'too-big')]),
      );

      expect({
        pending: error instanceof PendingMediaBudgetError,
        sent: session.sent.length,
      }).toStrictEqual({ pending: true, sent: 0 });
    });
  });

  describe('finding 2: a rewritten pending item does not drag history into the protected region', () => {
    it('sends the request instead of reporting a false pending-media overflow', async () => {
      await startSession(BUDGET);
      const images = await seedImages(1);
      session.history.add(textTurn('continue'));
      session.history.add(aiTurn('continuing'));
      for (let index = 0; index < 2; index += 1) {
        const image = await admitImage();
        images.push(image);
        session.history.add(imageTurn(image.reference, `later-${index}`));
        session.history.add(aiTurn(`seen later ${index}`));
      }
      const pasted = await admitImage();
      const original = {
        ...textTurn('continue'),
        metadata: { turnId: 'turn-now' },
      };
      const rewritten = {
        ...textTurn('continue, rewritten by a hook'),
        metadata: { turnId: 'turn-now' },
      };
      const shot = imageTurn(pasted.reference, 'pasted-now');

      await session.send([rewritten, shot], true, {
        pending: [original, shot],
      });

      const sentImages = collectImageData(session.lastBody(), []);
      expect({
        requests: session.sent.length,
        newestKept: sentImages[sentImages.length - 1],
        withinBudget:
          sentImages.reduce((sum, data) => sum + data.length, 0) <= BUDGET,
      }).toStrictEqual({
        requests: 1,
        newestKept: pasted.base64,
        withinBudget: true,
      });
    });
  });

  describe('finding 6: the provider compression callback shares the relief', () => {
    it(
      'returns contents with every historical image retired when only the 32,000,000 byte body cap is the pressure',
      async () => {
        // A 100 MiB media allowance leaves retirement idle, so the native
        // Anthropic body cap is what the real projection rejects.
        await startSession(100 * 1024 * 1024);
        for (let index = 0; index < 3; index += 1) {
          const image = await admitImage((11_200_000 / 4) * 3);
          session.history.add(imageTurn(image.reference, `big-${index}`));
          session.history.add(aiTurn(`seen big ${index}`));
        }
        session.useCompression(() =>
          Promise.reject(new Error('summarizer offline')),
        );

        const contents = await session.recomposeViaCallback([
          textTurn('carry on'),
        ]);

        expect({
          media: mediaBlocks(contents),
          notes: noteBlocks(contents),
          lastIsPending:
            contents[contents.length - 1].blocks[0].type === 'text',
        }).toStrictEqual({ media: 0, notes: 3, lastIsPending: true });
      },
      REAL_SIZE_TIMEOUT_MS,
    );

    it('returns a relieved request that still honors the window the callback was given', async () => {
      await startSession(BUDGET, IDLE_RETIREMENT);
      session.contextLimit = TIGHT_CONTEXT;
      await seedImages(3);
      seedBigText();
      session.useCompressionOutcome(PerformCompressionResult.SKIPPED_COOLDOWN);

      const error = await rejection(
        session.recomposeViaCallback([textTurn('next question')]),
      );

      expect(error instanceof ContextOverflowError).toBe(true);
    });
  });
});
