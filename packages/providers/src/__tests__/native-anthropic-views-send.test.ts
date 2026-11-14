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

const question: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'question 雪' }],
};
const answer: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'text', text: 'answer' }],
};
const round: IContent = {
  speaker: 'tool',
  blocks: [
    { type: 'tool_call', id: 'call_view', name: 'lookup', parameters: {} },
    {
      type: 'tool_response',
      callId: 'call_view',
      toolName: 'lookup',
      result: 'found 🐈',
    },
  ],
};
const summary: IContent = {
  speaker: 'human',
  blocks: [{ type: 'text', text: 'Summary of lookup: found 🐈' }],
};
const image: IContent = {
  speaker: 'human',
  blocks: [
    { type: 'text', text: 'image' },
    {
      type: 'media',
      mimeType: 'image/png',
      encoding: 'base64',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lxoAAAAASUVORK5CYII=',
    },
  ],
};

const cases: ReadonlyArray<{
  readonly name: string;
  readonly rows: readonly IContent[];
  readonly tail: readonly IContent[];
  readonly change?: { readonly at: number; readonly replacement?: IContent };
}> = [
  {
    name: 'purge removing a tool round',
    rows: [question, answer, round, image, answer],
    tail: [question],
    change: { at: 2 },
  },
  {
    name: 'purge replacing a tool span with a summary',
    rows: [question, answer, round, question, answer],
    tail: [question],
    change: { at: 2, replacement: summary },
  },
];

describe('native Anthropic journal view HTTP', () => {
  it.each(
    cases.flatMap((scenario) =>
      ['off', '5m'].map((cache) => ({ ...scenario, cache })),
    ),
  )(
    'sends $name with $cache without request files',
    async ({ rows, tail, change, cache }) => {
      const fixture = await anthropicViewFixture(rows, tail, change);
      const sink = await anthropicJournalSink();
      const route = {
        ...sink.route,
        providerSettings: { 'prompt-caching': cache },
      };
      try {
        const reference: IContent[] = [];
        for await (const row of fixture.selection.openReader())
          reference.push(row);
        const changes = fixture.selection.indexed.viewPlan.changedSources;
        expect(
          changes.some((row) => row.count !== row.oldCount && row.oldCount > 0),
        ).toBe(true);
        await sendAnthropicJournalCase(route, rowsSelection(reference));
        const created = await operationFileCreates(async () => {
          await sendAnthropicJournalCase(route, fixture.selection);
        }, true);
        expect(sink.requests).toHaveLength(2);
        expect(sink.requests[1]).toStrictEqual(sink.requests[0]);
        expect(sink.requests[1].length).toBe(
          String(Buffer.byteLength(sink.requests[1].body)),
        );
        expect(created).toStrictEqual({ files: [], directories: [] });
      } finally {
        await sink.close();
        await fixture.close();
      }
    },
  );
});
