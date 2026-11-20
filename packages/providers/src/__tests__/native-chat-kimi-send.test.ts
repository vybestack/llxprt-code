/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { kimiHistories as histories } from './support/kimi-native-histories.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';
import {
  localWireHashSink,
  type HashedWireBody,
} from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  rowsSelection,
  WIRE_ROUTES,
  type WireRoute,
} from './support/wireBodyCapture.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';

function kimiRoute(): WireRoute {
  const found = WIRE_ROUTES.find((item) => item.id === 'openai-chat-kimi');
  if (found === undefined) throw new Error('Missing Kimi route');
  return found;
}
const route = kimiRoute();

const toolReply = (): Response =>
  Response.json({
    id: 'reply',
    object: 'chat.completion',
    created: 0,
    model: 'kimi-k3',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: null,
          tool_calls: [
            {
              id: 'call_next',
              type: 'function',
              function: { name: 'lookup', arguments: '{"value":1.25}' },
            },
          ],
        },
        finish_reason: 'stop',
      },
    ],
  });

const textReply = (): Response =>
  new Response(
    `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'done' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );

async function sendTwoRequests(
  selection: ProviderRequestSelection,
  strip: string,
): Promise<readonly HashedWireBody[]> {
  let posts = 0;
  const sink = await localWireHashSink({
    ...route,
    respond: () => (++posts === 1 ? toolReply() : textReply()),
  });
  try {
    const provider = route.createProvider();
    const options = buildHistoryCallOptions(
      sink.route,
      {
        id: 'kimi-native',
        description: 'native Kimi',
        rows: [],
        ephemerals: {
          'reasoning.stripFromContext': strip,
          'reasoning.includeInContext': true,
        },
      },
      'rows',
      new SettingsService(),
      selection,
    );
    for await (const chunk of provider.generateChatCompletion(options))
      void chunk;
    return [...sink.requests];
  } finally {
    await sink.close();
  }
}

describe('native Kimi production HTTP', () => {
  it.each(
    histories.flatMap((history) =>
      ['none', 'all', 'allButLast'].map((strip) => ({ history, strip })),
    ),
  )(
    'sends the initial and continuation bodies of $history.name/$strip as the old Kimi builder does, without files',
    async ({ history, strip }) => {
      const expectedRows = await normalizedRows([
        ...history.rows,
        ...history.pending,
      ]);
      const expected = await sendTwoRequests(
        rowsSelection(expectedRows),
        strip,
      );
      expect(expected).toHaveLength(2);
      const fixture = await journalSendFixture(history.rows, history.pending, {
        directory: 'tmp/kimi-native/fixtures',
      });
      try {
        let actual: readonly HashedWireBody[] = [];
        const created = await operationFileCreates(async () => {
          actual = await sendTwoRequests(fixture.selection, strip);
        }, true);
        expect(created).toStrictEqual({ files: [], directories: [] });
        expect(actual).toStrictEqual(expected);
        for (const request of actual)
          expect(request.contentLength).toBe(String(request.bytes));
      } finally {
        await fixture.close();
      }
    },
  );
});
