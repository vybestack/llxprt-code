/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import {
  call,
  response,
} from '../../../core/src/services/history/__tests__/support/normalization-cases.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  recordOf,
  sendThroughRoute,
  WIRE_ROUTES,
} from './support/wireBodyCapture.js';

const histories: ReadonlyArray<readonly IContent[]> = [
  [{ speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] }],
  [
    {
      speaker: 'ai',
      blocks: [
        { type: 'thinking', thought: 'private' },
        {
          type: 'tool_call',
          id: 'toolu_alpha-1',
          name: 'lookup',
          parameters: { path: '雪' },
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: 'toolu_alpha-1',
          toolName: 'lookup',
          result: 'ok',
        },
      ],
    },
  ],
  [
    {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: '4SftZvDMX', name: 'holder', parameters: {} },
        {
          type: 'tool_call',
          id: 'toolu_alpha-1',
          name: 'lookup',
          parameters: {},
        },
      ],
    },
    {
      speaker: 'tool',
      blocks: [
        {
          type: 'tool_response',
          callId: '4SftZvDMX',
          toolName: 'holder',
          result: 'first',
        },
        {
          type: 'tool_response',
          callId: 'toolu_alpha-1',
          toolName: 'lookup',
          result: 'second',
        },
      ],
    },
  ],
];

interface MistralCase {
  readonly rows: readonly IContent[];
  readonly pending: readonly IContent[];
}
const cases: readonly MistralCase[] = [
  ...histories.map((rows) => ({ rows, pending: [] })),
  {
    rows: [
      {
        speaker: 'ai',
        blocks: [call(''), call('hist_tool_alias'), call('call_alias')],
      },
      {
        speaker: 'tool',
        blocks: [
          response(''),
          response('hist_tool_alias'),
          response('call_alias'),
        ],
      },
    ],
    pending: [],
  },
  {
    rows: [
      { speaker: 'human', blocks: [call('4SftZvDMX', '')] },
      {
        speaker: 'ai',
        blocks: [call('toolu_alpha-1'), call('toolu_alpha-1', '')],
      },
    ],
    pending: [],
  },
  {
    rows: [
      {
        speaker: 'tool',
        blocks: [response('toolu_alpha-1'), call('4SftZvDMX')],
      },
    ],
    pending: [],
  },
  {
    rows: [{ speaker: 'ai', blocks: [call('4SftZvDMX')] }],
    pending: [
      {
        speaker: 'ai',
        blocks: [call('toolu_alpha-1'), call('toolu_alpha-1', 'renamed')],
      },
    ],
  },
  {
    rows: [{ speaker: 'ai', blocks: [call('toolu_alpha-1')] }],
    pending: [{ speaker: 'tool', blocks: [response('toolu_alpha-1')] }],
  },
  {
    rows: [{ speaker: 'tool', blocks: [response('toolu_alpha-1')] }],
    pending: [
      { speaker: 'human', blocks: [call('4Uq1sY29c', '')] },
      { speaker: 'ai', blocks: [call('4SftZvDMX'), call('toolu_alpha-1')] },
    ],
  },
  {
    rows: [{ speaker: 'human', blocks: [] }],
    pending: [
      { speaker: 'tool', blocks: [response('toolu_alpha-1')] },
      { speaker: 'tool', blocks: [response('4SftZvDMX'), call('4Uq1sY29c')] },
      { speaker: 'ai', blocks: [call('toolu_alpha-1')] },
    ],
  },
];

describe('native Mistral production HTTP', () => {
  it.each(
    cases.flatMap(({ rows, pending }, index) =>
      ['none', 'all', 'allButLast'].map((strip) => ({
        rows,
        pending,
        index,
        strip,
      })),
    ),
  )(
    'matches old Mistral bytes without operation files for history $index/$strip',
    async ({ rows, pending, strip }) => {
      const route = WIRE_ROUTES.find(
        (item) => item.id === 'openai-chat-mistral',
      );
      if (route === undefined) throw new Error('Missing Mistral route');
      const shape = {
        id: 'mistral-native',
        description: 'native Mistral',
        rows,
        ephemerals: {
          'reasoning.stripFromContext': strip,
          'reasoning.includeInContext': true,
        },
      };
      const expected = recordOf(
        await sendThroughRoute(
          route,
          { ...shape, rows: await normalizedRows([...rows, ...pending]) },
          'rows',
        ),
      );
      const fixture = await journalSendFixture(rows, pending, {
        directory: 'tmp/p6/chat-mistral-run-bj/fixtures',
      });
      const sink = await localWireHashSink(route);
      try {
        const provider = route.createProvider();
        const options = buildHistoryCallOptions(
          sink.route,
          shape,
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        const receipt = await operationFileCreates(async () => {
          for await (const chunk of provider.generateChatCompletion(options))
            void chunk;
        }, true);
        expect(receipt).toStrictEqual({ files: [], directories: [] });
        expect(sink.requests).toHaveLength(1);
        expect(sink.requests[0].bytes).toBe(expected.length);
        expect(sink.requests[0].sha256).toBe(expected.sha256);
        expect(sink.requests[0].contentLength).toBe(String(expected.length));
      } finally {
        await sink.close();
        await fixture.close();
      }
    },
  );
});
