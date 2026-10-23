/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { testJournalSeams } from '@vybestack/llxprt-code-core/journal/__tests__/support/journalFixtures.js';
import { useTempDir } from '@vybestack/llxprt-code-core/journal/__tests__/support/useTempDir.js';
import { JournalRecordingService } from '@vybestack/llxprt-code-core/recording/journalRecordingService.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { RuntimeTokenizerFactory } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ProviderRequestSelection } from '@vybestack/llxprt-code-core/services/history/provider-request-snapshot.js';
import { suffixSeeder } from '@vybestack/llxprt-code-test-utils/core/history-suffix-test-helpers.js';
import { describe, expect, it } from 'bun:test';
import { operationFileCreates } from '../../../agents/src/compression/__tests__/support/operation-file-creates.js';
import { ProviderSourceEnforcer } from '../../../agents/src/compression/provider-source-enforcement.js';
import type { NormalizedGenerateChatOptions } from '../BaseProvider.js';
import { estimatorCorpus } from '../__tests__/support/estimatorCorpus.js';
import { normalizedRows } from '../__tests__/support/frozenWire/normalizedRows.js';
import { rowsSelection } from '../__tests__/support/wireBodyCapture.js';
import { createRuntimeTokenizerFactory } from '../composition/runtimeTokenizerFactory.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../runtime/promptEnvelopeProjections.js';
import { withGpt56DiskSources } from '../tokenizers/gpt56-disk-tokenizer-factory.js';
import { prepareRequest } from './OpenAIRequestPreparation.js';
import { mistralAcceptanceCases } from './__tests__/support/mistral-acceptance-cases.js';
import { assertMistralDomain } from './__tests__/support/mistral-domain-projection.js';
import type { MistralStrip } from './__tests__/support/mistral-unit-token-oracle.js';
import {
  prepareRequestBody,
  readPreparedChatBody,
} from './__tests__/support/prepareRequestBody.js';

const logger = new DebugLogger('native-chat-estimate-test');
const textRow = (text: string): IContent => ({
  speaker: 'human',
  blocks: [{ type: 'text', text }],
});
function options(
  rows: ProviderRequestSelection,
  model = 'gpt-4o',
  ephemerals: Record<string, unknown> = {},
): NormalizedGenerateChatOptions {
  return {
    contents: [],
    requestRows: rows,
    contentCount: rows.count,
    metadata: {},
    systemInstruction: 'system 雪',
    invocation: createRuntimeInvocationContext({
      runtimeId: 'native-estimate',
      providerName: 'openai',
      ephemeralsSnapshot: ephemerals,
    }),
    resolved: { model, baseURL: 'https://example.test/v1', authToken: 'test' },
  };
}
async function estimate(
  rows: ProviderRequestSelection,
  model = 'gpt-4o',
  ephemerals: Record<string, unknown> = {},
  factory: RuntimeTokenizerFactory = createRuntimeTokenizerFactory(),
  fixed: Pick<
    NormalizedGenerateChatOptions,
    'tools' | 'systemInstruction'
  > = {},
): Promise<number> {
  const prepared = await prepareRequest(
    { ...options(rows, model, ephemerals), ...fixed },
    model,
    undefined,
    logger,
    'openai',
    undefined,
    {},
    true,
  );
  try {
    const projected = prepared.estimate;
    if (projected === undefined)
      throw new Error('Missing mandatory native estimate');
    const projection = projectOpenAIChatPromptEnvelopeFromSource(
      projected.projection,
      { model, releaseIfUnsent: async () => undefined },
    );
    return (await estimatePromptEnvelope('openai', projection, factory))
      .estimatedPromptTokens;
  } finally {
    await prepared.estimate?.projection.dispose();
    await prepared.release();
  }
}
async function reference(
  rows: readonly IContent[],
  ephemerals: Record<string, unknown> = {},
  fixed: Pick<
    NormalizedGenerateChatOptions,
    'tools' | 'systemInstruction'
  > = {},
  model = 'gpt-4o',
): Promise<number> {
  const body = await prepareRequestBody(
    {
      ...options(rowsSelection(await normalizedRows(rows)), model, ephemerals),
      ...fixed,
    },
    model,
    undefined,
    logger,
    'openai',
  );
  return projectOpenAIChatPromptEnvelope(body.requestBody).legacyEstimate();
}

