/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { isNetworkTransientError } from '@vybestack/llxprt-code-core/utils/retry.js';
import {
  createCodexResponsesWebSocketTransport,
  streamOverWebSocketOrFallback,
} from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  connectionLimitErrorFrame,
  drain,
  fallbackStream,
  frame,
  options,
  request,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

const prefixes = {
  text: [{ type: 'response.output_text.delta', delta: 'abandoned' }],
  tool: [
    {
      type: 'response.output_item.added',
      item: {
        type: 'function_call',
        id: 'item',
        call_id: 'abandoned',
        name: 'charge',
        arguments: '{}',
      },
    },
    {
      type: 'response.function_call_arguments.done',
      item_id: 'item',
      arguments: '{}',
    },
  ],
  overflow: [
    {
      type: 'response.reasoning_summary_text.delta',
      delta: 'x'.repeat(100_000),
    },
  ],
};

describe('published Responses lifecycle interruption', () => {
  it('preserves an unrelated 400 even when its message describes the lifecycle limit', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(
            frame({ type: 'response.output_text.delta', delta: 'partial' }),
          );
          socket.message(
            frame({
              type: 'error',
              status: 400,
              error: {
                type: 'invalid_request_error',
                code: 'another_code',
                message:
                  'Responses websocket connection limit reached (60 minutes). Create a new websocket connection to continue.',
              },
            }),
          );
        };
      },
    ]);
    const iterator = createCodexResponsesWebSocketTransport({
      openSocket: harness.openSocket,
    }).streamResponse(request(), options());
    await iterator.next();
    const rejection = await drain(iterator).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toMatchObject({ status: 400, code: 'another_code' });
    expect(isNetworkTransientError(rejection)).toBe(false);
    expect(rejection).not.toHaveProperty('cause');
    expect(harness.sockets).toHaveLength(1);
  });

  for (const [kind, prefix] of Object.entries(prefixes)) {
    it(`exposes a transient logical-turn error after ${kind}, without transport or HTTP replay`, async () => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            for (const event of prefix) socket.message(frame(event));
            socket.message(connectionLimitErrorFrame());
          };
        },
      ]);
      const fallback = { calls: 0 };
      const iterator = streamOverWebSocketOrFallback(
        createCodexResponsesWebSocketTransport({
          openSocket: harness.openSocket,
        }),
        request(),
        options(),
        fallbackStream('unsafe replay', fallback),
        undefined,
        undefined,
      );
      const published = await iterator.next();
      expect(published.done).toBe(false);
      const publishedTypes: Record<string, string> = {
        text: 'text',
        tool: 'tool_call',
        overflow: 'thinking',
      };
      expect(published.value?.blocks[0]?.type).toBe(publishedTypes[kind]);
      let rejection: unknown;
      try {
        await drain(iterator);
      } catch (error) {
        rejection = error;
      }

      expect(isNetworkTransientError(rejection)).toBe(true);
      expect(rejection).toMatchObject({
        name: 'StreamInterruptionError',
        details: {
          providerError: { code: 'websocket_connection_limit_reached' },
        },
        cause: {
          status: 400,
          code: 'websocket_connection_limit_reached',
          details: {
            providerError: {
              type: 'invalid_request_error',
              code: 'websocket_connection_limit_reached',
            },
          },
        },
      });
      expect(rejection).not.toHaveProperty('details.statefulConnectionRenewal');
      expect(harness.sockets).toHaveLength(1);
      expect(harness.sockets[0].sent).toHaveLength(1);
      expect(harness.sockets[0].closedByClient).toBe(true);
      expect(fallback.calls).toBe(0);
    });
  }
});
