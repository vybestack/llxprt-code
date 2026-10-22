/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
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

function plainRoute(): (typeof WIRE_ROUTES)[number] {
  const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
  if (route === undefined) throw new Error('Missing plain Chat route');
  return route;
}
const textRows: readonly IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪\\"\n' }] },
  { speaker: 'ai', blocks: [{ type: 'text', text: 'answer' }] },
];
const toolRows: readonly IContent[] = [
  {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: 'call_x',
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
        callId: 'call_x',
        toolName: 'lookup',
        result: 'ok',
      },
      {
        type: 'media',
        encoding: 'base64',
        mimeType: 'image/png',
        data: 'AQID',
      },
    ],
  },
  { speaker: 'human', blocks: [{ type: 'text', text: 'continue' }] },
];
async function verify(
  rows: readonly IContent[],
  ephemerals: Record<string, unknown> = {},
  expectedRows: readonly IContent[] = rows,
): Promise<number> {
  const base = plainRoute();
  const route =
    ephemerals.streaming === 'enabled'
      ? {
          ...base,
          respond: () =>
            new Response(
              `data: ${JSON.stringify({ id: 'chat', object: 'chat.completion.chunk', created: 0, model: 'gpt-4o', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] })}

data: [DONE]

`,
              { headers: { 'content-type': 'text/event-stream' } },
            ),
        }
      : base;
  const shape = {
    id: 'plain-direct',
    description: 'native HTTP',
    rows,
    ephemerals,
  };
  const expected = recordOf(
    await sendThroughRoute(
      route,
      { ...shape, rows: await normalizedRows(expectedRows) },
      'rows',
    ),
  );
  const fixture = await journalSendFixture(rows);
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
    return sink.entries();
  } finally {
    await sink.close();
    await fixture.close();
  }
}
describe('native plain Chat direct production send', () => {
  it('streams a native request into a real streaming Chat response without files', async () => {
    expect(await verify(textRows, { streaming: 'enabled' })).toBe(1);
  });
  it('sends the old builder bytes and Content-Length without creating any file or directory', async () => {
    expect(await verify(textRows)).toBe(1);
  });
  it('keeps strict OpenAI tool-call reasoning policy in measurement and emission', async () => {
    expect(
      await verify(
        [
          {
            ...toolRows[0],
            blocks: [
              { type: 'thinking', thought: 'private' },
              ...toolRows[0].blocks,
            ],
          },
          ...toolRows.slice(1),
        ],
        { 'reasoning.includeInContext': true },
      ),
    ).toBe(1);
  });
  it('filters empty assistant units before counting the native contribution', async () => {
    expect(
      await verify(
        [
          textRows[0],
          { speaker: 'ai', blocks: [{ type: 'text', text: '' }] },
          textRows[1],
        ],
        {},
        textRows,
      ),
    ).toBe(1);
  });
  it('flushes one tool unit of media without a scratch index or spool', async () => {
    expect(await verify(toolRows)).toBe(1);
  });
  it.each([false, true])(
    'preserves reasoning.includeInContext=%s',
    async (include) => {
      expect(
        await verify(
          [
            {
              speaker: 'ai',
              blocks: [
                { type: 'thinking', thought: 'private 雪' },
                { type: 'text', text: 'first' },
              ],
            },
            ...textRows,
          ],
          { 'reasoning.includeInContext': include },
        ),
      ).toBe(1);
    },
  );
});
