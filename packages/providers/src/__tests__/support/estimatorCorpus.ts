/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type {
  IContent,
  MediaReferenceBlock,
} from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildHistoryCases, type HistoryCase } from './wireBodyHistories.js';

const unusedReference: MediaReferenceBlock = {
  type: 'media_reference',
} as unknown as MediaReferenceBlock;

function png(width: number, height: number): string {
  const bytes = Buffer.alloc(24);
  Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(bytes);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes.toString('base64');
}

function imageRow(...sizes: ReadonlyArray<[number, number]>): IContent {
  return {
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'look at these' },
      ...sizes.map(([width, height]) => ({
        type: 'media' as const,
        mimeType: 'image/png',
        encoding: 'base64' as const,
        data: png(width, height),
      })),
    ],
  };
}

/** Cases the golden corpus lacks: header-bearing images and embedded data URIs. */
export function extraCases(): HistoryCase[] {
  const dataUri = `data:image/png;base64,${png(40, 41)}`;
  return [
    {
      id: 'many-images',
      description: 'three images of different sizes in two rows',
      rows: [
        imageRow([1586, 991], [32, 32]),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'seen' }] },
        imageRow([4096, 4096]),
        { speaker: 'ai', blocks: [{ type: 'text', text: 'also seen' }] },
        { speaker: 'human', blocks: [{ type: 'text', text: 'ok' }] },
      ],
      systemInstruction: 'Describe images.',
    },
    {
      id: 'embedded-data-uri',
      description: 'data URIs inside text, a tool result and the system prompt',
      rows: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: `inline ${dataUri} then more 雪` }],
        },
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'tool_call',
              id: 'uri_call',
              name: 'read_file',
              parameters: { path: '/img.png', uri: dataUri },
            },
          ],
        },
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: 'uri_call',
              toolName: 'read_file',
              result: `body ${dataUri}`,
            },
          ],
        },
        { speaker: 'human', blocks: [{ type: 'text', text: 'done' }] },
      ],
      systemInstruction: `System ${dataUri} end`,
    },
  ];
}

/**
 * The histories every estimator parity test runs: the golden corpus without
 * the cases that need the request media store (the converters take resolved
 * rows), plus header-bearing images and embedded data URIs.
 */
export function estimatorCorpus(): HistoryCase[] {
  return [
    ...buildHistoryCases({ imageReference: unusedReference }).filter(
      (entry) => entry.usesMediaReferences !== true,
    ),
    ...extraCases(),
  ];
}
