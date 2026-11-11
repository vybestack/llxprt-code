/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #4000 CodeRabbit round (T1): a stored Responses parent was generated
 * from a request whose old images were retired. That is safe for a later
 * request only because retirement is deterministic and monotone: under the
 * same budget, every image an earlier request retired is retired again once
 * the conversation has grown, so no later request offers the parent together
 * with pixels the parent never received.
 */

import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireEnvelopeImages } from '../historicalImageRetirement.js';

const BUDGET = 1000;
const IMAGE_LENGTH = 400;

function dataOf(label: string): string {
  return label.repeat(IMAGE_LENGTH).slice(0, IMAGE_LENGTH);
}

function imageTurn(label: string): IContent {
  return {
    speaker: 'human',
    metadata: { turnId: `turn-${label}` },
    blocks: [
      { type: 'text', text: `image ${label}` },
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

function answer(label: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text: `seen ${label}` }] };
}

function keptImages(contents: readonly IContent[]): string[] {
  return contents.flatMap((content) =>
    content.blocks.flatMap((block) =>
      block.type === 'media' && block.encoding === 'base64' ? [block.data] : [],
    ),
  );
}

function retireFor(history: IContent[], pending: IContent[]): string[] {
  const contents = [...history, ...pending];
  const result = retireEnvelopeImages(
    { contents, pendingContents: pending },
    BUDGET,
  );
  const kept = new Set(keptImages(result));
  return keptImages(contents).filter((data) => !kept.has(data));
}

describe('retirement is monotone as the conversation grows (issue #4000 CodeRabbit T1)', () => {
  it('retires again every image an earlier request retired', () => {
    const early = [
      imageTurn('a'),
      answer('a'),
      imageTurn('b'),
      answer('b'),
      imageTurn('c'),
      answer('c'),
    ];
    const grown = [...early, imageTurn('d'), answer('d')];

    const retiredEarly = retireFor(early, [imageTurn('p')]);
    const retiredLater = retireFor(grown, [imageTurn('q')]);

    expect({
      earlyRetiredSomething: retiredEarly.length > 0,
      laterCoversEarly: retiredEarly.every((data) =>
        retiredLater.includes(data),
      ),
    }).toStrictEqual({ earlyRetiredSomething: true, laterCoversEarly: true });
  });
});
