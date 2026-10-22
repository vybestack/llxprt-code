/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it, spyOn } from 'bun:test';
import { VersionSnapshot } from '@vybestack/llxprt-code-core/journal/versionSnapshot.js';
import { withNativePurgeFixture } from '../../../core/src/services/history/__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';
import { prepareRequest } from '../../../providers/src/openai/OpenAIRequestPreparation.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { createRuntimeTokenizerFactory } from '../../../providers/src/composition/runtimeTokenizerFactory.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../../../providers/src/runtime/promptEnvelopeProjections.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';

describe('native purge warm selected-view planning', () => {
  it.each([40, 4000])(
    'only reads changed source payloads at %i rows after cold format filling',
    async (size) => {
      await withNativePurgeFixture(async ({ history, session }) => {
        await history.detachedValues.replace(
          (async function* () {
            for (let index = 0; index < size; index++)
              yield {
                speaker: 'human' as const,
                blocks:
                  index === 0
                    ? [
                        { type: 'text' as const, text: 'kept' },
                        {
                          type: 'media' as const,
                          encoding: 'base64' as const,
                          mimeType: 'image/png',
                          data: 'aW1hZ2U=',
                        },
                      ]
                    : [{ type: 'text' as const, text: 'unchanged' }],
              };
          })(),
        );
        const original = await session.store.snapshot();
        const changedLabel = (await original.entryAt(0)).label;
        await original.close();
        const purge = new SemanticMediaPurgeSession({
          history,
          mode: () => 'remove',
          persist: async () => undefined,
        });
        const attempt = await purge.begin(false);
        if (attempt === undefined) throw new Error('Missing native purge');
        const override = streamSemanticPurgeRequest(attempt);
        if (override === undefined) throw new Error('Missing native view');
        const expectedBody = {
          model: 'gpt-4o',
          stream: false,
          messages: [
            { role: 'system', content: '' },
            ...Array.from({ length: size }, (_value, index) => ({
              role: 'user',
              content: index === 0 ? 'kept' : 'unchanged',
            })),
          ],
        };
        const expectedBytes = Buffer.byteLength(JSON.stringify(expectedBody));
        const expectedTokens =
          await projectOpenAIChatPromptEnvelope(expectedBody).legacyEstimate();
        const plan = async (): Promise<{ bytes: number; tokens: number }> => {
          const selection = await history.prepareCuratedForProviderSnapshot(
            [],
            {},
            override,
          );
          try {
            const prepared = await prepareRequest(
              {
                contents: [],
                requestRows: selection,
                contentCount: selection.count,
                metadata: {},
                invocation: createRuntimeInvocationContext({
                  runtimeId: 'purge-cost',
                  providerName: 'openai',
                  ephemeralsSnapshot: { streaming: 'disabled' },
                }),
                resolved: {
                  model: 'gpt-4o',
                  baseURL: 'https://example.test',
                  authToken: 'test',
                },
              },
              'gpt-4o',
              undefined,
              new DebugLogger('purge-cost'),
              'openai',
              undefined,
              {},
              true,
            );
            try {
              if (prepared.estimate === undefined)
                throw new Error('Missing mandatory estimate');
              const result = await estimatePromptEnvelope(
                'openai',
                projectOpenAIChatPromptEnvelopeFromSource(
                  prepared.estimate.projection,
                  { model: 'gpt-4o', releaseIfUnsent: async () => undefined },
                ),
                createRuntimeTokenizerFactory(),
              );
              return {
                bytes: prepared.spool.byteLength,
                tokens: result.estimatedPromptTokens,
              };
            } finally {
              await prepared.estimate?.projection.dispose();
              await prepared.release();
            }
          } finally {
            await selection.close();
          }
        };
        try {
          const cold = await plan();
          let unrelatedPayloadReads = 0;
          let changedPayloadReads = 0;
          const readRow = VersionSnapshot.prototype.readRow;
          const rowSpy = spyOn(
            VersionSnapshot.prototype,
            'readRow',
          ).mockImplementation(function (this: VersionSnapshot, entry) {
            if (entry.label === changedLabel) changedPayloadReads++;
            else unrelatedPayloadReads++;
            return readRow.call(this, entry);
          });
          const readBlock = VersionSnapshot.prototype.readBlock;
          const blockSpy = spyOn(
            VersionSnapshot.prototype,
            'readBlock',
          ).mockImplementation(function (this: VersionSnapshot, entry, index) {
            if (entry.label === changedLabel) changedPayloadReads++;
            else unrelatedPayloadReads++;
            return readBlock.call(this, entry, index);
          });
          try {
            const receipt = await operationFileCreates(async () => {
              const warm = await plan();
              expect(warm.bytes).toBe(expectedBytes);
              expect(warm.tokens).toBe(cold.tokens);
              expect(
                Math.abs(warm.tokens - expectedTokens),
              ).toBeLessThanOrEqual(16);
            }, true);
            expect(receipt).toStrictEqual({ files: [], directories: [] });
          } finally {
            rowSpy.mockRestore();
            blockSpy.mockRestore();
          }
          expect(cold.bytes).toBe(expectedBytes);
          expect(cold.tokens).toBeGreaterThan(0);
          expect(unrelatedPayloadReads).toBe(0);
          expect(changedPayloadReads).toBeGreaterThan(0);
          expect(changedPayloadReads).toBeLessThanOrEqual(30);
        } finally {
          await attempt.finalize();
        }
      });
    },
  );
});
