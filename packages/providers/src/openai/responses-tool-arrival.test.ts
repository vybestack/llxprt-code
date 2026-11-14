/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { createCodexResponsesWebSocketTransport } from '../openai-responses/openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  options,
  request,
  type FakeSocket,
} from '../openai-responses/__tests__/openAIResponsesWebSocketTransport.test-helpers.js';
import { parseResponsesStream } from './parseResponsesStream.js';

import {
  pieces,
  expected,
  runDiskArrival,
} from '../__tests__/tool-arrival-fixture.js';

function responseEvents(
  gate: (index: number) => Promise<void>,
): ReadableStream<Uint8Array> {
  async function* events(): AsyncGenerator<object> {
    yield {
      type: 'response.output_item.added',
      item: {
        id: 'item_frozen',
        type: 'function_call',
        call_id: 'call_frozen',
        name: 'lookup',
        arguments: '',
      },
    };
    for (let index = 0; index < pieces.length; index++) {
      yield {
        type: 'response.function_call_arguments.delta',
        item_id: 'item_frozen',
        delta: pieces[index],
      };
      await gate(index);
    }
    yield {
      type: 'response.function_call_arguments.done',
      item_id: 'item_frozen',
      arguments: pieces.join(''),
    };
    yield { type: 'response.completed' };
  }
  const source = events();
  return new ReadableStream(
    {
      async pull(controller) {
        const next = await source.next();
        if (next.done === true) controller.close();
        else
          controller.enqueue(
            new TextEncoder().encode(`data: ${JSON.stringify(next.value)}\n\n`),
          );
      },
    },
    { highWaterMark: 0 },
  );
}

async function forwardFrames(
  source: ReadableStream<Uint8Array>,
  socket: FakeSocket,
): Promise<void> {
  const reader = source.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) return;
      socket.message(new TextDecoder().decode(next.value).slice(6).trim());
    }
  } catch (error) {
    socket.message(
      JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    reader.releaseLock();
  }
}

async function* websocketContent(
  source: ReadableStream<Uint8Array>,
): AsyncGenerator<IContent> {
  const harness = new SocketHarness([
    (socket) => {
      socket.open();
      socket.onSend = () => {
        void forwardFrames(source, socket);
      };
    },
  ]);
  const transport = createCodexResponsesWebSocketTransport({
    openSocket: harness.openSocket,
  });
  try {
    yield* transport.streamResponse(request(), options());
  } finally {
    transport.close();
  }
}

describe('Responses tool argument disk arrival', () => {
  for (const websocket of [false, true]) {
    it(`persists each prefix before completion and seals frozen parity (websocket=${websocket})`, async () => {
      expect(
        await runDiskArrival(
          (gate) =>
            websocket
              ? websocketContent(responseEvents(gate))
              : parseResponsesStream(responseEvents(gate)),
          false,
        ),
      ).toStrictEqual([expected]);
    });
    it(`rejects retaining arguments until completion (websocket=${websocket})`, async () => {
      await expect(
        runDiskArrival(
          (gate) =>
            websocket
              ? websocketContent(responseEvents(gate))
              : parseResponsesStream(responseEvents(gate)),
          true,
        ),
      ).rejects.toThrow('Argument disk-progress gate failed');
    });
  }
});
