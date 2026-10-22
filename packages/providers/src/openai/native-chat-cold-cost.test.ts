/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { projectOpenAIChatPromptEnvelopeFromSource } from '../runtime/promptEnvelopeProjections.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';

const payload = 'fixed native cold payload 雪 '.repeat(32);
const logger = new DebugLogger('native-chat-cold-cost');

async function estimatePrepared(
  prepared: Awaited<ReturnType<typeof prepareRequest>>,
): Promise<number> {
  if (prepared.estimate === undefined)
    throw new Error('Missing native estimate');
  const projection = projectOpenAIChatPromptEnvelopeFromSource(
    prepared.estimate.projection,
    { model: 'gpt-4o', releaseIfUnsent: async () => undefined },
  );
  const result = await estimatePromptEnvelope(
    'openai',
    projection,
    createRuntimeTokenizerFactory(),
  );
  return result.estimatedPromptTokens;
}

describe('cold native Chat storage cost', () => {
  const directory = useTempDir('native-chat-cold-cost-');

  it.each([40, 400, 4000])(
    'prepares and estimates %s rows with bounded physical reads per row',
    async (size) => {
      const counter = { reads: 0 };
      const recording = JournalRecordingService.create({
        sessionId: `cost-${size}`,
        projectHash: 'cold-cost',
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
        for (let index = 0; index < size; index++)
          await history.addBatch([
            { speaker: 'human', blocks: [{ type: 'text', text: payload }] },
          ]);
        const rows = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          counter.reads = 0;
          const prepared = await prepareRequest(
            {
              contents: [],
              requestRows: rows,
              contentCount: rows.count,
              metadata: {},
              systemInstruction: 'system 雪',
              invocation: createRuntimeInvocationContext({
                runtimeId: 'cold-cost',
                providerName: 'openai',
                ephemeralsSnapshot: {},
              }),
              resolved: {
                model: 'gpt-4o',
                baseURL: 'https://example.test/v1',
                authToken: 'test',
              },
            },
            'gpt-4o',
            undefined,
            logger,
            'openai',
            undefined,
            {},
            true,
          );
          try {
            expect(prepared.spool.byteLength).toBe(size * 989 + 126);
            expect(counter.reads).toBeLessThanOrEqual(size * 10 + 100);
            expect(counter.reads).toBeLessThanOrEqual(size * 2 + 100);
            counter.reads = 0;
            expect(await estimatePrepared(prepared)).toBe(size * 200 + 15);
            expect(counter.reads).toBeLessThanOrEqual(size * 10 + 100);
            expect(counter.reads).toBeLessThanOrEqual(size * 2 + 100);
          } finally {
            await prepared.estimate?.projection.dispose();
            await prepared.release();
          }
        } finally {
          await rows.close();
        }
      } finally {
        await history.dispose();
        await recording.dispose();
      }
    },
  );
});
