/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
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
import { readPreparedChatBody } from './__tests__/support/prepareRequestBody.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { buildMessagesWithReasoning } from './OpenAIRequestBuilder.js';
import { oldMistralUnitTokens } from './__tests__/support/mistral-unit-token-oracle.js';
import { projectOpenAIChatPromptEnvelope } from '../runtime/promptEnvelopeProjections.js';
import { oldTailUnits } from '../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import { observeRowFormat } from './__tests__/support/observeRowFormat.js';
import type { ProviderRequestSelection } from '../../../core/src/services/history/provider-request-snapshot.js';

function observedRows(
  rows: ProviderRequestSelection,
  counts: { entries: number; units: number; formats: number },
): ProviderRequestSelection {
  const native = rows.native;
  if (native === undefined) throw new Error('Missing native cost input');
  return {
    count: rows.count,
    openReader: (signal) => rows.openReader(signal),
    readAt: (index, signal) => rows.readAt(index, signal),
    close: () => rows.close(),
    native: {
      ...native,
      withFormat: (registration, consume) => {
        counts.formats++;
        return native.withFormat(
          observeRowFormat(registration, (_entry, facts) => {
            if (facts.summary.kind !== 'chat')
              throw new Error('Missing measured Chat unit facts');
            counts.entries++;
            counts.units += facts.summary.thinkingRank?.units ?? 0;
          }),
          consume,
        );
      },
    },
  };
}

const marker = 'COLD_PAYLOAD_END_854';
const payload = `${'cold payload 雪 '.repeat(1800)}${marker}`;
const model = 'mistral-large-latest';
function rowAt(index: number, scenario: string): IContent {
  if (scenario === 'text')
    return { speaker: 'human', blocks: [{ type: 'text', text: payload }] };
  const id =
    scenario === 'collisions'
      ? ['4Q3rUlnAu', '4SftZvDMX'][Math.floor(index / 2) % 2]
      : `call-${Math.floor(index / 2)}`;
  return index % 2 === 0
    ? {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'reason 雪' },
          {
            type: 'tool_call',
            id,
            name: 'read',
            parameters: { text: payload },
          },
        ],
      }
    : {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: id,
            toolName: 'read',
            result: payload,
          },
        ],
      };
}

function requiredEstimate(
  prepared: Awaited<ReturnType<typeof prepareRequest>>,
): NonNullable<Awaited<ReturnType<typeof prepareRequest>>['estimate']> {
  if (prepared.estimate === undefined)
    throw new Error('Missing mandatory estimate');
  return prepared.estimate;
}

function recordCost(cost: Readonly<Record<string, string | number>>): void {
  const path = process.env['MISTRAL_COLD_RECEIPT'];
  if (path !== undefined)
    appendFileSync(path, `${JSON.stringify(cost)}${String.fromCharCode(10)}`);
}
async function checkContinuation(
  continuation: Awaited<
    ReturnType<
      Awaited<ReturnType<typeof prepareRequest>>['continuation']['build']
    >
  >,
): Promise<void> {
  try {
    await readPreparedChatBody(continuation.spool);
  } finally {
    await continuation.release();
  }
}

