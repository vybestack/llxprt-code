/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: request-view retirement of the oldest historical images.
 * The view is recomputed from canonical history on every request, protects
 * the explicit pending region, leaves non-image media alone and never
 * mutates its input.
 */

import { describe, expect, it } from 'bun:test';
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireHistoricalImages } from '../historicalImageRetirement.js';

const BUDGET = 1000;
const TARGET = 750;

function inlineImage(
  label: string,
  length: number,
  filename?: string,
): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: `look at ${label}` },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'A'.repeat(length),
        ...(filename === undefined ? {} : { filename }),
        semanticMetadata: {},
      },
    ],
  };
}

function referenceImage(
  label: string,
  length: number,
  mimeType: string = 'image/png',
): IContent {
  const contentId = `sha256:${label.padEnd(64, '0')}`;
  const object = {
    contentId,
    mimeType,
    byteLength: length,
    normalizedBase64Length: length,
  };
  const reference: MediaReferenceBlock = {
    type: 'media',
    encoding: 'reference',
    mimeType,
    contentId,
    originalContentId: contentId,
    selectedContentId: contentId,
    originalObject: object,
    selectedObject: object,
    transformation: { policyId: 'identity', policyVersion: 1, parameters: {} },
    byteLength: length,
    normalizedBase64Length: length,
    semanticMetadata: {},
  };
  return { speaker: 'tool', blocks: [reference] };
}

function text(content: IContent): string {
  return content.blocks
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('');
}

function mediaCount(contents: readonly IContent[]): number {
  return contents.flatMap((content) =>
    content.blocks.filter((block) => block.type === 'media'),
  ).length;
}

describe('retireHistoricalImages', () => {
  it('returns the same history when the aggregate fits the budget', () => {
    const history = [inlineImage('a', 400), inlineImage('b', 400)];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 200)],
      BUDGET,
    );

    expect(view).toBe(history);
  });

  it('treats an aggregate exactly equal to the budget as fitting', () => {
    const history = [inlineImage('a', 500)];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 500)],
      BUDGET,
    );

    expect(view).toBe(history);
  });

  it('retires the oldest images down to 75% of the budget and keeps newer ones', () => {
    const history = [
      inlineImage('a', 300),
      inlineImage('b', 300),
      inlineImage('c', 300),
    ];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    expect({
      media: mediaCount(view),
      retired: view.map((content) => text(content).includes('omitted')),
      withinTarget: mediaCount(view) * 300 + 300 <= TARGET,
    }).toStrictEqual({
      media: 1,
      retired: [true, true, false],
      withinTarget: true,
    });
  });

  it('never changes the pending images, even when they alone exceed the budget', () => {
    const history = [inlineImage('a', 400), inlineImage('b', 400)];
    const pending = [inlineImage('p', 1500)];

    const view = retireHistoricalImages(history, pending, BUDGET);

    expect(mediaCount(view)).toBe(0);
    expect(pending[0]?.blocks[1]).toMatchObject({ encoding: 'base64' });
  });

  it('leaves non-image media and URL images in place', () => {
    const history = [
      referenceImage('d0c', 900, 'application/pdf'),
      inlineImage('a', 300),
    ];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    expect(view[0]).toBe(history[0]);
    expect(text(view[1])).toContain('omitted');
  });

  it('does not touch URL-encoded images', () => {
    const urlImage: IContent = {
      speaker: 'human',
      blocks: [
        {
          type: 'media',
          encoding: 'url',
          mimeType: 'image/png',
          data: 'https://example.test/a.png',
        },
      ],
    };
    const history = [urlImage, inlineImage('a', 900)];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    expect(view[0]).toBe(urlImage);
  });

  it('retires reference images by their canonical size without mutating them', () => {
    const history = [referenceImage('a1', 600), referenceImage('b2', 600)];
    const before = JSON.stringify(history);

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    expect({
      canonicalUnchanged: JSON.stringify(history) === before,
      remainingMedia: mediaCount(view),
      oldestIsNote: text(view[0]).includes('omitted'),
    }).toStrictEqual({
      canonicalUnchanged: true,
      remainingMedia: 1,
      oldestIsNote: true,
    });
  });

  it('names the file and recommends a workspace reread only for a valid file name', () => {
    const history = [
      inlineImage('a', 400, 'shots/login.png'),
      inlineImage('b', 400),
      inlineImage('c', 400, 'bad\nname.png'),
    ];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 100)],
      BUDGET,
    );

    const [named, anonymous, injected] = view.map(text);
    expect({
      namedMentionsFile: named.includes('"shots/login.png"'),
      namedRecommendsReread: named.includes('in the workspace'),
      anonymousRecommendsReread: anonymous.includes('in the workspace'),
      injectedKeepsName: injected.includes('bad'),
    }).toStrictEqual({
      namedMentionsFile: true,
      namedRecommendsReread: true,
      anonymousRecommendsReread: false,
      injectedKeepsName: false,
    });
  });

  it('never invents a hash handle or a visual description', () => {
    const history = [inlineImage('a', 900, 'a.png')];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    const note = text(view[0]);
    expect(note).not.toMatch(/sha256|looks like|shows a|depicts/i);
  });

  it('is idempotent and stable when a small image is appended after retirement', () => {
    const history = [
      inlineImage('a', 300),
      inlineImage('b', 300),
      inlineImage('c', 300),
    ];
    const pending = [inlineImage('p', 300)];
    const first = retireHistoricalImages(history, pending, BUDGET);
    const again = retireHistoricalImages(history, pending, BUDGET);

    const grown = [...history, inlineImage('p', 300), inlineImage('q', 20)];
    const next = retireHistoricalImages(grown, [inlineImage('r', 20)], BUDGET);

    expect({
      repeatable: JSON.stringify(first) === JSON.stringify(again),
      earlierViewPreserved:
        JSON.stringify(next.slice(0, 3)) === JSON.stringify(first.slice(0, 3)),
    }).toStrictEqual({ repeatable: true, earlierViewPreserved: true });
  });

  it('does not retire anything for a zero budget so the explicit policy still rejects', () => {
    const history = [inlineImage('a', 100)];

    const view = retireHistoricalImages(history, [inlineImage('p', 100)], 0);

    expect(view).toBe(history);
  });

  it('skips unmeasurable media instead of guessing or throwing', () => {
    const corrupt = referenceImage('bad', Number.NaN);
    const history = [corrupt, inlineImage('a', 900)];

    const view = retireHistoricalImages(
      history,
      [inlineImage('p', 300)],
      BUDGET,
    );

    expect(view[0]).toBe(corrupt);
  });
});
