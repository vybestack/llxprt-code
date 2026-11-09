/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round 3 (R6): a hook can split a declared pending
 * item and DUPLICATE its image into the later fragment. The later fragment
 * then accounts for the item's attachment on its own, and the identity search
 * would stop before the earlier fragment, leaving a current-turn image
 * retirable. After the item's attachments are placed, the protected region
 * keeps extending backwards over contiguous fragments that carry the item's
 * provenance (turn, prompt or id), and stops at the first content that does
 * not. Content with conflicting provenance is never pulled in, and equal text
 * is never evidence.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireEnvelopeImages } from '../historicalImageRetirement.js';

const BUDGET = 1000;
const IMAGE_LENGTH = 400;

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

function text(value: string): IContent['blocks'][number] {
  return { type: 'text', text: value };
}

function humanTurn(
  blocks: IContent['blocks'],
  metadata?: IContent['metadata'],
): IContent {
  return {
    speaker: 'human',
    ...(metadata === undefined ? {} : { metadata }),
    blocks,
  };
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

describe('a hook that duplicates a pending image into a later fragment (issue #4000 CodeRabbit round 3 R6)', () => {
  const declared = humanTurn([text('look at this'), image('a')], {
    turnId: 'turn-now',
  });

  it('keeps the earlier fragment image of the same turn', () => {
    const contents = [
      humanTurn([text('older'), image('o')], { turnId: 'turn-old' }),
      humanTurn([text('look at this'), image('a')], { turnId: 'turn-now' }),
      humanTurn([image('a')], { turnId: 'turn-now' }),
      humanTurn([text('hook note')]),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({ kept: imageData(result), notes: noteCount(result) }).toStrictEqual(
      { kept: [dataOf('a'), dataOf('a')], notes: 1 },
    );
  });

  it('keeps the earlier fragment when the boundary is unknown and the turn is carried', () => {
    const contents = [
      humanTurn([text('older'), image('o')], { turnId: 'turn-old' }),
      humanTurn([text('look at this'), image('a')], { turnId: 'turn-now' }),
      humanTurn([image('a')], { turnId: 'turn-now' }),
      humanTurn([text('hook note')]),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: undefined, protectedContents: [declared] },
      BUDGET,
    );

    expect({ kept: imageData(result), notes: noteCount(result) }).toStrictEqual(
      { kept: [dataOf('a'), dataOf('a')], notes: 1 },
    );
  });

  it('extends over fragments that share the item prompt id', () => {
    const byPrompt = humanTurn([text('look at this'), image('a')], {
      promptId: 'prompt-now',
    });
    const contents = [
      humanTurn([text('older'), image('o')], { promptId: 'prompt-old' }),
      humanTurn([text('look at this'), image('a')], { promptId: 'prompt-now' }),
      humanTurn([image('a')], { promptId: 'prompt-now' }),
      humanTurn([text('hook note')]),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [byPrompt] },
      BUDGET,
    );

    expect({ kept: imageData(result), notes: noteCount(result) }).toStrictEqual(
      { kept: [dataOf('a'), dataOf('a')], notes: 1 },
    );
  });

  it('does not pull in older history of a different turn', () => {
    const contents = [
      humanTurn([text('an older paste of a'), image('a')], {
        turnId: 'turn-old',
      }),
      humanTurn([text('look at this'), image('a')], { turnId: 'turn-now' }),
      humanTurn([image('a')], { turnId: 'turn-now' }),
      humanTurn([text('hook note')]),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
      olderKeptItsImage: result[0].blocks.some(
        (block) => block.type === 'media',
      ),
    }).toStrictEqual({
      kept: [dataOf('a'), dataOf('a')],
      notes: 1,
      olderKeptItsImage: false,
    });
  });

  it('stops at the first content without the item provenance', () => {
    const contents = [
      humanTurn([text('earlier fragment'), image('a')], { turnId: 'turn-now' }),
      humanTurn([text('unrelated note')]),
      humanTurn([text('look at this'), image('a')], { turnId: 'turn-now' }),
      humanTurn([image('a')], { turnId: 'turn-now' }),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      keptAfterTheNote: imageData(result.slice(2)),
      earlierFragmentKeptItsImage: result[0].blocks.some(
        (block) => block.type === 'media',
      ),
    }).toStrictEqual({
      keptAfterTheNote: [dataOf('a'), dataOf('a')],
      earlierFragmentKeptItsImage: false,
    });
  });
});
