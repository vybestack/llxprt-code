import { readHistory } from './retirement-source-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000: media pressure that comes from HISTORY must never end a turn.
 * A real session failed with RequestMediaByteOverflowError on curated history
 * holding about 26.9 MB of media (eight pasted screenshots of 2.96 to 3.32 MB
 * plus 22 small images) against the 15 MiB request media budget. These tests
 * replay that shape through the real LocalMediaStore, HistoryService,
 * ProviderContentEnforcer, production send seam and AnthropicProvider
 * projection; only HTTP is stubbed. Older images are replaced by retirement
 * notes in the REQUEST VIEW only.
 */

import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PerformCompressionResult } from '@vybestack/llxprt-code-core/core/turn.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { RequestMediaByteOverflowError } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { PendingMediaBudgetError } from '../pendingMediaBudgetError.js';
import {
  FIFTEEN_MIB,
  RetirementSession,
  aiTurn,
  collectImageData,
  collectText,
  countRetirementNotes,
  imageTurn,
  rejection,
  type AdmittedImage,
} from './image-retirement-harness.js';

/** Real-size cases write and re-read tens of MB; allow loaded CI machines. */
const REAL_SIZE_TIMEOUT_MS = 30_000;

/** Normalized base64 lengths of the eight pasted screenshots in the incident. */
const SCREENSHOT_BASE64 = [
  2_960_000, 3_050_000, 3_140_000, 3_320_000, 3_280_000, 3_200_000, 3_120_000,
  3_130_000,
];
const SMALL_IMAGE_BASE64 = 75_900;
const SMALL_IMAGE_COUNT = 22;
/** Screenshots per user message and small images read before each message. */
const MESSAGE_SHAPE = [
  { smallBefore: 7, screenshots: 1 },
  { smallBefore: 5, screenshots: 1 },
  { smallBefore: 5, screenshots: 2 },
  { smallBefore: 3, screenshots: 3 },
  { smallBefore: 2, screenshots: 1 },
];

interface Scale {
  /** Divides every incident size; 1 is the real incident. */
  readonly divisor: number;
  readonly smallBase64: number;
  readonly budget: number | undefined;
}

const REAL: Scale = {
  divisor: 1,
  smallBase64: SMALL_IMAGE_BASE64,
  budget: undefined,
};
/** The same shape at a tenth of every size and of the 15 MiB budget. */
const SCALED: Scale = {
  divisor: 10,
  smallBase64: 7_600,
  budget: Math.floor(FIFTEEN_MIB / 10),
};

function rawLengthFor(base64Length: number): number {
  return (base64Length / 4) * 3;
}

function budgetOf(scale: Scale): number {
  return scale.budget ?? FIFTEEN_MIB;
}

function multiImageTurn(
  images: readonly AdmittedImage[],
  label: string,
): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: `turn-${label}` },
    blocks: [
      { type: 'text', text: `screenshots ${label}` },
      ...images.map((image) => image.reference),
    ],
  };
}

