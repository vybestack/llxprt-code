/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { anthropicViewFixture } from './support/anthropic-view-fixture.js';
import {
  anthropicJournalSink,
  sendAnthropicJournalCase,
} from './support/anthropic-journal-case.js';
import { rowsSelection } from './support/wireBodyCapture.js';

const text = (
  value: string,
  speaker: IContent['speaker'] = 'human',
): IContent => ({
  speaker,
  blocks: [{ type: 'text', text: value }],
});
const call = (id: string): IContent => ({
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id, name: 'lookup', parameters: {} }],
});
const result = (id: string, value = 'found 雪'): IContent => ({
  speaker: 'tool',
  blocks: [
    { type: 'tool_response', callId: id, toolName: 'lookup', result: value },
  ],
});
const thinking: IContent = {
  speaker: 'ai',
  blocks: [
    {
      type: 'thinking',
      thought: 'consider',
      sourceField: 'thinking',
      signature: 'sig',
    },
  ],
};
interface SpanCase {
  readonly name: string;
  readonly rows: readonly IContent[];
  readonly tail: readonly IContent[];
  readonly cache?: '5m';
  readonly change?: { readonly at: number; readonly replacement?: IContent };
}
const scenarios: readonly SpanCase[] = [
  {
    name: 'an orphan call 1000 rows before its pending result',
    rows: [
      text('question'),
      call('hist_tool_distant'),
      ...Array.from({ length: 1000 }, (_, at) =>
        text(`prefix ${at}`, at % 2 === 0 ? 'human' : 'ai'),
      ),
    ],
    tail: [result('toolu_distant')],
  },
  {
    name: 'a repeated tool ID across prefix and tail',
    rows: [
      text('question'),
      call('call_repeat'),
      result('call_repeat', 'first'),
      text('answer', 'ai'),
    ],
    tail: [call('call_repeat'), result('call_repeat', 'second'), text('next')],
  },
  {
    name: 'a thinking chain continuing across the prefix boundary',
    rows: [text('question'), thinking],
    tail: [text('answer', 'ai'), text('next')],
  },
  {
    name: 'a purge removing the first holder',
    rows: [text('removed question'), text('answer', 'ai'), text('next')],
    tail: [text('pending')],
    change: { at: 0 },
  },
  {
    name: 'a count-changing replacement containing tool rows',
    rows: [
      text('question'),
      text('answer', 'ai'),
      {
        speaker: 'tool',
        blocks: [
          ...call('call_replacement').blocks,
          ...text('old tool text').blocks,
        ],
      },
      text('last answer', 'ai'),
    ],
    tail: [text('pending')],
    change: {
      at: 2,
      replacement: {
        speaker: 'tool',
        blocks: call('call_replacement').blocks,
      },
    },
  },
  {
    name: 'a cached resized view with a human tail',
    rows: [
      { ...text('anchored question'), metadata: { cacheAnchor: true } },
      text('answer', 'ai'),
      text('removed'),
      text('last answer', 'ai'),
    ],
    tail: [text('pending')],
    cache: '5m',
    change: { at: 2 },
  },
];

describe('native Anthropic affected-span HTTP requests', () => {
  it.each([...scenarios])(
    'sends $name without request files',
    async (scenario) => {
      const fixture = await anthropicViewFixture(
        scenario.rows,
        scenario.tail,
        scenario.change,
      );
      const sink = await anthropicJournalSink();
      const original = globalThis.fetch;
      globalThis.fetch = Object.assign(
        async (
          input: Parameters<typeof fetch>[0],
          init?: Parameters<typeof fetch>[1],
        ): Promise<Response> => {
          const url = new URL(
            typeof input === 'string' || input instanceof URL
              ? input
              : input.url,
          );
          return original(sink.route.baseURL + url.pathname, init);
        },
        { preconnect: original.preconnect },
      );
      const route = {
        ...sink.route,
        baseURL: 'https://api.anthropic.com',
        providerSettings: { 'prompt-caching': scenario.cache ?? 'off' },
        ephemerals: {
          ...sink.route.ephemerals,
          'reasoning.enabled': true,
          'reasoning.includeInContext': true,
        },
      };
      try {
        expect(
          fixture.selection.indexed.viewPlan.changedSources.some(
            (row) => row.oldCount > 0 && row.count !== row.oldCount,
          ),
        ).toBe(scenario.change !== undefined);
        const reference: IContent[] = [];
        for await (const row of fixture.selection.openReader())
          reference.push(row);
        await sendAnthropicJournalCase(route, rowsSelection(reference));
        const created = await operationFileCreates(async () => {
          await sendAnthropicJournalCase(route, fixture.selection);
        }, true);
        expect(sink.requests).toHaveLength(2);
        expect(sink.requests[1].body).toBe(sink.requests[0].body);
        expect(sink.requests[1].length).toBe(
          String(Buffer.byteLength(sink.requests[1].body)),
        );
        expect(created).toStrictEqual({ files: [], directories: [] });
      } finally {
        globalThis.fetch = original;
        await sink.close();
        await fixture.close();
      }
    },
  );
});
