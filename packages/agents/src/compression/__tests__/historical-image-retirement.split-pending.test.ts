/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 review round 3 (H2): a BeforeModel hook may split one declared
 * pending item into several contents. Every fragment that carries one of the
 * item's attachments is current-turn media, so the protected region starts at
 * the earliest fragment, not at the newest one.
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

describe('a declared pending item split by a hook (issue #4000 review round 3)', () => {
  const declared = humanTurn(
    [text('look at both'), image('a'), image('b')],
    'turn-now',
  );

  it('keeps every image of the item when a hook split it in two and appended a note', () => {
    const contents = [
      humanTurn([text('older'), image('o')], 'turn-old'),
      humanTurn([text('look at both'), image('a')], 'turn-now'),
      humanTurn([image('b')], 'turn-now'),
      humanTurn([text('hook note')]),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('a'), dataOf('b')], notes: 1 });
  });

  it('keeps both fragments when a hook note sits between them', () => {
    const contents = [
      humanTurn([text('older'), image('o')], 'turn-old'),
      humanTurn([text('look at both'), image('a')], 'turn-now'),
      humanTurn([text('hook note')]),
      humanTurn([image('b')], 'turn-now'),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('a'), dataOf('b')], notes: 1 });
  });

  it('does not stretch the protected region over a history image the item does not carry', () => {
    const contents = [
      humanTurn([text('older'), image('o')], 'turn-old'),
      humanTurn([text('between'), image('x')], 'turn-between'),
      humanTurn([text('look at both'), image('a')], 'turn-now'),
      humanTurn([image('b')], 'turn-now'),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('a'), dataOf('b')], notes: 2 });
  });

  it('still refuses a fragment whose provenance conflicts with the item', () => {
    const contents = [
      humanTurn([text('older paste of a'), image('a')], 'turn-old'),
      humanTurn([text('x'), image('x')], 'turn-x'),
      humanTurn([text('look at both'), image('b')], 'turn-now'),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [declared] },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({ kept: [dataOf('b')], notes: 2 });
  });
});
