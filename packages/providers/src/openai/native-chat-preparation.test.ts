/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { RowOwnership } from '@vybestack/llxprt-code-core/recording/rowOwnership.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { withChatHttpBody } from '../utils/chat-http-body.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import {
  prepareRequestBody,
  readSpooledChatBody,
} from './__tests__/support/prepareRequestBody.js';

const logger = new DebugLogger('native-chat-preparation');
function options(
  rows: ProviderRequestSelection,
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: rows,
    contentCount: rows.count,

    metadata: {},
    systemInstruction: 'system 雪',
    invocation: createRuntimeInvocationContext({
      runtimeId: 'native-chat-prepare',
      providerName: 'openai',
      ephemeralsSnapshot: {},
    }),
    resolved: {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      authToken: 'test',
    },
  };
}

async function pauseOwnedUnit(
  stream: ReadableStream<Uint8Array>,
  ownership: RowOwnership,
  mode: string,
  failure: Error,
): Promise<void> {
  const reader = stream.getReader();
  try {
    while (ownership.snapshot().acquisitions === 0) {
      const chunk = await reader.read();
      expect(chunk.done).toBe(false);
    }
    const paused = ownership.snapshot();
    expect(paused.acquisitions).toBe(1);
    expect(paused.liveRows).toBe(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(ownership.snapshot()).toMatchObject({
      acquisitions: 1,
      liveRows: 1,
      peakRows: 1,
    });
    if (mode === 'transport-error') throw failure;
    await reader.cancel();
  } finally {
    reader.releaseLock();
  }
}

describe('native Chat preparation ownership and planning', () => {
  const directory = useTempDir('native-chat-planning-');
  async function withHistory(
    size: number,
    consume: (
      history: HistoryService,
      counter: { reads: number },
    ) => Promise<void>,
  ): Promise<void> {
    const counter = { reads: 0 };
    const recording = JournalRecordingService.create({
      sessionId: `prepare-${size}`,
      projectHash: 'native-chat',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'openai',
      model: 'gpt-4o',
      journal: {
        journal: testJournalSeams({ readCounter: counter }, 1, false)
          .dependencies,
      },
    });
    const history = new HistoryService({ backend: 'journal', recording });
    try {
      await history.addBatch(
        Array.from({ length: size }, (_, index) => ({
          speaker: 'human',
          blocks: [{ type: 'text', text: `row-${index} 雪` }],
        })),
      );
      await consume(history, counter);
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  }

  it.each(['cancel', 'transport-error'])(
    'holds at most one source unit under backpressure and retires it on %s',
    async (mode) => {
      await withHistory(40, async (history) => {
        const ownership = new RowOwnership();
        const rows = await history.prepareCuratedForProviderSnapshot([], {
          ownership,
        });
        try {
          const prepared = await prepareRequest(
            options(rows),
            'gpt-4o',
            undefined,
            logger,
            'openai',
          );
          const failure = new Error('HTTP consumer stopped');
          try {
            const outcome = await withChatHttpBody(prepared.spool, (stream) =>
              pauseOwnedUnit(stream, ownership, mode, failure),
            ).then(
              () => undefined,
              (error: unknown) => error,
            );
            expect(outcome).toBe(
              mode === 'transport-error' ? failure : undefined,
            );
            expect(ownership.snapshot().liveRows).toBe(0);
            expect(ownership.snapshot().peakRows).toBe(1);
          } finally {
            await prepared.release();
          }
        } finally {
          await rows.close();
        }
      });
    },
  );

  it.each([40, 4000])(
    'cold fills %s rows, then prepares and cancels unsent warm bodies with zero physical reads or files',
    async (size) => {
      await withHistory(size, async (history, counter) => {
        const cold = await history.prepareCuratedForProviderSnapshot([], {});
        counter.reads = 0;
        const first = await prepareRequest(
          options(cold),
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );
        expect(counter.reads).toBeGreaterThan(size);
        const length = first.spool.byteLength;
        await first.release();
        await cold.close();
        const warm = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          counter.reads = 0;
          const receipt = await operationFileCreates(async () => {
            const prepared = await prepareRequest(
              options(warm),
              'gpt-4o',
              undefined,
              logger,
              'openai',
            );
            expect(prepared.spool.byteLength).toBe(length);
            expect(counter.reads).toBe(0);
            await prepared.release();
            expect(counter.reads).toBe(0);
          }, true);
          expect(receipt).toStrictEqual({ files: [], directories: [] });
        } finally {
          await warm.close();
        }
      });
    },
  );

  it('keys repeated preparation by captured reasoning settings against the old converter', async () => {
    await withHistory(2, async (history) => {
      const assistant = {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'reason 雪' },
          { type: 'text', text: 'answer' },
        ],
      } satisfies import('@vybestack/llxprt-code-core/services/history/IContent.js').IContent;
      history.add(assistant);
      const rows = await history.prepareCuratedForProviderSnapshot([], {});
      try {
        for (const includeInContext of [false, true]) {
          const input = {
            ...options(rows),
            invocation: createRuntimeInvocationContext({
              runtimeId: 'native-chat-reasoning-key',
              providerName: 'openai',
              ephemeralsSnapshot: {
                'reasoning.includeInContext': includeInContext,
              },
            }),
          };
          const old = await prepareRequestBody(
            {
              ...input,
              requestRows: rowsSelection([
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'row-0 雪' }],
                },
                {
                  speaker: 'human',
                  blocks: [{ type: 'text', text: 'row-1 雪' }],
                },
                assistant,
              ]),
            },
            'gpt-4o',
            undefined,
            logger,
            'openai',
          );
          const native = await prepareRequestBody(
            input,
            'gpt-4o',
            undefined,
            logger,
            'openai',
          );
          expect(native.requestBody).toStrictEqual(old.requestBody);
          expect(
            JSON.stringify(native.requestBody).includes('reasoning_content'),
          ).toBe(includeInContext);
        }
      } finally {
        await rows.close();
      }
    });
  });

  it('reuses a cold-filled pin for fresh byte-identical streams and repeated preparation', async () => {
    await withHistory(2, async (history) => {
      const rows = await history.prepareCuratedForProviderSnapshot([], {});
      try {
        const first = await prepareRequest(
          options(rows),
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );
        try {
          const handle = first.spool.openStream();
          const bytes = await new Response(handle.stream).arrayBuffer();
          await handle.dispose();
          const retry = first.spool.openStream();
          expect(await new Response(retry.stream).arrayBuffer()).toStrictEqual(
            bytes,
          );
          await retry.dispose();
          expect(bytes.byteLength).toBe(first.spool.byteLength);
          const repeated = await prepareRequest(
            options(rows),
            'gpt-4o',
            undefined,
            logger,
            'openai',
          );
          expect(repeated.spool.byteLength).toBe(bytes.byteLength);
          await repeated.release();
        } finally {
          await first.release();
        }
      } finally {
        await rows.close();
      }
    });
  });

  it('preserves the explicit old continuation route and the streamed test-helper contract', async () => {
    await withHistory(2, async (history) => {
      const rows = await history.prepareCuratedForProviderSnapshot([], {});
      try {
        const prepared = await prepareRequest(
          options(rows),
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );
        try {
          const continued = await prepared.continuation.build([
            {
              id: 'call_next',
              type: 'function',
              function: { name: 'lookup', arguments: '{}' },
            },
          ]);
          try {
            const body = readSpooledChatBody(continued.spool);
            expect(body.messages.slice(0, 3)).toStrictEqual([
              { role: 'system', content: 'system 雪' },
              { role: 'user', content: 'row-0 雪' },
              { role: 'user', content: 'row-1 雪' },
            ]);
            expect(body.messages.length).toBeGreaterThan(3);
          } finally {
            continued.release();
          }
        } finally {
          await prepared.release();
        }
        const read = await prepareRequestBody(
          options(rows),
          'gpt-4o',
          undefined,
          logger,
          'openai',
        );
        expect(read.messagesWithSystem).toStrictEqual([
          { role: 'system', content: 'system 雪' },
          { role: 'user', content: 'row-0 雪' },
          { role: 'user', content: 'row-1 雪' },
        ]);
      } finally {
        await rows.close();
      }
    });
  });
});
