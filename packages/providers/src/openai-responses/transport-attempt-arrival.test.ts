/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { declaredMediaTransportCapabilities } from '../providerMediaTransportCapabilities.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ResponseArrival } from '@vybestack/llxprt-code-core/services/history/history-response-arrival.js';
import type { DirectoryBlock } from '@vybestack/llxprt-code-core/journal/row-directory.js';
import { describe, expect, it } from 'bun:test';
import { createSessionRecorder } from '@vybestack/llxprt-code-core/recording/sessionRecorderFactory.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { openJournalReadOnly } from '@vybestack/llxprt-code-core/journal/journalReader.js';
import { TranscriptReader } from '@vybestack/llxprt-code-core/journal/transcript-reader.js';
import { sha256KeyHash } from '@vybestack/llxprt-code-core/journal/idKeys.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import {
  buildNormalizedOptions,
  captureResponsesTestRequest,
  executeResponsesTestRequest,
  type ResponsesTestDeps,
} from './responses-request.test-helpers.js';
import { createCodexResponsesWebSocketTransport } from './openAIResponsesWebSocketTransport.js';
import {
  SocketHarness,
  completingScript,
  connectionLimitErrorFrame,
  frame,
} from './__tests__/openAIResponsesWebSocketTransport.test-helpers.js';

