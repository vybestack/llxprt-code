/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

function call(id: string, name: string): IContent['blocks'][number] {
  return { type: 'tool_call', id, name, parameters: { path: `雪 ${id}` } };
}
function answer(id: string, name: string, result: string): IContent {
  return {
    speaker: 'tool',
    blocks: [{ type: 'tool_response', callId: id, toolName: name, result }],
  };
}

const manyCalls: IContent[] = Array.from({ length: 12 }, (_, index) => [
  {
    speaker: 'ai' as const,
    blocks: [
      ...(index % 5 === 0
        ? [{ type: 'thinking' as const, thought: `plan ${index}` }]
        : []),
      call(`toolu_${index}`, 'lookup'),
    ],
  },
  answer(`toolu_${index}`, 'lookup', `ok ${index}`),
]).flat();

export interface KimiHistory {
  readonly name: string;
  readonly rows: readonly IContent[];
  readonly pending: readonly IContent[];
}

export const kimiHistories: readonly KimiHistory[] = [
  {
    name: 'one call',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] },
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'private' },
          call('toolu_alpha-1', 'lookup'),
        ],
      },
      answer('toolu_alpha-1', 'lookup', 'ok'),
    ],
    pending: [],
  },
  {
    name: 'two digit ordinals with later duplicates',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] },
      ...manyCalls,
      { speaker: 'ai', blocks: [call('toolu_3', 'renamed')] },
      { speaker: 'ai', blocks: [call('', 'unmapped')] },
    ],
    pending: [],
  },
  {
    name: 'unnamed calls take fallback counters',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] },
      ...manyCalls,
      {
        speaker: 'ai',
        blocks: [call('toolu_blank', ''), call('toolu_named', 'lookup')],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'toolu_blank',
            toolName: 'blank',
            result: 'first',
          },
          {
            type: 'tool_response',
            callId: 'toolu_named',
            toolName: 'lookup',
            result: 'second',
          },
        ],
      },
    ],
    pending: [],
  },
  {
    name: 'only a pending message',
    rows: [],
    pending: [{ speaker: 'human', blocks: [{ type: 'text', text: 'hi 雪' }] }],
  },
  {
    name: 'pending tool response',
    rows: [
      { speaker: 'human', blocks: [{ type: 'text', text: 'go' }] },
      ...manyCalls,
      {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'last' },
          call('toolu_last', 'finish'),
        ],
      },
    ],
    pending: [answer('toolu_last', 'finish', 'done')],
  },
];