function textTurn(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

describe('history media pressure never ends a turn (issue #4000)', () => {
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

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'llxprt-issue4000-'));
    session = new RetirementSession(directory, undefined);
    nextFill = 1;
  });
  afterEach(async () => {
    session.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  async function admitBase64(base64Length: number): Promise<AdmittedImage> {
    const fill = nextFill;
    nextFill += 1;
    return session.admit(rawLengthFor(base64Length), fill);
  }

  /** The uqm history shape; returns every admitted image in wire order. */
  async function seedUqmHistory(scale: Scale): Promise<AdmittedImage[]> {
    const admitted: AdmittedImage[] = [];
    let screenshotIndex = 0;
    for (const [messageIndex, shape] of MESSAGE_SHAPE.entries()) {
      for (let small = 0; small < shape.smallBefore; small += 1) {
        const image = await admitBase64(scale.smallBase64);
        admitted.push(image);
        session.history.add(
          imageTurn(image.reference, `read-${messageIndex}-${small}`),
        );
        session.history.add(aiTurn(`looked at read ${messageIndex}-${small}`));
      }
      const shots: AdmittedImage[] = [];
      for (let shot = 0; shot < shape.screenshots; shot += 1) {
        const size = SCREENSHOT_BASE64[screenshotIndex] / scale.divisor;
        screenshotIndex += 1;
        shots.push(await admitBase64(size));
      }
      admitted.push(...shots);
      session.history.add(multiImageTurn(shots, `paste-${messageIndex}`));
      session.history.add(aiTurn(`described screenshots ${messageIndex}`));
    }
    return admitted;
  }

  function sentSummary(
    wireOrder: readonly AdmittedImage[],
    budget: number,
  ): Record<string, unknown> {
    const body = session.lastBody();
    const sentImages = collectImageData(body, []);
    const retired = wireOrder.length - sentImages.length;
    return {
      requests: session.sent.length,
      retiredAtLeastOne: retired > 0,
      sentIsNewestSuffix:
        JSON.stringify(sentImages) ===
        JSON.stringify(wireOrder.slice(retired).map((image) => image.base64)),
      oneNotePerRetiredImage: countRetirementNotes(body) === retired,
      withinBudget:
        sentImages.reduce((sum, data) => sum + data.length, 0) <= budget,
    };
  }

  const SENT_WITH_NEWEST_KEPT = {
    requests: 1,
    retiredAtLeastOne: true,
    sentIsNewestSuffix: true,
    oneNotePerRetiredImage: true,
    withinBudget: true,
  };

  async function expectCanonicalUntouched(
    before: string,
    oldest: AdmittedImage,
  ): Promise<void> {
    const original = await session.store.readVerified(oldest.reference);
    expect({
      history: JSON.stringify(await readHistory(session.history)) === before,
      originalReadable: Buffer.from(original).equals(Buffer.from(oldest.bytes)),
      activeRequests: session.resolver.accounting().activeRequestCount,
      reserved: await session.store.hasReservations(oldest.reference.contentId),
    }).toStrictEqual({
      history: true,
      originalReadable: true,
      activeRequests: 0,
      reserved: false,
    });
  }

  describe('incident replay at the real 15 MiB budget', () => {
    it('totals about 26.9 MB of history media across 30 images, over the budget', async () => {
      const images = await seedUqmHistory(REAL);

      const total = images.reduce(
        (sum, image) => sum + image.reference.normalizedBase64Length,
        0,
      );

      expect({ count: images.length, over: total > FIFTEEN_MIB }).toStrictEqual(
        { count: 8 + SMALL_IMAGE_COUNT, over: true },
      );
      expect(total).toBe(
        SCREENSHOT_BASE64.reduce((sum, size) => sum + size, 0) +
          SMALL_IMAGE_COUNT * SMALL_IMAGE_BASE64,
      );
    });

    it(
      'sends a text-only turn with older images retired and the newest kept',
      async () => {
        const images = await seedUqmHistory(REAL);
        const before = JSON.stringify(await readHistory(session.history));

        await session.send([textTurn('what did the last screenshots show?')]);

        expect(sentSummary(images, FIFTEEN_MIB)).toStrictEqual(
          SENT_WITH_NEWEST_KEPT,
        );
        expect(session.compressionRuns).toBe(0);
        await expectCanonicalUntouched(before, images[0]);
      },
      REAL_SIZE_TIMEOUT_MS,
    );

    it(
      'sends a turn that pastes a 3 MB screenshot and keeps that screenshot intact',
      async () => {
        const images = await seedUqmHistory(REAL);
        const pasted = await admitBase64(3_000_000);
        const before = JSON.stringify(await readHistory(session.history));

        await session.send([imageTurn(pasted.reference, 'pasted-now')]);

        const wire = [...images, pasted];
        expect(sentSummary(wire, FIFTEEN_MIB)).toStrictEqual(
          SENT_WITH_NEWEST_KEPT,
        );
        const sentImages = collectImageData(session.lastBody(), []);
        expect(sentImages[sentImages.length - 1]).toBe(pasted.base64);
        await expectCanonicalUntouched(before, images[0]);
      },
      REAL_SIZE_TIMEOUT_MS,
    );

    it(
      'sends the same history when the pending boundary is unrecoverable',
      async () => {
        const images = await seedUqmHistory(REAL);
        const before = JSON.stringify(await readHistory(session.history));

        await session.send(
          [textTurn('what did the last screenshots show?')],
          true,
          {
            pending: undefined,
          },
        );

        expect(sentSummary(images, FIFTEEN_MIB)).toStrictEqual(
          SENT_WITH_NEWEST_KEPT,
        );
        await expectCanonicalUntouched(before, images[0]);
      },
      REAL_SIZE_TIMEOUT_MS,
    );
  });

  describe('when the pending boundary cannot be trusted', () => {
    beforeEach(async () => {
      await startSession(SCALED.budget);
    });

    it('retires older images and keeps the last content when the boundary is undefined', async () => {
      const images = await seedUqmHistory(SCALED);
      const before = JSON.stringify(await readHistory(session.history));

      await session.send([textTurn('final question')], true, {
        pending: undefined,
      });

      expect(sentSummary(images, budgetOf(SCALED))).toStrictEqual(
        SENT_WITH_NEWEST_KEPT,
      );
      const texts = collectText(session.lastBody(), []);
      expect(texts[texts.length - 1]).toBe('final question');
      await expectCanonicalUntouched(before, images[0]);
    });

    it('keeps a pasted screenshot that is the last content when the boundary is undefined', async () => {
      const images = await seedUqmHistory(SCALED);
      const pasted = await admitBase64(300_000);

      await session.send([imageTurn(pasted.reference, 'pasted-now')], true, {
        pending: undefined,
      });

      expect(sentSummary([...images, pasted], budgetOf(SCALED))).toStrictEqual(
        SENT_WITH_NEWEST_KEPT,
      );
      const sentImages = collectImageData(session.lastBody(), []);
      expect(sentImages[sentImages.length - 1]).toBe(pasted.base64);
    });

    it('retires older images when the tail differs from the declared pending blocks', async () => {
      const images = await seedUqmHistory(SCALED);
      const before = JSON.stringify(await readHistory(session.history));

      await session.send([textTurn('rewritten by a hook')], true, {
        pending: [textTurn('what the user typed')],
      });

      expect(sentSummary(images, budgetOf(SCALED))).toStrictEqual(
        SENT_WITH_NEWEST_KEPT,
      );
      const texts = collectText(session.lastBody(), []);
      expect(texts[texts.length - 1]).toBe('rewritten by a hook');
      await expectCanonicalUntouched(before, images[0]);
    });

    it('keeps the declared pending screenshot when a hook appended an item after it', async () => {
      const images = await seedUqmHistory(SCALED);
      const pasted = await admitBase64(300_000);
      const shot = imageTurn(pasted.reference, 'pasted-now');

      await session.send([shot, textTurn('hook note')], true, {
        pending: [shot],
      });

      expect(sentSummary([...images, pasted], budgetOf(SCALED))).toStrictEqual(
        SENT_WITH_NEWEST_KEPT,
      );
      expect(collectImageData(session.lastBody(), [])).toContain(pasted.base64);
    });
  });

  describe('when the one compression pass cannot relieve the request', () => {
    /**
     * The resolver rejects at the scaled budget while retirement is configured
     * far above it, so the first projection overflows however the boundary is
     * proven. This isolates the compression-recovery exits from retirement.
     */
    beforeEach(async () => {
      await startSession(SCALED.budget, 1_000_000_000);
    });

    async function sendAfterRecovery(): Promise<{
      images: AdmittedImage[];
      before: string;
    }> {
      const images = await seedUqmHistory(SCALED);
      const before = JSON.stringify(await readHistory(session.history));
      await session.send([textTurn('final question')]);
      return { images, before };
    }

    function everyHistoricalImageRetired(images: AdmittedImage[]): unknown {
      const body = session.lastBody();
      return {
        requests: session.sent.length,
        sentImages: collectImageData(body, []).length,
        notes: countRetirementNotes(body),
        expectedNotes: images.length,
      };
    }

    it('is sent with every historical image retired when compression fails', async () => {
      session.useCompression(() =>
        Promise.reject(new Error('summarizer offline')),
      );

      const { images, before } = await sendAfterRecovery();

      expect(everyHistoricalImageRetired(images)).toStrictEqual({
        requests: 1,
        sentImages: 0,
        notes: images.length,
        expectedNotes: images.length,
      });
      expect(session.compressionRuns).toBe(1);
      await expectCanonicalUntouched(before, images[0]);
    });

    it('is sent with every historical image retired when compression is skipped by cooldown', async () => {
      session.useCompressionOutcome(PerformCompressionResult.SKIPPED_COOLDOWN);

      const { images, before } = await sendAfterRecovery();

      expect(everyHistoricalImageRetired(images)).toStrictEqual({
        requests: 1,
        sentImages: 0,
        notes: images.length,
        expectedNotes: images.length,
      });
      await expectCanonicalUntouched(before, images[0]);
    });

    it('is sent with every historical image retired when one compression pass leaves it over budget', async () => {
      session.useCompression(() => Promise.resolve());

      const { images, before } = await sendAfterRecovery();

      expect(everyHistoricalImageRetired(images)).toStrictEqual({
        requests: 1,
        sentImages: 0,
        notes: images.length,
        expectedNotes: images.length,
      });
      expect(session.compressionRuns).toBe(1);
      await expectCanonicalUntouched(before, images[0]);
    });

    it('keeps the pending screenshot while retiring every historical image', async () => {
      session.useCompressionOutcome(PerformCompressionResult.SKIPPED_COOLDOWN);
      const images = await seedUqmHistory(SCALED);
      const pasted = await admitBase64(300_000);

      await session.send([imageTurn(pasted.reference, 'pasted-now')]);

      const body = session.lastBody();
      expect({
        sentImages: collectImageData(body, []),
        notes: countRetirementNotes(body),
      }).toStrictEqual({
        sentImages: [pasted.base64],
        notes: images.length,
      });
    });
  });

  describe('when the request body cap is the pressure', () => {
    it(
      'retires every historical image after a failed compression instead of ending the turn',
      async () => {
        // A 100 MiB media budget leaves retirement idle, so the 32,000,000 byte
        // native Anthropic request body cap is what the real projection hits.
        await startSession(100 * 1024 * 1024);
        const admitted: AdmittedImage[] = [];
        for (let index = 0; index < 3; index += 1) {
          const image = await admitBase64(11_200_000);
          admitted.push(image);
          session.history.add(imageTurn(image.reference, `big-${index}`));
          session.history.add(aiTurn(`seen big ${index}`));
        }
        session.useCompression(() =>
          Promise.reject(new Error('summarizer offline')),
        );
        const before = JSON.stringify(await readHistory(session.history));

        await session.send([textTurn('carry on')]);

        const body = session.lastBody();
        expect({
          requests: session.sent.length,
          sentImages: collectImageData(body, []).length,
          notes: countRetirementNotes(body),
        }).toStrictEqual({ requests: 1, sentImages: 0, notes: 3 });
        await expectCanonicalUntouched(before, admitted[0]);
      },
      REAL_SIZE_TIMEOUT_MS,
    );
  });

  describe('regression guards', () => {
    it('still reports a pending region that alone exceeds the budget, leaving history unchanged', async () => {
      await startSession(SCALED.budget);
      const images = await seedUqmHistory(SCALED);
      const oversized = await admitBase64(2_000_000);
      const before = JSON.stringify(await readHistory(session.history));

      const error = await rejection(
        session.send([imageTurn(oversized.reference, 'too-big')]),
      );

      expect({
        pending: error instanceof PendingMediaBudgetError,
        sent: session.sent.length,
        compressionRuns: session.compressionRuns,
      }).toStrictEqual({ pending: true, sent: 0, compressionRuns: 0 });
      await expectCanonicalUntouched(before, images[0]);
    });

    it('still reports a protected last content that alone exceeds the budget when the boundary is unrecoverable', async () => {
      await startSession(SCALED.budget);
      const images = await seedUqmHistory(SCALED);
      const oversized = await admitBase64(2_000_000);
      const before = JSON.stringify(await readHistory(session.history));

      const error = await rejection(
        session.send([imageTurn(oversized.reference, 'too-big')], true, {
          pending: undefined,
        }),
      );

      expect({
        pending: error instanceof PendingMediaBudgetError,
        sent: session.sent.length,
      }).toStrictEqual({ pending: true, sent: 0 });
      await expectCanonicalUntouched(before, images[0]);
    });

    it('still rejects encoded media for a zero budget instead of retiring it', async () => {
      await startSession(0);
      const images = await seedUqmHistory(SCALED);
      const before = JSON.stringify(await readHistory(session.history));

      const error = await rejection(session.send([textTurn('final question')]));

      expect({
        byteOverflow: error instanceof RequestMediaByteOverflowError,
        pending: error instanceof PendingMediaBudgetError,
        sent: session.sent.length,
      }).toStrictEqual({ byteOverflow: true, pending: false, sent: 0 });
      await expectCanonicalUntouched(before, images[0]);
    });
  });
});
