/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createHash } from 'node:crypto';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { journalSendFixture } from './support/journal-send-fixture.js';
import { localWireHashSink } from './support/local-wire-hash-sink.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  installFakeTransport,
  type CapturedWireRequest,
} from './support/wireBodyCapture.js';
import { normalizedRows } from './support/frozenWire/normalizedRows.js';

const route = WIRE_ROUTES.find((item) => item.id === 'openai-chat-plain');
if (route === undefined) throw new Error('Missing plain Chat route');
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

describe('native plain Chat continuation over actual HTTP', () => {
  for (const strip of ['none', 'all', 'allButLast']) {
    it(`sends both old-converter bodies without operation files for ${strip}`, async () => {
      const input = {
        id: 'continuation',
        description: 'tool-only reply',
        rows,
        systemInstruction: 'system 雪',
        ephemerals: {
          streaming: 'enabled',
          'reasoning.includeInContext': true,
          'reasoning.stripFromContext': strip,
        },
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
          { ...input, rows: await normalizedRows(rows) },
          'rows',
          new SettingsService(),
        );
        for await (const chunk of route
          .createProvider()
          .generateChatCompletion(options))
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
      const fixture = await journalSendFixture(rows, [], {
        directory: 'tmp/p6/chat-continuation-run-bh/fixtures',
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
          for await (const chunk of route
            .createProvider()
            .generateChatCompletion(options))
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
