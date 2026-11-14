/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */

/**
 * Issue #854 E6: the histories of the image-recovery golden. Each holds an
 * image the service would reject. Images are PNG headers (see
 * `pngHeaderBase64`), so the bytes are the same on every machine.
 */

import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { imageRow, pngHeaderBase64 } from './imageRecoveryCapture.js';
import type { HistoryCase } from './wireBodyHistories.js';

function human(text: string): IContent {
  return { speaker: 'human', blocks: [{ type: 'text', text }] };
}

function ai(text: string): IContent {
  return { speaker: 'ai', blocks: [{ type: 'text', text }] };
}

function image(width: number, height: number): IContent['blocks'][number] {
  return {
    type: 'media',
    mimeType: 'image/png',
    encoding: 'base64',
    data: pngHeaderBase64(width, height),
  };
}

function readFileTurn(
  callId: string,
  ...images: Array<IContent['blocks'][number]>
): IContent[] {
  return [
    {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: callId,
          name: 'read_file',
          parameters: { path: `${callId}.png` },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId,
          toolName: 'read_file',
          result: `Read ${callId}.png`,
        },
        ...images,
      ],
    },
  ];
}

export const RECOVERY_HISTORIES: readonly HistoryCase[] = [
  {
    id: 'top-level-image',
    description: 'an oversized image in the first row, text rows after it',
    rows: [
      imageRow(3000, 3000, 'describe this'),
      ai('a blue square'),
      human('why'),
    ],
  },
  {
    id: 'image-only-row',
    description: 'a user row that holds nothing but the oversized image',
    rows: [
      { speaker: 'human', blocks: [image(2400, 2400)] },
      ai('seen'),
      human('and now?'),
    ],
  },
  {
    id: 'image-last-block-of-tail',
    description:
      'the oversized image is the last block of the last row, where the tail cache breakpoint lands',
    rows: [
      human('look at this'),
      ai('ok'),
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'here it is' }, image(2600, 1200)],
      },
    ],
  },
  {
    id: 'tool-result-image',
    description:
      'an oversized image returned by a tool call, with sibling text',
    rows: [
      human('read the picture'),
      ...readFileTurn('toolu_big', image(3000, 3000)),
      ai('it is big'),
      human('thanks'),
    ],
  },
  {
    id: 'mixed-small-and-large',
    description:
      'a small image kept beside two oversized ones, in a user row and in a tool result',
    rows: [
      {
        speaker: 'human',
        blocks: [
          image(64, 64),
          image(4000, 100),
          { type: 'text', text: 'three images' },
        ],
      },
      ...readFileTurn('toolu_mix', image(100, 100), image(2500, 2500)),
      ai('done'),
      human('again'),
    ],
  },
  {
    id: 'configured-budget-intersection',
    description:
      'a configured 2500 budget keeps a 2200 image on the first request; the error limit of 2000 drops it on the retry',
    rows: [imageRow(2200, 1000, 'keep or drop'), ai('seen'), human('next')],
    globalSettings: { 'max-image-dimension': 2500 },
  },
  {
    id: 'configured-budget-pixels',
    description:
      'a pixel budget drops one image up front; the dimension limit drops another on the retry',
    rows: [
      { speaker: 'human', blocks: [image(1900, 1900), image(2200, 100)] },
      ai('seen'),
      human('next'),
    ],
    globalSettings: { 'max-image-pixels': 3000000 },
  },
  {
    id: 'cache-anchor-and-purge-boundary',
    description:
      'semantic media purge on, a tagged prefix and an anchored row ahead of an oversized image',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'stable prefix' }],
        metadata: {
          semanticMediaPurgeBoundary: {
            blockIndex: 0,
            boundaryId: Object.freeze({}),
          },
        },
      },
      {
        speaker: 'human',
        blocks: [image(3000, 3000)],
      },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'seen' }],
        metadata: { cacheAnchor: true },
      },
      human('tail'),
    ],
    globalSettings: { 'media.semantic-purge': 'remove' },
  },
  {
    id: 'only-small-images',
    description:
      'images within every limit: the error cannot be recovered and is rethrown',
    rows: [imageRow(64, 64, 'tiny'), ai('seen'), human('next')],
  },
];
