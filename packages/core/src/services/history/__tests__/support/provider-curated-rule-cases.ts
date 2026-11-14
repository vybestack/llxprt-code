/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent, ContentBlock } from '../../IContent.js';
import { suffixRow } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';

function call(id: string): ContentBlock {
  return { type: 'tool_call', id, name: 'inspect', parameters: { id } };
}
function response(id: string, complete = false): ContentBlock {
  return {
    type: 'tool_response',
    callId: id,
    toolName: 'inspect',
    result: { id, complete },
    isComplete: complete,
  };
}
function media(label: string): ContentBlock {
  return {
    type: 'media',
    encoding: 'base64',
    mimeType: 'image/png',
    data: 'aGVsbG8=',
    caption: label,
  };
}
function row(
  speaker: IContent['speaker'],
  ...blocks: ContentBlock[]
): IContent {
  return { speaker, blocks };
}
const text: ContentBlock = {
  type: 'text',
  text: 'preserved non-response content',
};

export const providerCurationRuleCases: ReadonlyArray<{
  readonly name: string;
  readonly rows: readonly IContent[];
}> = [
  {
    name: 'R1 reconstructs repeated unseen tool responses before later real calls',
    rows: [
      row('tool', response('a'), response('a'), media('reconstructed')),
      row('ai', call('a')),
    ],
  },
  {
    name: 'R2 attaches responses to calls carried by human and split tool rows',
    rows: [
      row('human', text, call('a')),
      row('tool', call('b'), response('a')),
      row('tool', response('b')),
    ],
  },
  {
    name: 'R3 completes an orphan at the first AI holder after an earlier human call',
    rows: [
      row('human', text, call('a')),
      row('ai', call('a')),
      row('ai', call('a')),
    ],
  },
  {
    name: 'R4 orders first-response slots while selecting better later duplicates',
    rows: [
      row('ai', call('a'), call('b')),
      row('human', text),
      row('tool', response('b'), media('first-b')),
      row('tool', response('a')),
      row('tool', response('a', true), media('duplicate-dropped')),
    ],
  },
  {
    name: 'R5 sends a mixed response row media to its first newly assigned target',
    rows: [
      row('ai', call('a')),
      row('ai', call('b')),
      row('tool', response('b'), response('a'), media('belongs-to-b')),
    ],
  },
  {
    name: 'R6 retains only adjacent response metadata and marks reordered output',
    rows: [
      row('ai', call('a')),
      {
        ...row('tool', response('a'), media('adjacent')),
        metadata: { cacheAnchor: true, id: 'adjacent-anchor' },
      },
      row('ai', call('b')),
      row('human', text),
      { ...row('tool', response('b')), metadata: { id: 'displaced-anchor' } },
    ],
  },
  {
    name: 'R7 strips response and media blocks without dropping cross-speaker text',
    rows: [
      row('human', text, call('a')),
      row('ai', text, response('a'), media('relocated')),
      row('human', text, response(''), media('no-target')),
    ],
  },
  {
    name: 'R8 excludes invalid AI rows before normalization while retaining human empties',
    rows: [
      row('ai'),
      row('human'),
      row('ai', { type: 'text', text: '' }),
      row('human', text),
      row('ai', call('a')),
    ],
  },
].map((entry) => ({
  ...entry,
  rows: entry.rows.map((value, index) => ({
    ...value,
    metadata: {
      ...value.metadata,
      chronology: suffixRow(index).metadata?.chronology,
    },
  })),
}));