async function appendContent(
  arrival: ResponseArrival,
  content: IContent,
): Promise<void> {
  if (content.toolArgumentDelta !== undefined)
    await arrival.appendToolArguments(content.toolArgumentDelta);
  else for (const block of content.blocks) await arrival.append(block);
}
async function blockText(
  blocks: AsyncIterable<DirectoryBlock>,
): Promise<string> {
  let text = '';
  for await (const block of blocks)
    for await (const part of block.parts())
      text += new TextDecoder().decode(part);
  return text;
}
const raw = {
  type: 'response.output_item.added',
  item: {
    type: 'function_call',
    id: 'same',
    call_id: 'abandoned',
    name: 'lookup',
    arguments: '{"lost":',
  },
};
const done = {
  type: 'response.completed',
  response: { id: 'successful', status: 'completed', output: [] },
};
function sse(events: readonly unknown[]): Response {
  return new Response(
    events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}
function deps(codex: boolean): ResponsesTestDeps {
  return {
    providerName: 'openai-responses',
    logger: new DebugLogger('test:attempt'),
    requestBaseURL: 'https://attempt.invalid/v1',
    requestHeaders: undefined,
    defaultModel: 'gpt-5',
    isCodexMode: () => codex,
    getCodexAccountId: async () => 'account',
    resolveAuthTokenForPrompt: async () => 'token',
    shouldRetryOnError: () => true,
    getUnallowedModelParameters: () => new Set<string>(),
  };
}
async function runArrival(
  chatsDir: string,
  codex: boolean,
  harness?: SocketHarness,
  stateful = false,
  result: 'text' | 'tool' = 'text',
  abandonedRaw = true,
): Promise<void> {
  const history = new HistoryService();
  const recording = createSessionRecorder({
    sessionId: 'attempts',
    projectHash: 'attempts',
    chatsDir,
    workspaceDirs: [],
    provider: 'test',
    model: 'test',
  });
  await history.attachJournal(recording);
  const arrival = await history.openResponseArrival({
    id: 'first',
    submissionId: 'prompt',
  });
  let attempts = 0;
  const transport =
    harness === undefined
      ? undefined
      : createCodexResponsesWebSocketTransport({
          openSocket: harness.openSocket,
        });
  const onTransportAttempt = async (): Promise<void> => {
    attempts++;
    await arrival.selectAttempt(
      attempts === 1 ? 'first' : `attempt-${attempts}`,
      'transport',
    );
  };
  const requestDeps = {
    ...deps(codex),
    getWebSocketTransport: () => transport,
    isWebSocketTransportActive: () => codex,
    getMediaTransportCapabilities: () =>
      declaredMediaTransportCapabilities(codex ? 'codex' : 'openai-responses'),
  };
  const normalized = buildNormalizedOptions({
    onTransportAttempt,
    ...(stateful
      ? {
          contents: [
            {
              speaker: 'ai',
              blocks: [{ type: 'text', text: 'parent' }],
              metadata: {
                id: 'dead-parent',
                responsesStored: true,
                providerBaseURL: 'https://chatgpt.com/backend-api/codex',
              },
            },
            { speaker: 'human', blocks: [{ type: 'text', text: 'next' }] },
          ],
        }
      : {}),
  });
  const request = captureResponsesTestRequest(normalized, requestDeps);
  try {
    for await (const content of executeResponsesTestRequest(
      request,
      requestDeps,
    )) {
      await appendContent(arrival, content);
    }
    await arrival.seal({});
    expect(attempts).toBe(2);
    const rows = await Array.fromAsync(history.streamRawHistory());
    expect(rows.flatMap((row) => row.blocks)).toStrictEqual(
      result === 'text'
        ? [{ type: 'text', text: 'recovered' }]
        : [
            {
              type: 'tool_call',
              id: 'recovered',
              name: 'lookup',
              parameters: { found: true },
            },
          ],
    );
    const path = history.journalPath();
    if (path === null) throw new Error('Missing journal');
    const file = await openJournalReadOnly(path);
    try {
      const reader = new TranscriptReader(file, sha256KeyHash);
      const entries = (
        await reader.page({ direction: 'forward', limit: 20 })
      ).filter((entry) => entry.attemptRef !== 0);
      expect(entries.map((entry) => entry.status)).toStrictEqual([5, 1]);
      const abandoned = entries[0];
      const text = await blockText(reader.blocks(abandoned));
      expect(text.includes('"parameters":{"lost":')).toBe(abandonedRaw);
    } finally {
      await file.close();
    }
  } finally {
    await arrival.interrupt('cancelled');
    transport?.close();
    await history.dispose();
    await recording.dispose();
  }
}

describe('transport identities before response arrival', () => {
  const directory = useTempDir('transport-arrival-');
  it('isolates raw HTTP arguments from a successful internal retry', async () => {
    const saved = globalThis.fetch;
    let sends = 0;
    globalThis.fetch = Object.assign(
      async (): Promise<Response> => {
        sends++;
        if (sends === 1)
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(`data: ${JSON.stringify(raw)}\n\n`),
                );
              },
              pull(controller) {
                controller.error(new TypeError('fetch failed'));
              },
            }),
          );
        return sse([
          { type: 'response.output_text.delta', delta: 'recovered' },
          done,
        ]);
      },
      { preconnect: saved.preconnect },
    );
    try {
      await runArrival(directory(), false);
      expect(sends).toBe(2);
    } finally {
      globalThis.fetch = saved;
    }
  });
  it.each(['empty', 'tool'])(
    'isolates HTTP retry with %s output',
    async (kind) => {
      const saved = globalThis.fetch;
      let sends = 0;
      globalThis.fetch = Object.assign(
        async (): Promise<Response> => {
          sends++;
          if (sends === 1 && kind === 'empty')
            throw new TypeError('fetch failed');
          if (sends === 1)
            return new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      `data: ${JSON.stringify(raw)}\n\n`,
                    ),
                  );
                },
                pull(controller) {
                  controller.error(new TypeError('fetch failed'));
                },
              }),
            );
          return kind === 'empty'
            ? sse([
                { type: 'response.output_text.delta', delta: 'recovered' },
                done,
              ])
            : sse([
                {
                  type: 'response.output_item.added',
                  item: {
                    type: 'function_call',
                    id: 'same',
                    call_id: 'recovered',
                    name: 'lookup',
                    arguments: '',
                  },
                },
                {
                  type: 'response.function_call_arguments.delta',
                  item_id: 'same',
                  delta: '{"found":true}',
                },
                {
                  type: 'response.function_call_arguments.done',
                  item_id: 'same',
                  arguments: '{"found":true}',
                },
                done,
              ]);
        },
        { preconnect: saved.preconnect },
      );
      try {
        await runArrival(
          directory(),
          false,
          undefined,
          false,
          kind === 'tool' ? 'tool' : 'text',
          kind !== 'empty',
        );
        expect(sends).toBe(2);
      } finally {
        globalThis.fetch = saved;
      }
    },
  );
  it('isolates raw WebSocket arguments from a fresh-connection retry', async () => {
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(frame(raw));
          socket.message(connectionLimitErrorFrame());
        };
      },
      completingScript('recovered'),
    ]);
    await runArrival(directory(), true, harness);
    expect(harness.sockets).toHaveLength(2);
  });
  it.each(['lifecycle', 'parent-not-found'])(
    'isolates a stateful socket attempt from parentless recovery (%s)',
    async (cause) => {
      const harness = new SocketHarness([
        (socket) => {
          socket.open();
          socket.onSend = () => {
            socket.message(frame(raw));
            socket.message(
              cause === 'lifecycle'
                ? connectionLimitErrorFrame()
                : frame({
                    type: 'error',
                    status: 400,
                    error: {
                      type: 'invalid_request_error',
                      message:
                        "Previous response with id 'dead-parent' not found",
                    },
                  }),
            );
          };
        },
        completingScript('recovered'),
      ]);
      await runArrival(directory(), true, harness, true);
      expect(harness.sockets[0].sent.join('')).toContain(
        '"previous_response_id":"dead-parent"',
      );
      expect(harness.sockets[1].sent.join('')).not.toContain(
        'previous_response_id',
      );
    },
  );
  it('isolates raw WebSocket arguments from the HTTP fallback', async () => {
    const saved = globalThis.fetch;
    globalThis.fetch = Object.assign(
      async (): Promise<Response> =>
        sse([{ type: 'response.output_text.delta', delta: 'recovered' }, done]),
      { preconnect: saved.preconnect },
    );
    const harness = new SocketHarness([
      (socket) => {
        socket.open();
        socket.onSend = () => {
          socket.message(frame(raw));
          socket.message(
            frame({
              type: 'error',
              message: 'unavailable',
              code: 'overloaded',
            }),
          );
        };
      },
    ]);
    try {
      await runArrival(directory(), true, harness);
      expect(harness.sockets).toHaveLength(1);
    } finally {
      globalThis.fetch = saved;
    }
  });
  it.each([false, true])(
    'prevents network sends when recording rejects (WebSocket=%s)',
    async (codex) => {
      const saved = globalThis.fetch;
      let sends = 0;
      globalThis.fetch = Object.assign(
        async (): Promise<Response> => {
          sends++;
          return sse([done]);
        },
        { preconnect: saved.preconnect },
      );
      const harness = new SocketHarness([completingScript('forbidden')]);
      const transport = createCodexResponsesWebSocketTransport({
        openSocket: harness.openSocket,
      });
      const requestDeps = {
        ...deps(codex),
        getWebSocketTransport: () => transport,
      };
      const normalized = buildNormalizedOptions({
        onTransportAttempt: async () => {
          throw new Error('recorder rejected');
        },
      });
      try {
        await expect(
          Array.fromAsync(
            executeResponsesTestRequest(
              captureResponsesTestRequest(normalized, requestDeps),
              requestDeps,
            ),
          ),
        ).rejects.toThrow('recorder rejected');
        expect([sends, harness.sockets.length]).toStrictEqual([0, 0]);
      } finally {
        transport.close();
        globalThis.fetch = saved;
      }
    },
  );
});
