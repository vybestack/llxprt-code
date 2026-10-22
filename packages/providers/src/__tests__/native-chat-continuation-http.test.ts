/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  setSystemTime,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import { createCorpus } from './support/wireBodyCorpus.js';
import { PINNED_CLOCK } from './support/wireBodyFixtures.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  installFakeTransport,
  type CapturedWireRequest,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';

const call = {
  id: 'call_current',
  type: 'function',
  function: { name: 'read_file', arguments: '{"path":"雪"}' },
};
function reply(second: boolean): Response {
  const delta = second
    ? { content: 'terminal 雪' }
    : { tool_calls: [{ index: 0, ...call }] };
  return new Response(
    `data: ${JSON.stringify({ id: 'chat-cont', object: 'chat.completion.chunk', model: 'gpt-4o', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'chat-cont', object: 'chat.completion.chunk', model: 'gpt-4o', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
const rows: IContent[] = [
  { speaker: 'human', blocks: [{ type: 'text', text: 'question 雪' }] },
  {
    speaker: 'ai',
    blocks: [
      { type: 'thinking', thought: 'secret 雪' },
      { type: 'text', text: 'earlier answer' },
    ],
  },
];
const corpus = await createCorpus();
const cases = [
  {
    id: 'reasoning-utf8',
    description: 'tool-only reply',
    rows,
    systemInstruction: 'system 雪',
  },
  ...corpus.histories,
];

describe('native Chat plain and Mistral routes', () => {
  afterAll(async () => {
    setSystemTime();
    await corpus.dispose();
  });
  WIRE_ROUTES.filter(
    (item) =>
      item.id === 'openai-chat-plain' || item.id === 'openai-chat-mistral',
  ).forEach((route) => {
    describe(`native ${route.id} continuation over actual HTTP`, () => {
      beforeAll(() => setSystemTime(new Date(PINNED_CLOCK)));
      for (const { history, strip } of cases.flatMap((history) =>
        ['none', 'all', 'allButLast'].map((strip) => ({ history, strip })),
      )) {
        it(`${history.id}/${strip} sends both old-converter bodies without operation files`, async () => {
          const input = {
            ...history,
            ephemerals: {
              ...('ephemerals' in history ? history.ephemerals : {}),
              streaming: 'enabled',
              'reasoning.includeInContext': true,
              'reasoning.stripFromContext': strip,
            },
          };
          const reference =
            'usesMediaReferences' in history &&
            history.usesMediaReferences === true;
          const provider = (): ReturnType<typeof route.createProvider> => {
            const created = route.createProvider();
            return reference
              ? bindProviderMedia(
                  created,
                  corpus.binding.resolver,
                  corpus.binding.budgetBytes,
                )
              : created;
          };
          const expected: CapturedWireRequest[] = [];
          let oraclePosts = 0;
          const restore = installFakeTransport(
            { ...route, respond: () => reply(oraclePosts++ !== 0) },
            expected,
          );
          try {
            const options = buildHistoryCallOptions(
              route,
              { ...input, rows: await normalizedRows(history.rows) },
              'rows',
              new SettingsService(),
            );
            for await (const chunk of provider().generateChatCompletion(
              options,
            ))
              void chunk;
          } finally {
            restore();
          }
          expect(expected).toHaveLength(2);
          let posts = 0;
          const sink = await localWireHashSink({
            ...route,
            respond: () => reply(posts++ !== 0),
          });
          const fixture = await journalSendFixture(history.rows, [], {
            directory: 'tmp/p6/chat-mistral-run-bj/fixtures',
            mediaStore: reference ? corpus.store : undefined,
          });
          const output: IContent[] = [];
          try {
            const options = buildHistoryCallOptions(
              sink.route,
              input,
              'rows',
              new SettingsService(),
              fixture.selection,
            );
            const receipt = await operationFileCreates(async () => {
              for await (const chunk of provider().generateChatCompletion(
                options,
              ))
                output.push(chunk);
            }, true);
            expect(receipt).toStrictEqual({ files: [], directories: [] });
            expect(sink.requests).toHaveLength(2);
            for (const [index, actual] of sink.requests.entries()) {
              const bytes = expected[index].bytes;
              expect(actual.contentLength).toBe(String(bytes.byteLength));
              expect(actual.bytes).toBe(bytes.byteLength);
              expect(actual.sha256).toBe(
                createHash('sha256').update(bytes).digest('hex'),
              );
            }
            const blocks = output.flatMap((chunk) => chunk.blocks);
            expect(
              blocks.filter((block) => block.type === 'tool_call'),
            ).toHaveLength(1);
            expect(
              blocks
                .flatMap((block) => (block.type === 'text' ? [block.text] : []))
                .join(''),
            ).toBe('terminal 雪');
          } finally {
            await sink.close();
            await fixture.close();
          }
        });
      }
    });
  });
});
