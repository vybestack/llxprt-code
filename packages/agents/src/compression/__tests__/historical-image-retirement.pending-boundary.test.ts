/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Issue #3984: the request-view retirement trusts the pending region only when
 * the envelope proves it. A hook may append items after the original pending
 * region or rewrite its blocks; the envelope's pending contents are then the
 * authority and the contents tail must carry exactly those blocks. Anything
 * unproven fails closed: nothing is retired and nothing is guessed.
 */

import { describe, expect, it } from 'bun:test';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  buildProviderContent,
  type ProviderContentEnvelope,
} from '@vybestack/llxprt-code-core/services/history/historyProviderPipeline.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { retireEnvelopeImages } from '../historicalImageRetirement.js';

const BUDGET = 1000;
const IMAGE_LENGTH = 400;

function imageTurn(label: string, caption = `look at ${label}`): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: caption },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: label.repeat(IMAGE_LENGTH).slice(0, IMAGE_LENGTH),
        semanticMetadata: {},
      },
    ],
  };
}

function aiTurn(text: string, responsesStored?: boolean): IContent {
  return {
    speaker: 'ai',
    blocks: [{ type: 'text', text }],
    ...(responsesStored === undefined
      ? {}
      : { metadata: { id: `resp-${text}`, responsesStored } }),
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

function dataOf(label: string): string {
  return label.repeat(IMAGE_LENGTH).slice(0, IMAGE_LENGTH);
}

describe('retireEnvelopeImages pending boundary proof (issue #3984)', () => {
  it('keeps an original pending image when a hook appended a same-shape item after it', () => {
    const history = [imageTurn('a'), aiTurn('seen a')];
    const original = imageTurn('p');
    const hookAppended = imageTurn('h');
    const envelope: ProviderContentEnvelope = {
      contents: [...history, original, hookAppended],
      pendingContents: [original],
    };

    const result = retireEnvelopeImages(envelope, BUDGET);

    expect(imageData(result)).toContain(dataOf('p'));
  });

  it('retires nothing when the contents tail is not the envelope pending region', () => {
    const history = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];
    const envelope: ProviderContentEnvelope = {
      contents: [...history, imageTurn('p'), imageTurn('h')],
      pendingContents: [imageTurn('p')],
    };

    const result = retireEnvelopeImages(envelope, BUDGET);

    expect(result).toBe(envelope.contents);
  });

  it('retires nothing when a hook rewrote the pending blocks but the envelope still names the old ones', () => {
    const history = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];
    const envelope: ProviderContentEnvelope = {
      contents: [...history, imageTurn('p', 'rewritten by hook')],
      pendingContents: [imageTurn('p', 'original text')],
    };

    const result = retireEnvelopeImages(envelope, BUDGET);

    expect([result, noteCount(result)]).toStrictEqual([envelope.contents, 0]);
  });

  it('preserves the latest hook-rewritten pending when the envelope names the rewritten blocks', () => {
    const history = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];
    const rewritten = imageTurn('p', 'rewritten by hook');
    const envelope: ProviderContentEnvelope = {
      contents: [...history, rewritten],
      pendingContents: [rewritten],
    };

    const result = retireEnvelopeImages(envelope, BUDGET);

    expect({
      kept: imageData(result).includes(dataOf('p')),
      rewrittenText: result[result.length - 1].blocks[0],
      notes: noteCount(result),
    }).toStrictEqual({
      kept: true,
      rewrittenText: { type: 'text', text: 'rewritten by hook' },
      notes: 2,
    });
  });

  it('retires history and keeps every appended hook item when recovery names them all as pending', () => {
    const history = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];
    const original = imageTurn('p');
    const hookAppended = imageTurn('h');
    const envelope: ProviderContentEnvelope = {
      contents: [...history, original, hookAppended],
      pendingContents: [original, hookAppended],
    };

    const result = retireEnvelopeImages(envelope, BUDGET);

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({
      kept: [dataOf('p'), dataOf('h')],
      notes: 2,
    });
  });

  it('still retires when the production pipeline cloned the pending items into the contents', () => {
    const history = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];
    const pending = [imageTurn('p'), imageTurn('h')];
    const contents = buildProviderContent(
      history,
      pending,
      DebugLogger.getLogger('test:issue3984:pending-boundary'),
    );
    expect(contents[contents.length - 1]).not.toBe(pending[1]);

    const result = retireEnvelopeImages(
      { contents, pendingContents: pending },
      BUDGET,
    );

    expect({
      kept: imageData(result),
      notes: noteCount(result),
    }).toStrictEqual({
      kept: [dataOf('p'), dataOf('h')],
      notes: 2,
    });
  });

  it('does not retire when the pending boundary is unrecoverable', () => {
    const contents = [imageTurn('a'), aiTurn('seen a'), imageTurn('b')];

    const result = retireEnvelopeImages(
      { contents, pendingContents: undefined },
      BUDGET,
    );

    expect(result).toBe(contents);
  });

  it('fails closed on a cyclic pending payload it cannot compare instead of looping', () => {
    const toolTurn = (): IContent => {
      const cyclic: Record<string, unknown> = { name: 'tool' };
      cyclic.self = cyclic;
      return {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call-1',
            toolName: 'probe',
            result: cyclic,
          },
        ],
      };
    };
    const contents = [
      imageTurn('a'),
      imageTurn('b'),
      imageTurn('c'),
      toolTurn(),
    ];

    const result = retireEnvelopeImages(
      { contents, pendingContents: [toolTurn()] },
      BUDGET,
    );

    expect(imageData(result)).toHaveLength(3);
  });
});

describe('retired request views and the Responses stateful chain (issue #3984)', () => {
  it('drops stored-response markers from the request view without touching canonical history', () => {
    const stored = aiTurn('seen a', true);
    const history = [imageTurn('a'), stored, imageTurn('b'), aiTurn('seen b')];
    const pending = [imageTurn('p')];
    const canonicalBefore = JSON.stringify(history);

    const result = retireEnvelopeImages(
      { contents: [...history, ...pending], pendingContents: pending },
      BUDGET,
    );

    expect({
      notes: noteCount(result),
      viewMarker: result[1].metadata?.responsesStored,
      canonicalUnchanged: JSON.stringify(history) === canonicalBefore,
      canonicalMarker: stored.metadata?.responsesStored,
    }).toStrictEqual({
      notes: 2,
      viewMarker: undefined,
      canonicalUnchanged: true,
      canonicalMarker: true,
    });
  });

  it('keeps stored-response markers when nothing retires', () => {
    const history = [imageTurn('a'), aiTurn('seen a', true)];
    const pending = [imageTurn('p')];
    const contents = [...history, ...pending];

    const result = retireEnvelopeImages(
      { contents, pendingContents: pending },
      BUDGET,
    );

    expect([result, result[1].metadata?.responsesStored]).toStrictEqual([
      contents,
      true,
    ]);
  });
});
