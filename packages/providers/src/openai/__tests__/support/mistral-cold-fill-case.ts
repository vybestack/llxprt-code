/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { JournalFileHandle } from '../../../../../core/src/journal/positionalFile.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { describe, expect, it } from 'bun:test';
import { appendFileSync } from 'node:fs';
import { oldTailUnits } from '../../../../../core/src/services/history/__tests__/support/tail-query-oracle.js';
import type { ProviderRequestSelection } from '../../../../../core/src/services/history/provider-request-snapshot.js';
import { createRuntimeTokenizerFactory } from '../../../composition/runtimeTokenizerFactory.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../../../runtime/promptEnvelopeProjections.js';
import { buildMessagesWithReasoning } from '../../OpenAIRequestBuilder.js';
import { prepareRequest } from '../../OpenAIRequestPreparation.js';
import { oldMistralUnitTokens } from './mistral-unit-token-oracle.js';
import { observeRowFormat } from './observeRowFormat.js';
import { readPreparedChatBody } from './prepareRequestBody.js';

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

type Scenario = 'text' | 'tools' | 'collisions';
type Prepared = Awaited<ReturnType<typeof prepareRequest>>;
interface ColdState {
  active: boolean;
  cost: {
    reads: number;
    bytes: number;
    requestedBytes: number;
    payloadEnds: number;
    writes: number;
    writeBytes: number;
    requestedWriteBytes: number;
  };
}

function observedFile(
  file: JournalFileHandle,
  state: ColdState,
): JournalFileHandle {
  return {
    ...file,
    read: async (buffer, offset, length, position) => {
      const result = await file.read(buffer, offset, length, position);
      if (state.active) {
        state.cost.reads++;
        state.cost.requestedBytes += length;
        state.cost.bytes += result.bytesRead;
        const text = Buffer.from(
          buffer.buffer,
          buffer.byteOffset + offset,
          result.bytesRead,
        ).toString();
        state.cost.payloadEnds += text.split(marker).length - 1;
      }
      return result;
    },
    writev: async (buffers, position) => {
      const result = await file.writev(buffers, position);
      if (state.active) {
        state.cost.writes++;
        state.cost.requestedWriteBytes += buffers.reduce(
          (sum, buffer) => sum + buffer.byteLength,
          0,
        );
        state.cost.writeBytes += result.bytesWritten;
      }
      return result;
    },
  };
}

function coldRecording(
  directory: string,
  scenario: Scenario,
  size: number,
  state: ColdState,
): JournalRecordingService {
  const seams = testJournalSeams({}, 1, false);
  return JournalRecordingService.create({
    sessionId: 'cold-' + scenario + '-' + size,
    projectHash: 'cold-fill',
    chatsDir: directory,
    workspaceDirs: [],
    provider: 'openai',
    model,
    journal: {
      journal: {
        ...seams.dependencies,
        open: async (path, flags) =>
          observedFile(await seams.dependencies.open(path, flags), state),
      },
    },
  });
}

function prepareCold(
  rows: ProviderRequestSelection,
  counts: { entries: number; units: number; formats: number },
): Promise<Prepared> {
  return prepareRequest(
    {
      contents: [],
      requestRows: observedRows(rows, counts),
      contentCount: rows.count,
      metadata: {},
      systemInstruction: 'system 雪',
      invocation: createRuntimeInvocationContext({
        fetch: (input, init) => globalThis.fetch(input, init),
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
}

async function assertColdOracle(
  prepared: Prepared,
  scenario: Scenario,
  size: number,
  units: number,
  estimatedPromptTokens: number,
): Promise<void> {
  const body = await readPreparedChatBody(prepared.spool);
  const input = await oldTailUnits(
    Array.from({ length: size }, (_, index) => rowAt(index, scenario)),
    [],
  );
  expect(units).toBe(input.length);
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
  expect(estimatedPromptTokens).toBe(
    envelope + (await oldMistralUnitTokens(input, 'none')),
  );
}

async function assertCold(
  prepared: Prepared,
  scenario: Scenario,
  size: number,
  state: ColdState,
  counts: { entries: number; units: number; formats: number },
): Promise<void> {
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
  state.active = false;
  recordCost({
    size,
    scenario,
    ...state.cost,
    measuredEntries: counts.entries,
    measuredUnits: counts.units,
    formatRequests: counts.formats,
    estimateContinuationRemeasuredUnits: counts.units - preparedUnits,
  });
  expect(preparedUnits).toBeGreaterThan(0);
  expect(counts.units).toBe(preparedUnits);
  await assertColdOracle(
    prepared,
    scenario,
    size,
    counts.units,
    estimate.estimatedPromptTokens,
  );
  await checkContinuation(continuation);
  expect(state.cost.payloadEnds).toBeLessThanOrEqual(size);
}

async function checkCold(
  directory: string,
  scenario: Scenario,
  size: number,
): Promise<void> {
  const state: ColdState = {
    active: false,
    cost: {
      reads: 0,
      bytes: 0,
      requestedBytes: 0,
      payloadEnds: 0,
      writes: 0,
      writeBytes: 0,
      requestedWriteBytes: 0,
    },
  };
  const counts = { entries: 0, units: 0, formats: 0 };
  const recording = coldRecording(directory, scenario, size, state);
  const history = new HistoryService({ recording });
  try {
    for (let index = 0; index < size; index++)
      await history.addBatch([rowAt(index, scenario)]);
    const rows = await history.prepareCuratedForProviderSnapshot([], {});
    try {
      state.active = true;
      const prepared = await prepareCold(rows, counts);
      try {
        await assertCold(prepared, scenario, size, state, counts);
      } finally {
        state.active = false;
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
}

export function mistralColdFill(scenario: Scenario): void {
  describe('native Mistral cold fill', () => {
    const directory = useTempDir('mistral-cold-fill-');
    [40, 400, 4000].forEach((size) => {
      it(`reads each payload once before sending ${scenario} ${size} rows`, async () => {
        await checkCold(directory(), scenario, size);
      }, 180000);
    });
  });
}
