/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
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