describe('native Mistral cold fill', () => {
  const directory = useTempDir('mistral-cold-fill-');
  const cases = ['text', 'tools', 'collisions'].flatMap((scenario) =>
    [40, 400, 4000].map((size) => ({ scenario, size })),
  );
  cases.forEach(({ scenario, size }) => {
    it(`reads each payload once before sending ${scenario} ${size} rows`, async () => {
      const seams = testJournalSeams({}, 1, false);
      let active = false;
      let reads = 0;
      let bytes = 0;
      let requestedBytes = 0;
      let payloadEnds = 0;
      let writes = 0;
      let writeBytes = 0;
      let requestedWriteBytes = 0;
      const counts = { entries: 0, units: 0, formats: 0 };
      const recording = JournalRecordingService.create({
        sessionId: `cold-${scenario}-${size}`,
        projectHash: 'cold-fill',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'openai',
        model,
        journal: {
          journal: {
            ...seams.dependencies,
            open: async (path, flags) => {
              const file = await seams.dependencies.open(path, flags);
              return {
                ...file,
                read: async (buffer, offset, length, position) => {
                  const result = await file.read(
                    buffer,
                    offset,
                    length,
                    position,
                  );
                  if (active) {
                    reads++;
                    requestedBytes += length;
                    bytes += result.bytesRead;
                    const text = Buffer.from(
                      buffer.buffer,
                      buffer.byteOffset + offset,
                      result.bytesRead,
                    ).toString();
                    payloadEnds += text.split(marker).length - 1;
                  }
                  return result;
                },
                writev: async (buffers, position) => {
                  const result = await file.writev(buffers, position);
                  if (active) {
                    writes++;
                    requestedWriteBytes += buffers.reduce(
                      (sum, buffer) => sum + buffer.byteLength,
                      0,
                    );
                    writeBytes += result.bytesWritten;
                  }
                  return result;
                },
              };
            },
          },
        },
      });
      const history = new HistoryService({ backend: 'journal', recording });
      try {
        for (let index = 0; index < size; index++)
          await history.addBatch([rowAt(index, scenario)]);
        const rows = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          active = true;
          const prepared = await prepareRequest(
            {
              contents: [],
              requestRows: observedRows(rows, counts),
              contentCount: rows.count,
              metadata: {},
              systemInstruction: 'system 雪',
              invocation: createRuntimeInvocationContext({
                runtimeId: 'cold-fill',
                providerName: 'openai',
                ephemeralsSnapshot: {
                  'reasoning.includeInContext': true,
                  'reasoning.stripFromContext': 'none',
                },
              }),
              resolved: {
                model,
                baseURL: 'https://api.mistral.ai/v1',
                authToken: 'test',
              },
            },
            model,
            undefined,
            new DebugLogger('cold-fill'),
            'openai',
            undefined,
            {},
            true,
          );
          try {
            const preparedUnits = counts.units;
            const projected = requiredEstimate(prepared);
            const estimate = await estimatePromptEnvelope(
              'openai',
              projectOpenAIChatPromptEnvelopeFromSource(projected.projection, {
                model,
                releaseIfUnsent: async () => undefined,
              }),
              createRuntimeTokenizerFactory(),
            );
            const continuation = await prepared.continuation.build([
              {
                id: 'next12345',
                type: 'function',
                function: { name: 'read', arguments: '{}' },
              },
            ]);
            active = false;
            recordCost({
              size,
              scenario,
              reads,
              requestedBytes,
              bytes,
              payloadEnds,
              writes,
              requestedWriteBytes,
              writeBytes,
              measuredEntries: counts.entries,
              measuredUnits: counts.units,
              formatRequests: counts.formats,
              estimateContinuationRemeasuredUnits: counts.units - preparedUnits,
            });
            expect(preparedUnits).toBeGreaterThan(0);
            expect(counts.units).toBe(preparedUnits);
            const body = await readPreparedChatBody(prepared.spool);
            const input = await oldTailUnits(
              Array.from({ length: size }, (_, index) =>
                rowAt(index, scenario),
              ),
              [],
            );
            expect(counts.units).toBe(input.length);
            expect(body.messages).toStrictEqual([
              { role: 'system', content: 'system 雪' },
              ...buildMessagesWithReasoning(
                [...input],
                {
                  invocation: {
                    ephemerals: {
                      'reasoning.includeInContext': true,
                      'reasoning.stripFromContext': 'none',
                    },
                  },
                },
                'mistral',
                undefined,
              ),
            ]);
            const envelope = await projectOpenAIChatPromptEnvelope({
              model,
              messages: [{ role: 'system', content: 'system 雪' }],
            }).legacyEstimate();
            expect(estimate.estimatedPromptTokens).toBe(
              envelope + (await oldMistralUnitTokens(input, 'none')),
            );
            await checkContinuation(continuation);
            expect(payloadEnds).toBeLessThanOrEqual(size);
          } finally {
            active = false;
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
    }, 180000);
  });
});
