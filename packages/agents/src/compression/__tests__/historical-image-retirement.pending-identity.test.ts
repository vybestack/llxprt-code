/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 2: the protected pending region is located by the
 * stable identity of the declared pending items (metadata id, turn id, prompt
 * id, media identity), never by equal text found somewhere in history. The
 * request view of retirement also never offers a stored Responses parent that
 * the rewrite made stale, wherever that parent sits in the request.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import {
  retireEnvelopeImages,
  retireEveryHistoricalImage,
} from '../historicalImageRetirement.js';

const BUDGET = 1000;
const IMAGE_LENGTH = 400;

function dataOf(label: string): string {
  return label.repeat(IMAGE_LENGTH).slice(0, IMAGE_LENGTH);
}

function imageTurn(
  label: string,
  caption: string,
  turnId?: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
    blocks: [
      { type: 'text', text: caption },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: dataOf(label),
        semanticMetadata: {},
      },
    ],
  };
}

function textTurn(
  text: string,
  turnId?: string,
  speaker: IContent['speaker'] = 'human',
): IContent {
  return {
    speaker,
    ...(turnId === undefined ? {} : { metadata: { turnId } }),
    blocks: [{ type: 'text', text }],
  };
}

function storedAiTurn(text: string, id: string): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    metadata: { id, responsesStored: true },
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

function storedMarkers(contents: readonly IContent[]): string[] {
  return contents.flatMap((content) =>
    content.speaker === 'ai' && content.metadata?.responsesStored === true
      ? [content.metadata.id ?? '']
      : [],
  );
}

describe('pending region identity (issue #4000 review round 2)', () => {
  it('keeps the user image whose caption a hook rewrote when a hook added an image and a note after it', () => {
    const original = imageTurn('u', 'user caption', 'turn-now');
    const rewritten = imageTurn('u', 'caption rewritten by hook', 'turn-now');
    const hookImage = imageTurn('h', 'hook image');
    const hookNote = textTurn('hook note');
    const contents = [
      imageTurn('a', 'old image'),
      rewritten,
      hookImage,
      hookNote,
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [original] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('u'), dataOf('h')], notes: 1 });
  });

  it('does not stretch the protected region back to an earlier history item with the same text', () => {
    const contents = [
      imageTurn('a', 'old image a'),
      textTurn('continue'),
      imageTurn('b', 'old image b'),
      imageTurn('c', 'old image c'),
      textTurn('continue, rewritten by hook', 'turn-now'),
      imageTurn('p', 'pasted now', 'turn-now'),
    ];
    const pending = [
      textTurn('continue', 'turn-now'),
      imageTurn('p', 'pasted now', 'turn-now'),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: pending },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('c'), dataOf('p')], notes: 2 });
  });

  it('does not take a re-pasted copy of the same image from an older turn as the pending item', () => {
    const contents = [
      imageTurn('x', 'older paste of the same image', 'turn-old'),
      imageTurn('b', 'old image b', 'turn-b'),
      imageTurn('c', 'old image c', 'turn-c'),
      imageTurn('d', 'old image d', 'turn-d'),
      textTurn('hook rewrote the user text away'),
    ];
    const pending = [imageTurn('x', 'pasted now', 'turn-now')];

    const result = retireEnvelopeImages(
      { contents, pendingContents: pending },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('c'), dataOf('d')], notes: 2 });
  });

  it('protects only the newest content when no declared pending item can be identified, whatever equal text history holds', () => {
    const contents = [
      imageTurn('a', 'old a'),
      textTurn('continue'),
      imageTurn('b', 'old b'),
      textTurn('something unrelated, hook replaced everything'),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [textTurn('continue')] },
      BUDGET,
    );

    expect(imageData(result)).toStrictEqual([dataOf('a'), dataOf('b')]);
    const oversized = retireEnvelopeImages(
      {
        contents: [
          imageTurn('a', 'a'),
          imageTurn('b', 'b'),
          imageTurn('c', 'c'),
        ],
        pendingContents: [textTurn('continue')],
      },
      BUDGET,
    );
    expect(imageData(oversized)).toStrictEqual([dataOf('c')]);
  });
});

describe('stored Responses parents in the protected tail (issue #4000 review round 2)', () => {
  function sessionHistory(): IContent[] {
    return [
      imageTurn('a', 'a'),
      textTurn('seen a', undefined, 'ai'),
      imageTurn('b', 'b'),
      textTurn('seen b', undefined, 'ai'),
      imageTurn('c', 'c'),
    ];
  }

  it('drops a stored parent that sits in the pending tail, leaving canonical entries marked', () => {
    const parent = storedAiTurn('tail answer', 'resp_parent');
    const pending = [textTurn('tail question'), parent, textTurn('after')];
    const canonicalBefore = JSON.stringify(pending);

    const result = retireEnvelopeImages(
      { contents: [...sessionHistory(), ...pending], pendingContents: pending },
      BUDGET,
    );

    expect({
      notes: noteCount(result),
      storedParents: storedMarkers(result),
      canonicalMarker: parent.metadata?.responsesStored,
      canonicalUnchanged: JSON.stringify(pending) === canonicalBefore,
    }).toStrictEqual({
      notes: 2,
      storedParents: [],
      canonicalMarker: true,
      canonicalUnchanged: true,
    });
  });

  it('keeps a stored parent that precedes the first retired image', () => {
    const early = storedAiTurn('early answer', 'resp_early');
    const history = [early, ...sessionHistory()];
    const pending = [textTurn('now')];

    const result = retireEnvelopeImages(
      { contents: [...history, ...pending], pendingContents: pending },
      BUDGET,
    );

    expect({
      notes: noteCount(result),
      storedParents: storedMarkers(result),
    }).toStrictEqual({ notes: 2, storedParents: ['resp_early'] });
  });

  it('drops a stored parent in the protected tail on the fallback retirement path too', () => {
    const parent = storedAiTurn('tail answer', 'resp_parent');
    const history = sessionHistory();
    const contents = [...history, parent, textTurn('after')];

    const result = retireEveryHistoricalImage(contents, history.length);

    expect({
      notes: noteCount(result),
      storedParents: storedMarkers(result),
      canonicalMarker: parent.metadata?.responsesStored,
    }).toStrictEqual({ notes: 3, storedParents: [], canonicalMarker: true });
  });
});