describe('stored native Chat estimates through production preparation', () => {
  const directory = useTempDir('native-chat-estimate-');
  async function withHistory(
    rows: readonly IContent[],
    consume: (
      history: HistoryService,
      counter: { reads: number },
    ) => Promise<void>,
  ): Promise<void> {
    const counter = { reads: 0 };
    const recording = JournalRecordingService.create({
      sessionId: 'estimate',
      projectHash: 'estimate',
      chatsDir: directory(),
      workspaceDirs: [],
      provider: 'openai',
      model: 'gpt-4o',
      journal: {
        journal: testJournalSeams({ readCounter: counter }, 1, false)
          .dependencies,
      },
    });
    const history = new HistoryService({ recording });
    try {
      await suffixSeeder(recording, history)(rows);
      await consume(history, counter);
    } finally {
      await history.dispose();
      await recording.dispose();
    }
  }

  it.each(
    mistralAcceptanceCases().flatMap((input) =>
      (['none', 'all', 'allButLast'] satisfies MistralStrip[]).map((strip) => ({
        input,
        strip,
      })),
    ),
  )(
    'matches independent old per-unit tokens and body for $input.id/$strip',
    async ({ input, strip }) => {
      await expect(
        assertMistralDomain(input, strip, { withHistory, estimate, options }),
      ).resolves.toBeUndefined();
    },
  );

  it.each(['none', 'all', 'allButLast'])(
    'remeasures historical lazy Mistral holders displaced by a pending reconstructed call under %s',
    async (strip) => {
      const base: readonly IContent[] = Array.from({ length: 3 }, () => ({
        speaker: 'ai',
        blocks: [{ type: 'tool_call', id: '', name: 'lookup', parameters: {} }],
      }));
      const tail: readonly IContent[] = [
        textRow('pending user'),
        {
          speaker: 'tool',
          blocks: [
            {
              type: 'tool_response',
              callId: '4Q3rUlnAu',
              toolName: 'lookup',
              result: 'done',
            },
          ],
        },
      ];
      const model = 'mistral-large-latest';
      const policy = {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      };
      const factory = createRuntimeTokenizerFactory();
      async function count(messages: readonly unknown[]): Promise<number> {
        const projection = projectOpenAIChatPromptEnvelope({ model, messages });
        return (await estimatePromptEnvelope('openai', projection, factory))
          .estimatedPromptTokens;
      }
      const old = await prepareRequestBody(
        options(
          rowsSelection(await normalizedRows([...base, ...tail])),
          model,
          policy,
        ),
        model,
        undefined,
        logger,
        'openai',
      );
      async function perUnits(messages: unknown): Promise<number> {
        if (!Array.isArray(messages)) throw new Error('Missing old messages');
        let tokens = await count([messages[0]]);
        for (const message of messages.slice(1))
          tokens +=
            (await count([message, message])) - (await count([message]));
        return tokens;
      }
      const expected = await perUnits(old.requestBody.messages);
      const oldBase = await prepareRequestBody(
        options(rowsSelection(await normalizedRows(base)), model, policy),
        model,
        undefined,
        logger,
        'openai',
      );
      const baseline = await perUnits(oldBase.requestBody.messages);
      expect(JSON.stringify(old.requestBody.messages)).toContain('RDWBIGMqO');
      await withHistory(base, async (history) => {
        const before = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          expect(await estimate(before, model, policy, factory)).toBe(baseline);
          const selected = await history.prepareCuratedForProviderSnapshot(
            tail,
            {},
          );
          try {
            const prepared = await prepareRequest(
              options(selected, model, policy),
              model,
              undefined,
              logger,
              'openai',
            );
            try {
              expect(await readPreparedChatBody(prepared.spool)).toStrictEqual(
                old.requestBody,
              );
            } finally {
              await prepared.release();
            }
            expect(await estimate(selected, model, policy, factory)).toBe(
              expected,
            );
            expect(await estimate(before, model, policy, factory)).toBe(
              baseline,
            );
          } finally {
            await selected.close();
          }
        } finally {
          await before.close();
        }
      });
    },
  );

  it.each(
    [40, 4000].flatMap((size) => [false, true].map((all) => ({ size, all }))),
  )(
    'measures only displaced holders among $size historical rows, all=$all',
    async ({ size, all }) => {
      const base: readonly IContent[] = Array.from(
        { length: size },
        (_, index) =>
          all || (index % Math.floor(size / 3) === 0 && index < size - 1)
            ? {
                speaker: 'ai',
                blocks: [
                  {
                    type: 'tool_call',
                    id: '',
                    name: `holder-${index}`,
                    parameters: {},
                  },
                ],
              }
            : textRow(`unaffected-${index}`),
      );
      const holders = base.filter((row) => row.speaker === 'ai').length;
      await withHistory(base, async (history) => {
        let projections: string[] = [];
        const actual = createRuntimeTokenizerFactory();
        const factory = withGpt56DiskSources(
          {
            ...actual,
            async estimatePrompt(request) {
              projections.push(JSON.stringify(request.finalizedProjection));
              return actual.estimatePrompt(request);
            },
          },
          directory(),
        );
        const old = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          const before = await estimate(
            old,
            'mistral-large-latest',
            {},
            factory,
          );
          projections = [];
          const neutral = await history.prepareCuratedForProviderSnapshot(
            [textRow('neutral pending')],
            {},
          );
          try {
            await estimate(neutral, 'mistral-large-latest', {}, factory);
            expect(
              projections.some(
                (value) =>
                  value.includes('holder-') || value.includes('unaffected-'),
              ),
            ).toBe(false);
          } finally {
            await neutral.close();
          }
          projections = [];
          const displaced = await history.prepareCuratedForProviderSnapshot(
            [
              {
                speaker: 'tool',
                blocks: [
                  {
                    type: 'tool_response',
                    callId: '4Q3rUlnAu',
                    toolName: 'pending',
                    result: 'done',
                  },
                ],
              },
            ],
            {},
          );
          try {
            await estimate(displaced, 'mistral-large-latest', {}, factory);
            expect(
              projections.filter((value) => value.includes('holder-')),
            ).toHaveLength(holders * 2);
            expect(
              projections.some((value) => value.includes('unaffected-')),
            ).toBe(false);
            expect(
              await estimate(old, 'mistral-large-latest', {}, factory),
            ).toBe(before);
          } finally {
            await displaced.close();
          }
        } finally {
          await old.close();
        }
      });
    },
  );

  it('keeps emitted old-pin salted IDs after replacement and reassigns the surviving call in the new pin', async () => {
    const holder: IContent = {
      speaker: 'ai',
      blocks: [
        { type: 'tool_call', id: '4SftZvDMX', name: 'holder', parameters: {} },
      ],
    };
    const survivor: IContent = {
      speaker: 'ai',
      blocks: [
        {
          type: 'tool_call',
          id: 'toolu_alpha-1',
          name: 'lookup',
          parameters: {},
        },
      ],
    };
    await withHistory([holder, survivor], async (history) => {
      const old = await history.prepareCuratedForProviderSnapshot([], {});
      const prepared = await prepareRequest(
        options(old, 'mistral-large-latest'),
        'mistral-large-latest',
        undefined,
        logger,
        'openai',
      );
      try {
        const oldExpected = await prepareRequestBody(
          options(
            rowsSelection(await normalizedRows([holder, survivor])),
            'mistral-large-latest',
          ),
          'mistral-large-latest',
          undefined,
          logger,
          'openai',
        );
        const first = await readPreparedChatBody(prepared.spool);
        expect(first).toStrictEqual(oldExpected.requestBody);
        expect(JSON.stringify(first)).toContain('4Uq1sY29c');
        await history.replaceAll([survivor]);
        const current = await history.prepareCuratedForProviderSnapshot([], {});
        const next = await prepareRequest(
          options(current, 'mistral-large-latest'),
          'mistral-large-latest',
          undefined,
          logger,
          'openai',
        );
        try {
          const expected = await prepareRequestBody(
            options(
              rowsSelection(await normalizedRows([survivor])),
              'mistral-large-latest',
            ),
            'mistral-large-latest',
            undefined,
            logger,
            'openai',
          );
          const body = await readPreparedChatBody(next.spool);
          expect(body).toStrictEqual(expected.requestBody);
          expect(JSON.stringify(body)).not.toContain('4Uq1sY29c');
          expect(JSON.stringify(body)).toContain('4SftZvDMX');
          expect(await readPreparedChatBody(prepared.spool)).toStrictEqual(
            oldExpected.requestBody,
          );
        } finally {
          await next.release();
          await current.close();
        }
      } finally {
        await prepared.release();
        await old.close();
      }
    });
  });

  it.each(
    estimatorCorpus().flatMap((input) =>
      ['none', 'all', 'allButLast'].map((strip) => ({ input, strip })),
    ),
  )(
    'estimates Mistral $input.id/$strip using the old mapped projection',
    async ({ input, strip }) => {
      const policy = {
        ...input.ephemerals,
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      };
      const fixed = {
        systemInstruction: input.systemInstruction ?? 'system 雪',
        tools: input.tools,
      };
      const expected = await reference(
        input.rows,
        policy,
        fixed,
        'mistral-large-latest',
      );
      await withHistory(input.rows, async (history) => {
        const selected = await history.prepareCuratedForProviderSnapshot(
          [],
          {},
        );
        try {
          const tokens = await estimate(
            selected,
            'mistral-large-latest',
            policy,
            createRuntimeTokenizerFactory(),
            fixed,
          );
          expect(tokens).toBeGreaterThan(0);
          expect(Math.abs(tokens - expected)).toBeLessThanOrEqual(
            Math.max(16, expected * 0.005),
          );
        } finally {
          await selected.close();
        }
      });
    },
  );

  it.each([40, 4000])(
    'estimates %s warm rows and a pending user without historical payload reads or operation files',
    async (size) => {
      const base = Array.from({ length: size }, (_, index) =>
        textRow(`row-${index} 雪`),
      );
      const pending = textRow(
        'new pending user with enough tokens to distinguish an omitted tail 雪',
      );
      const expected = await reference([...base, pending]);
      await withHistory(base, async (history, counter) => {
        const cold = await history.prepareCuratedForProviderSnapshot([], {});
        await estimate(cold);
        await cold.close();
        counter.reads = 0;
        const receipt = await operationFileCreates(async () => {
          const warm = await history.prepareCuratedForProviderSnapshot(
            [pending],
            {},
          );
          try {
            const tokens = await estimate(warm);
            expect(tokens).toBeGreaterThan(0);
            expect(Math.abs(tokens - expected)).toBeLessThanOrEqual(
              Math.max(16, expected * 0.005),
            );
            expect(counter.reads).toBe(0);
          } finally {
            await warm.close();
          }
        }, true);
        expect(receipt).toStrictEqual({ files: [], directories: [] });
      });
    },
  );

  it('updates active token measurements on append while preserving an old pin', async () => {
    const base = [textRow('before')];
    const added = textRow('appended text with distinguishable token cost 雪');
    await withHistory(base, async (history, counter) => {
      const old = await history.prepareCuratedForProviderSnapshot([], {});
      try {
        const before = await estimate(old);
        await history.addBatch([added]);
        await history.waitForCommit();
        const current = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          counter.reads = 0;
          const after = await estimate(current);
          expect(after).toBeGreaterThan(before);
          expect(counter.reads).toBe(0);
          expect(await estimate(old)).toBe(before);
        } finally {
          await current.close();
        }
      } finally {
        await old.close();
      }
    });
  });

  it.each(['none', 'all'])(
    'replaces an orphan response contribution under strip %s using pending results',
    async (strip) => {
      const call: IContent = {
        speaker: 'ai',
        blocks: [
          { type: 'thinking', thought: 'reasoning 雪' },
          {
            type: 'tool_call',
            id: 'call_x',
            name: 'lookup',
            parameters: { path: '雪' },
          },
        ],
      };
      const result: IContent = {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'call_x',
            toolName: 'lookup',
            result: 'long real response '.repeat(80),
          },
        ],
      };
      const policy = {
        'reasoning.includeInContext': true,
        'reasoning.stripFromContext': strip,
      };
      const expected = await reference([call, result], policy);
      await withHistory([call], async (history) => {
        const warm = await history.prepareCuratedForProviderSnapshot([], {});
        await estimate(warm, 'gpt-4o', policy);
        await warm.close();
        const selected = await history.prepareCuratedForProviderSnapshot(
          [result],
          {},
        );
        try {
          const tokens = await estimate(selected, 'gpt-4o', policy);
          expect(Math.abs(tokens - expected)).toBeLessThanOrEqual(
            Math.max(16, expected * 0.005),
          );
          expect(tokens).toBeGreaterThan(200);
        } finally {
          await selected.close();
        }
      });
    },
  );

  it('uses nonzero native estimates at the real compression policy boundary', async () => {
    const rows = [textRow('context budget '.repeat(200))];
    await withHistory(rows, async (history) => {
      const selected = await history.prepareCuratedForProviderSnapshot([], {});
      try {
        const tokens = await estimate(selected);
        const limits = {
          completionBudget: 20,
          limit: tokens + 1000,
          marginAdjustedLimit: tokens + 20,
          compressionThreshold: tokens + 20,
        };
        const atBoundary = new ProviderSourceEnforcer({
          limits,
          estimate: () => estimate(selected),
          getHistoryTokens: () => history.getTotalTokens(),
        });
        expect((await atBoundary.assess('initial')).next).toBe('send');
        const overBoundary = new ProviderSourceEnforcer({
          limits: { ...limits, compressionThreshold: tokens + 19 },
          estimate: () => estimate(selected),
          getHistoryTokens: () => history.getTotalTokens(),
        });
        expect((await overBoundary.assess('initial')).next).toBe('density');
        expect(
          (await overBoundary.assess('post-density-optimization')).next,
        ).toBe('compression');
      } finally {
        await selected.close();
      }
    });
  });

  it('refills instead of reusing facts when model or tokenizer revision changes', async () => {
    await withHistory(
      [textRow('model and tokenizer identity 雪')],
      async (history, counter) => {
        const selected = await history.prepareCuratedForProviderSnapshot(
          [],
          {},
        );
        const factory = createRuntimeTokenizerFactory();
        try {
          const before = await estimate(selected, 'gpt-4o', {}, factory);
          counter.reads = 0;
          expect(await estimate(selected, 'gpt-4o', {}, factory)).toBe(before);
          expect(counter.reads).toBe(0);
          const revision = withGpt56DiskSources(
            {
              ...factory,
              async estimatePrompt(request) {
                const result = await factory.estimatePrompt(request);
                return {
                  ...result,
                  count: result.count * 2,
                  estimatorVersion: `${result.estimatorVersion}-fixture-revision`,
                };
              },
            },
            directory(),
          );
          expect(await estimate(selected, 'gpt-4o', {}, revision)).toBe(
            before * 2,
          );
          expect(
            await estimate(selected, 'unregistered-model', {}, revision),
          ).toBe(before * 2);
        } finally {
          await selected.close();
        }
      },
    );
  });
  it.each(estimatorCorpus())(
    'matches the old eager token oracle for $id with captured system/tools and inline media',
    async (entry) => {
      const fixed = {
        systemInstruction: entry.systemInstruction,
        tools: entry.tools,
      };
      const policy = {
        ...entry.ephemerals,
        'reasoning.stripFromContext': 'none',
      };
      const expected = await reference(entry.rows, policy, fixed);
      await withHistory(entry.rows, async (history) => {
        const selected = await history.prepareCuratedForProviderSnapshot(
          [],
          {},
        );
        try {
          const tokens = await estimate(
            selected,
            'gpt-4o',
            policy,
            createRuntimeTokenizerFactory(),
            fixed,
          );
          expect(tokens).toBeGreaterThan(0);
          expect(Math.abs(tokens - expected)).toBeLessThanOrEqual(
            Math.max(16, expected * 0.005),
          );
        } finally {
          await selected.close();
        }
      });
    },
  );

  async function rejectsOriginal(
    result: Promise<unknown>,
    failure: Error,
  ): Promise<void> {
    await expect(result).rejects.toBe(failure);
  }

  it.each([
    { mode: 'abort', verify: rejectsOriginal },
    {
      mode: 'dispose',
      verify: async (result: Promise<unknown>): Promise<void> => {
        await expect(result).rejects.toThrow('projection is closed');
      },
    },
    { mode: 'tokenizer-failure', verify: rejectsOriginal },
  ])(
    'preserves scoped estimate failure behavior for $mode and permits a fresh pin',
    async ({ mode, verify }) => {
      await withHistory([textRow('failure lifecycle 雪')], async (history) => {
        const selected = await history.prepareCuratedForProviderSnapshot(
          [],
          {},
        );
        const controller = new AbortController();
        const failure = new Error('native estimator original failure');
        const prepared = await prepareRequest(
          {
            ...options(selected),
            metadata: { abortSignal: controller.signal },
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
          const projected = prepared.estimate;
          if (projected === undefined) throw new Error('Missing projection');
          const projection = projectOpenAIChatPromptEnvelopeFromSource(
            projected.projection,
            {
              model: 'gpt-4o',
              releaseIfUnsent: async () => undefined,
            },
          );
          const base = createRuntimeTokenizerFactory();
          const factory =
            mode === 'tokenizer-failure'
              ? withGpt56DiskSources(
                  {
                    ...base,
                    estimatePrompt: async () => {
                      throw failure;
                    },
                  },
                  directory(),
                )
              : base;
          if (mode === 'abort') controller.abort(failure);
          if (mode === 'dispose') await projected.projection.dispose();
          const result = estimatePromptEnvelope('openai', projection, factory);
          await verify(result, failure);
        } finally {
          await prepared.estimate?.projection.dispose();
          await prepared.release();
          await selected.close();
        }
        const next = await history.prepareCuratedForProviderSnapshot([], {});
        try {
          expect(await estimate(next)).toBeGreaterThan(0);
        } finally {
          await next.close();
        }
      });
    },
  );
});
