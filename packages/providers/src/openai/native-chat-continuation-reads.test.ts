/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { RECORD_KIND } from '@vybestack/llxprt-code-core/journal/recordKinds.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { describe, expect, it } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import { projectOpenAIChatPromptEnvelopeFromSource } from '../runtime/promptEnvelopeProjections.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';

interface PhysicalRead {
  readonly path: string;
  readonly fd: number;
  readonly position: number;
  readonly requested: number;
  readonly returned: number;
}
const logger = new DebugLogger('last-thinking-physical-reads');
function countPayloadOverlaps(reads: readonly PhysicalRead[]): number {
  let overlaps = 0;
  for (const path of new Set(reads.map((read) => read.path))) {
    const file = readFileSync(path);
    for (let at = 64; at < file.length; ) {
      const kind = file[at];
      const end =
        at +
        24 +
        file.readUInt32LE(at + 4) +
        Number(file.readBigUInt64LE(at + 8));
      if (kind === RECORD_KIND.ROW || kind === RECORD_KIND.LENS)
        overlaps += reads.filter(
          (read) =>
            read.path === path &&
            read.position < end &&
            read.position + read.returned > at,
        ).length;
      at = end;
    }
  }
  return overlaps;
}
const results: unknown[] = [];
function options(
  rows: ProviderRequestSelection,
  model = 'gpt-4o',
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: rows,
    contentCount: rows.count,
    metadata: {},
    systemInstruction: 'system',
    invocation: createRuntimeInvocationContext({
      runtimeId: 'last-thinking-reads',
      providerName: 'openai',
      ephemeralsSnapshot: {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': 'allButLast',
      },
    }),
    resolved: {
      model,
      baseURL: 'https://example.test/v1',
      authToken: 'test',
    },
  };
}
async function prepareAndEstimate(
  rows: ProviderRequestSelection,
  model = 'gpt-4o',
): Promise<{ bytes: number; tokens: number }> {
  const prepared = await prepareRequest(
    options(rows, model),
    model,
    undefined,
    logger,
    'openai',
    undefined,
    {},
    true,
  );
  try {
    if (prepared.estimate === undefined)
      throw new Error('Missing native estimate');
    const projection = projectOpenAIChatPromptEnvelopeFromSource(
      prepared.estimate.projection,
      { model, releaseIfUnsent: async () => undefined },
    );
    const estimate = await estimatePromptEnvelope(
      'openai',
      projection,
      createRuntimeTokenizerFactory(),
    );
    return {
      bytes: prepared.spool.byteLength,
      tokens: estimate.estimatedPromptTokens,
    };
  } finally {
    await prepared.estimate?.projection.dispose();
    await prepared.release();
  }
}

async function buildMeasuredContinuation(
  prepared: Awaited<ReturnType<typeof prepareRequest>>,
): Promise<{ firstBytes: number; secondBytes: number }> {
  try {
    const continuation = await prepared.continuation.build([
      {
        id: 'call_current',
        type: 'function',
        function: { name: 'lookup', arguments: '{"ratio":1.25,"snow":"雪"}' },
      },
    ]);
    const result = {
      firstBytes: prepared.spool.byteLength,
      secondBytes: continuation.spool.byteLength,
    };
    await continuation.release();
    return result;
  } finally {
    await prepared.release();
  }
}

describe('stored continuation physical descriptor reads', () => {
  const directory = useTempDir('last-thinking-reads-');
  it.each(
    [40, 4000].flatMap((size) =>
      ['gpt-4o', 'mistral-large-latest'].map((model) => ({ size, model })),
    ),
  )(
    'captures $size/$model warm rows using metadata and builds the second body without prefix reads',
    async ({ size, model }) => {
      const reads: PhysicalRead[] = [];
      let observe = false;
      const seams = testJournalSeams({}, 1, false);
      const recording = JournalRecordingService.create({
        sessionId: `last-thinking-${size}`,
        projectHash: 'last-thinking',
        chatsDir: directory(),
        workspaceDirs: [],
        provider: 'openai',
        model: 'gpt-4o',
        journal: {
          journal: {
            ...seams.dependencies,
            async open(path, flags) {
              const handle = await seams.dependencies.open(path, flags);
              return {
                ...handle,
                async read(buffer, offset, length, position) {
                  const result = await handle.read(
                    buffer,
                    offset,
                    length,
                    position,
                  );
                  if (observe)
                    reads.push({
                      path,
                      fd: handle.fd,
                      position,
                      requested: length,
                      returned: result.bytesRead,
                    });
                  return result;
                },
              };
            },
          },
        },
      });
      const history = new HistoryService({ recording });
      try {
        const rows: IContent[] = Array.from({ length: size }, (_, index) =>
          index === 0 || index === Math.floor(size / 2)
            ? {
                speaker: 'ai',
                blocks: [
                  { type: 'thinking', thought: `reason-${index} `.repeat(20) },
                  { type: 'text', text: `answer-${index}` },
                ],
              }
            : {
                speaker: 'human',
                blocks: [{ type: 'text', text: `row-${index} 雪` }],
              },
        );
        await history.addBatch(rows);
        const first = await history.prepareCuratedForProviderSnapshot([], {});
        await prepareAndEstimate(first, model);
        await first.close();
        const warm = await history.prepareCuratedForProviderSnapshot(
          [{ speaker: 'human', blocks: [{ type: 'text', text: 'pending' }] }],
          {},
        );
        let planned: { firstBytes: number; secondBytes: number } | undefined;
        let captureReads: PhysicalRead[] = [];
        try {
          const receipt = await operationFileCreates(async () => {
            observe = true;
            try {
              const prepared = await prepareRequest(
                options(warm, model),
                model,
                undefined,
                logger,
                'openai',
              );
              captureReads = reads.splice(0);
              planned = await buildMeasuredContinuation(prepared);
            } finally {
              observe = false;
            }
          }, true);
          expect(receipt).toStrictEqual({ files: [], directories: [] });
        } finally {
          await warm.close();
        }
        expect(planned?.secondBytes).toBeGreaterThan(planned?.firstBytes ?? 0);
        expect(captureReads.length).toBeGreaterThan(0);
        expect(reads.length).toBeLessThanOrEqual(80);
        const payloadOverlaps = countPayloadOverlaps(reads);
        const capturePayloadOverlaps = countPayloadOverlaps(captureReads);
        results.push({
          size,
          model,
          interval:
            'After first selection/cold fills; warm prepareRequest capture interval separate from continuation.build and unsent release; excludes HTTP emission',
          planned,
          payloadOverlaps,
          capturePayloadOverlaps,
          captureRequestedBytes: captureReads.reduce(
            (sum, read) => sum + read.requested,
            0,
          ),
          secondRequestedBytes: reads.reduce(
            (sum, read) => sum + read.requested,
            0,
          ),
          captureReads,
          reads,
        });
        const output = process.env.CONTINUATION_READ_RECEIPT;
        if (output !== undefined)
          writeFileSync(
            output,
            JSON.stringify({ pid: process.pid, results }, null, 2),
          );
        expect(payloadOverlaps).toBe(0);
        expect(capturePayloadOverlaps).toBe(0);
        expect(reads).toHaveLength(0);
        expect(captureReads.length).toBeLessThanOrEqual(80);
      } finally {
        await history.dispose();
        await recording.dispose();
      }
    },
  );
});
