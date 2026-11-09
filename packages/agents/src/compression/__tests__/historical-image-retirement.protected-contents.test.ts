/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T3): when a BeforeModel hook restructures the
 * request and the compression boundary is unrecoverable, the caller still
 * holds the user's original pending items. They travel as `protectedContents`
 * so fragments of the user's own turn stay protected from image retirement,
 * while `pendingContents` stays undefined and compression stays unavailable.
 * Real LocalMediaStore, HistoryService, ProviderContentEnforcer, production
 * send seam and AnthropicProvider projection; only HTTP is stubbed.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireEnvelopeImages } from '../historicalImageRetirement.js';
import {
  collectImageData,
  countRetirementNotes,
  rejection,
  type AdmittedImage,
} from './image-retirement-harness.js';
import { useReliefConversation } from './media-relief-fixtures.js';

const BUDGET = 1000;
const IMAGE_LENGTH = 400;
/** Raw bytes of a 400,000 character base64 image, as the shared fixtures use. */
const SESSION_IMAGE_BYTES = (400_000 / 4) * 3;

function dataOf(label: string): string {
  return label.repeat(IMAGE_LENGTH).slice(0, IMAGE_LENGTH);
}

function image(label: string): IContent['blocks'][number] {
  return {
    type: 'media',
    encoding: 'base64',
    mimeType: 'image/png',
    data: dataOf(label),
    semanticMetadata: {},
  };
}

function humanTurn(blocks: IContent['blocks'], turnId?: string): IContent {
  return {
    speaker: 'human',
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
    blocks,
  };
}

function text(value: string): IContent['blocks'][number] {
  return { type: 'text', text: value };
}

function imageData(contents: readonly IContent[]): string[] {
  return contents.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' && block.encoding === 'base64' ? [block.data] : [],
    ),
  );
}

describe('the user turn survives an unrecoverable hook boundary (issue #4000 CodeRabbit T3)', () => {
  const declared = humanTurn(
    [text('look at both'), image('a'), image('b')],
    'turn-now',
  );

  describe('retireEnvelopeImages', () => {
    const fragments = [
      humanTurn([text('older'), image('o')], 'turn-old'),
      humanTurn([text('look at both'), image('a')], 'turn-now'),
      humanTurn([image('b')], 'turn-now'),
      humanTurn([text('hook note')]),
    ];

    it('keeps both fragments of the split turn and retires only the older image', () => {
      const result = retireEnvelopeImages(
        {
          contents: fragments,
          pendingContents: undefined,
          protectedContents: [declared],
        },
        BUDGET,
      );

      expect(imageData(result)).toStrictEqual([dataOf('a'), dataOf('b')]);
    });

    it('retires the first fragment when no original turn is carried', () => {
      const result = retireEnvelopeImages(
        { contents: fragments, pendingContents: undefined },
        BUDGET,
      );

      expect(imageData(result)).toStrictEqual([dataOf('b')]);
    });

    it('does not protect an unrelated history image the carried turn does not name', () => {
      const result = retireEnvelopeImages(
        {
          contents: fragments,
          pendingContents: undefined,
          protectedContents: [humanTurn([text('other'), image('z')], 'turn-z')],
        },
        BUDGET,
      );

      expect(imageData(result)).toStrictEqual([dataOf('b')]);
    });
  });

  describe('production send seam', () => {
    const conversation = useReliefConversation('llxprt-issue4000-cr-t3-');

    async function splitTurn(): Promise<{
      original: IContent;
      fragments: IContent[];
      images: AdmittedImage[];
    }> {
      const session = conversation.session();
      const images = [
        await session.admit(SESSION_IMAGE_BYTES, 101),
        await session.admit(SESSION_IMAGE_BYTES, 102),
      ];
      const original = humanTurn(
        [text('look at both'), images[0].reference, images[1].reference],
        'turn-now',
      );
      const fragments = [
        humanTurn([text('look at both'), images[0].reference], 'turn-now'),
        humanTurn([images[1].reference], 'turn-now'),
        humanTurn([text('hook note')]),
      ];
      return { original, fragments, images };
    }

    it('sends both pending images and retires only the older history image', async () => {
      const session = conversation.session();
      const [history] = await conversation.seedImages(1);
      const { original, fragments, images } = await splitTurn();
      const contents = [...session.history.getCurated(), ...fragments];

      await session.send([original], true, {
        pending: undefined,
        protectedContents: [original],
        contents,
      });

      const body = session.lastBody();
      expect({
        sentImages: collectImageData(body, []),
        notes: countRetirementNotes(body),
      }).toStrictEqual({
        sentImages: images.map((sent) => sent.base64),
        notes: 1,
      });
      expect(images.map((sent) => sent.base64)).not.toContain(history.base64);
    });

    it('still cannot compress, because the compression boundary stays unknown', async () => {
      const session = conversation.session();
      await conversation.seedImages(1);
      conversation.seedBigText();
      const { original, fragments } = await splitTurn();
      const contents = [...session.history.getCurated(), ...fragments];

      const error = await rejection(
        session.send([original], true, {
          pending: undefined,
          protectedContents: [original],
          contents,
        }),
      );

      expect({
        unrecoverableBoundary:
          error instanceof Error &&
          error.message.includes('pending-content boundary is unrecoverable'),
        compressionRuns: session.compressionRuns,
        sent: session.sent.length,
      }).toStrictEqual({
        unrecoverableBoundary: true,
        compressionRuns: 0,
        sent: 0,
      });
    });
  });
});
