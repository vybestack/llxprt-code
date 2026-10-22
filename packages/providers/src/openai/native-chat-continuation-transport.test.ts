/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import OpenAI from 'openai';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { batchGate } from '@vybestack/llxprt-code-core/services/history/__tests__/support/addbatch-stream-test-helpers.js';
import { localWireHashSink } from '../__tests__/support/local-wire-hash-sink.js';
import { WIRE_ROUTES } from '../__tests__/support/wireBodyCapture.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import { executeSpooledStreamingChatRequest } from './OpenAIApiExecution.js';
import { withChatHttpBody } from '../utils/chat-http-body.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';

const route = WIRE_ROUTES.find((value) => value.id === 'openai-chat-plain');
if (route === undefined) throw new Error('Missing plain Chat route');
const logger = new DebugLogger('continuation-transport');
const calls = [
  {
    id: 'call_next',
    type: 'function' as const,
    function: { name: 'lookup', arguments: '{"value":1.25,"snow":"雪"}' },
  },
];
function options(
  selection: ProviderRequestSelection,
  baseURL: string,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    metadata: {},
    requestRows: selection,
    systemInstruction: 'system',
    invocation: createRuntimeInvocationContext({
      runtimeId: 'continuation-transport',
      providerName: 'openai',
      ephemeralsSnapshot: { streaming: 'enabled' },
    }),
    resolved: { model: 'gpt-4o', baseURL, authToken: 'test' },
  };
}
function reply(): Response {
  return new Response(
    `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const chunk of stream) void chunk;
}

async function failCallback(
  stream: ReadableStream<Uint8Array>,
  ownership: RowOwnership,
  baseURL: string,
  callbackFailure: Error,
): Promise<never> {
  const reader = stream.getReader();
  const prefix: Uint8Array[] = [];
  try {
    while (ownership.snapshot().liveRows === 0) {
      const next = await reader.read();
      if (next.done) throw new Error('No current unit admitted');
      prefix.push(next.value);
    }
    const response = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      body: Buffer.concat(prefix),
    });
    expect(response.status).toBe(500);
    throw callbackFailure;
  } finally {
    reader.releaseLock();
  }
}

describe('captured continuation transport failures', () => {
  it('retries the same second body over HTTP after clear and replacement without selecting the new history', async () => {
    const history = new HistoryService({ backend: 'journal' });
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'original history 雪' }],
      },
    ]);
    const selection = await history.prepareCuratedForProviderSnapshot([
      { speaker: 'human', blocks: [{ type: 'text', text: 'bounded pending' }] },
    ]);
    let posts = 0;
    const sink = await localWireHashSink({
      ...route,
      respond: () =>
        ++posts === 2
          ? Response.json(
              { error: { message: 'second HTTP failed' } },
              { status: 500 },
            )
          : reply(),
    });
    const prepared = await prepareRequest(
      options(selection, sink.route.baseURL),
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );
    const client = new OpenAI({
      apiKey: 'test',
      baseURL: sink.route.baseURL,
      maxRetries: 0,
    });
    try {
      await drain(
        await executeSpooledStreamingChatRequest(
          client,
          prepared.spool,
          undefined,
          undefined,
        ),
      );
      const continued = await prepared.continuation.build(calls);
      try {
        await history.clear();
        await history.addBatch([
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'replacement must not be sent' }],
          },
        ]);
        await expect(
          executeSpooledStreamingChatRequest(
            client,
            continued.spool,
            undefined,
            undefined,
          ),
        ).rejects.toMatchObject({ status: 500 });
        await drain(
          await executeSpooledStreamingChatRequest(
            client,
            continued.spool,
            undefined,
            undefined,
          ),
        );
        expect(sink.requests).toHaveLength(3);
        expect(sink.requests[1]).toStrictEqual(sink.requests[2]);
        expect((await selection.readAt(0)).blocks).toStrictEqual([
          { type: 'text', text: 'original history 雪' },
        ]);
      } finally {
        await continued.release();
      }
    } finally {
      await prepared.release();
      await selection.close();
      await sink.close();
      await history.dispose();
    }
  });

  it('preserves a failing HTTP callback and independent awaited source-close failure in order', async () => {
    const history = new HistoryService({ backend: 'journal' });
    await history.addBatch([
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'x'.repeat(64 * 1024) }],
      },
    ]);
    const ownership = new RowOwnership();
    const selection = await history.prepareCuratedForProviderSnapshot([], {
      ownership,
    });
    const closing = batchGate();
    const resume = batchGate();
    const closeFailure = new Error('second source close failed');
    const callbackFailure = new Error('second HTTP callback failed');
    let opened = 0;
    let closed = 0;
    const observed: ProviderRequestSelection = {
      ...selection,
      native: selection.native,
      async *openReader(signal) {
        opened++;
        const second = opened === 2;
        try {
          yield* selection.openReader(signal);
        } finally {
          if (second) {
            closing.resolve();
            await resume.promise;
            closed++;
            await Promise.reject(closeFailure);
          }
        }
      },
    };
    let posts = 0;
    const sink = await localWireHashSink({
      ...route,
      respond: () =>
        ++posts === 2
          ? Response.json(
              { error: { message: 'callback denied' } },
              { status: 500 },
            )
          : reply(),
    });
    const prepared = await prepareRequest(
      options(observed, sink.route.baseURL),
      'gpt-4o',
      undefined,
      logger,
      'openai',
    );
    const client = new OpenAI({
      apiKey: 'test',
      baseURL: sink.route.baseURL,
      maxRetries: 0,
    });
    try {
      await drain(
        await executeSpooledStreamingChatRequest(
          client,
          prepared.spool,
          undefined,
          undefined,
        ),
      );
      const continued = await prepared.continuation.build(calls);
      let settled = false;
      const sending = withChatHttpBody(continued.spool, (stream) =>
        failCallback(stream, ownership, sink.route.baseURL, callbackFailure),
      )
        .then(
          () => undefined,
          (error: unknown) => error,
        )
        .finally(() => {
          settled = true;
        });
      let cleanupFailure: unknown;
      try {
        await closing.promise;
        await Bun.sleep(0);
        expect(settled).toBe(false);
        expect(closed).toBe(0);
        resume.resolve();
        const error = await sending;
        expect(error).toBeInstanceOf(AggregateError);
        if (!(error instanceof AggregateError)) throw error;
        expect(error.cause).toBe(callbackFailure);
        expect(error.errors).toStrictEqual([callbackFailure, closeFailure]);
        expect(closed).toBe(1);
        expect(ownership.snapshot().liveRows).toBe(0);
        expect(sink.requests).toHaveLength(2);
      } finally {
        resume.resolve();
        await sending;
        cleanupFailure = await Promise.resolve(continued.release()).then(
          () => undefined,
          (error: unknown) => error,
        );
      }
      expect(cleanupFailure).toBeUndefined();
    } finally {
      resume.resolve();
      await prepared.release();
      await selection.close();
      await sink.close();
      await history.dispose();
    }
  });
});
