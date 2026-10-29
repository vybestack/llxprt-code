/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { createServer } from 'node:http';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { DEFAULT_HTTP_JSON_ENVELOPE_BYTES } from '../utils/boundedJsonBody.js';
import { nativeJournalSendFixture } from './support/journal-send-fixture.js';
import {
  buildHistoryCallOptions,
  WIRE_ROUTES,
  rowsSelection,
} from './support/wireBodyCapture.js';
import { prepareRequestBody } from '../openai/__tests__/support/prepareRequestBody.js';
import {
  buildContinuationTail,
  type ContinuationToolCall,
} from '../openai/OpenAIRequestBuilder.js';

const calls: ContinuationToolCall[] = [
  {
    id: 'call_next',
    type: 'function',
    function: { name: 'lookup', arguments: '{"snow":"雪","ratio":1.25}' },
  },
];
const textRow = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});

describe('native continuation declared envelope refusal', () => {
  it.each(
    WIRE_ROUTES.filter(
      (item) =>
        item.id === 'openai-chat-plain' || item.id === 'openai-chat-mistral',
    ),
  )(
    'admits $id first near-limit body but refuses stored prefix plus tail before a second connection',
    async (route) => {
      const toolFormat =
        route.id === 'openai-chat-mistral' ? 'mistral' : 'openai';
      expect(DEFAULT_HTTP_JSON_ENVELOPE_BYTES).toBe(134217728);
      let connections = 0;
      let entries = 0;
      let received = 0;
      let declared = 0;
      const server = createServer((request, response) => {
        entries++;
        void (async (): Promise<void> => {
          for await (const chunk of request) {
            if (!Buffer.isBuffer(chunk))
              throw new Error('Expected socket bytes');
            received += chunk.byteLength;
          }
          declared = Number(request.headers['content-length']);
          const delta = {
            tool_calls: calls.map((call, index) => ({ index, ...call })),
          };
          response.writeHead(200, {
            'content-type': 'text/event-stream',
            connection: 'close',
          });
          response.end(
            `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
          );
        })().catch((error: unknown) =>
          response.destroy(
            error instanceof Error ? error : new Error(String(error)),
          ),
        );
      });
      server.on('connection', () => {
        connections++;
      });
      await new Promise<void>((resolve) =>
        server.listen(0, '127.0.0.1', resolve),
      );
      const address = server.address();
      if (address === null || typeof address === 'string')
        throw new Error('Missing local socket');
      const local = {
        ...route,
        baseURL: `http://127.0.0.1:${address.port}/v1`,
      };
      const input = {
        id: 'near-limit',
        description: 'bounded native units',
        rows: [],
        systemInstruction: 'system',
        ephemerals: { streaming: 'enabled' },
      };
      const smallOptions = buildHistoryCallOptions(
        local,
        input,
        'rows',
        new SettingsService(),
        rowsSelection([textRow('')]),
      );
      const old = await prepareRequestBody(
        {
          ...smallOptions,
          contents: [],
          metadata: {},
          invocation: createRuntimeInvocationContext({
            fetch: (input, init) => globalThis.fetch(input, init),
            runtimeId: 'refusal-oracle',
            providerName: 'openai',
            ephemeralsSnapshot: { streaming: 'enabled' },
          }),
          resolved: {
            model: route.model,
            baseURL: local.baseURL,
            authToken: 'test',
          },
        },
        route.model,
        undefined,
        new DebugLogger('continuation-refusal'),
        'openai',
      );
      const count = 2048;
      const target = DEFAULT_HTTP_JSON_ENVELOPE_BYTES - 128;
      const fixed =
        Buffer.byteLength(
          JSON.stringify({ ...old.requestBody, messages: [] }),
        ) +
        Buffer.byteLength(
          JSON.stringify({ role: 'system', content: 'system' }),
        );
      const perRow =
        Buffer.byteLength(JSON.stringify({ role: 'user', content: '' })) + 1;
      const totalText = target - fixed - count * perRow;
      const each = Math.floor(totalText / count);
      const remainder = totalText % count;
      expect(each).toBeLessThanOrEqual(64 * 1024);
      const tailBytes = buildContinuationTail(calls, toolFormat).reduce(
        (sum, message) => sum + 1 + Buffer.byteLength(JSON.stringify(message)),
        0,
      );
      expect(target + tailBytes).toBeGreaterThan(
        DEFAULT_HTTP_JSON_ENVELOPE_BYTES,
      );
      const fixture = await nativeJournalSendFixture(
        (function* (): Generator<IContent> {
          for (let index = 0; index < count; index++)
            yield textRow('x'.repeat(each + (index < remainder ? 1 : 0)));
        })(),
      );
      try {
        const options = buildHistoryCallOptions(
          local,
          input,
          'rows',
          new SettingsService(),
          fixture.selection,
        );
        let failure: unknown;
        try {
          for await (const chunk of route
            .createProvider()
            .generateChatCompletion(options))
            void chunk;
        } catch (error: unknown) {
          failure = error;
        }
        expect(received).toBe(target);
        expect(declared).toBe(target);
        expect(entries).toBe(1);
        expect(connections).toBe(1);
        expect(failure).toBeInstanceOf(RangeError);
        if (!(failure instanceof RangeError)) throw failure;
        expect(failure.message).toBe(
          `JSON request envelope exceeds ${DEFAULT_HTTP_JSON_ENVELOPE_BYTES} bytes (${target + tailBytes} bytes)`,
        );
      } finally {
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
          server.closeAllConnections();
        });
        await fixture.close();
      }
    },
  );
});
