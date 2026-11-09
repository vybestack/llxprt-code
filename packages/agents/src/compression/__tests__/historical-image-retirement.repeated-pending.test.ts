/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 2 (D): a declared pending item can carry the
 * same image more than once (the user pastes one screenshot twice). When a
 * hook splits that item into fragments, every occurrence is current-turn
 * media, so the protected region reaches back to the fragment holding the
 * first occurrence. Occurrences are counted: an older history copy of the
 * image beyond that count is still ordinary history.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireEnvelopeImages } from '../historicalImageRetirement.js';
import {
  collectImageData,
  countRetirementNotes,
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

function noteCount(contents: readonly IContent[]): number {
  return contents.flatMap((content) =>
    content.blocks.filter(
      (block) =>
        block.type === 'text' &&
        block.text.includes('was omitted from this request'),
    ),
  ).length;
}

describe('a declared pending item that repeats one image (issue #4000 CodeRabbit round 2 D)', () => {
  const declared = humanTurn(
    [text('compare these'), image('a'), image('a')],
    'turn-now',
  );

  describe('retireEnvelopeImages', () => {
    it('keeps both copies when a hook split the item into two fragments', () => {
      const contents = [
        humanTurn([text('older'), image('o')], 'turn-old'),
        humanTurn([text('compare these'), image('a')], 'turn-now'),
        humanTurn([image('a')], 'turn-now'),
        humanTurn([text('hook note')]),
      ];

      const result = retireEnvelopeImages(
        { contents, pendingContents: [declared] },
        BUDGET,
      );

      expect({
        kept: imageData(result),
        notes: noteCount(result),
      }).toStrictEqual({ kept: [dataOf('a'), dataOf('a')], notes: 1 });
    });

    it('keeps both copies when the boundary is unknown and the turn is carried', () => {
      const contents = [
        humanTurn([text('older'), image('o')], 'turn-old'),
        humanTurn([text('compare these'), image('a')], 'turn-now'),
        humanTurn([image('a')], 'turn-now'),
        humanTurn([text('hook note')]),
      ];

      const result = retireEnvelopeImages(
        {
          contents,
          pendingContents: undefined,
          protectedContents: [declared],
        },
        BUDGET,
      );

      expect({
        kept: imageData(result),
        notes: noteCount(result),
      }).toStrictEqual({ kept: [dataOf('a'), dataOf('a')], notes: 1 });
    });

    it('does not protect an older history copy of the image beyond the occurrence count', () => {
      const contents = [
        humanTurn([text('older paste of a'), image('a')]),
        humanTurn([text('compare these'), image('a')], 'turn-now'),
        humanTurn([image('a')], 'turn-now'),
      ];

      const result = retireEnvelopeImages(
        { contents, pendingContents: [declared] },
        BUDGET,
      );

      expect({
        kept: imageData(result),
        notes: noteCount(result),
        olderCopyIsFirst: result[0].blocks.some(
          (block) => block.type === 'media',
        ),
      }).toStrictEqual({
        kept: [dataOf('a'), dataOf('a')],
        notes: 1,
        olderCopyIsFirst: false,
      });
    });

    it('keeps both copies when one content carries both', () => {
      const contents = [
        humanTurn([text('older'), image('o')], 'turn-old'),
        humanTurn([text('compare these'), image('a'), image('a')], 'turn-now'),
        humanTurn([text('hook note')]),
      ];

      const result = retireEnvelopeImages(
        { contents, pendingContents: [declared] },
        BUDGET,
      );

      expect({
        kept: imageData(result),
        notes: noteCount(result),
      }).toStrictEqual({ kept: [dataOf('a'), dataOf('a')], notes: 1 });
    });
  });

  describe('production send seam', () => {
    const conversation = useReliefConversation('llxprt-issue4000-cr2-d-');

    it('sends the same stored image twice and retires only the older history image', async () => {
      const session = conversation.session();
      const [history] = await conversation.seedImages(1);
      const shared = await session.admit(SESSION_IMAGE_BYTES, 201);
      const original = humanTurn(
        [text('compare these'), shared.reference, shared.reference],
        'turn-now',
      );
      const fragments = [
        humanTurn([text('compare these'), shared.reference], 'turn-now'),
        humanTurn([shared.reference], 'turn-now'),
        humanTurn([text('hook note')]),
      ];
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
        sentImages: [shared.base64, shared.base64],
        notes: 1,
      });
      expect(shared.base64).not.toBe(history.base64);
    });
  });
});
