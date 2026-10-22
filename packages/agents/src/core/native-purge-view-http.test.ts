/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { bindProviderMedia } from '@vybestack/llxprt-code-core/runtime/bindProviderMedia.js';
import { RequestMediaResolver } from '@vybestack/llxprt-code-core/storage/request-media-resolver.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import { DebugLogger } from '@vybestack/llxprt-code-core/debug/index.js';
import { createRuntimeInvocationContext } from '@vybestack/llxprt-code-core/runtime/RuntimeInvocationContext.js';
import { buildCuratedHistory } from '@vybestack/llxprt-code-core/services/history/historyCuration.js';
import { estimatePromptEnvelope } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import { withNativePurgeFixture } from '../../../core/src/services/history/__tests__/support/native-purge-fixture.js';
import { SemanticMediaPurgeSession } from './semanticMediaPurgeSession.js';
import { streamSemanticPurgeRequest } from './streamRequestHelpers.js';
import { OpenAIProvider } from '../../../providers/src/openai/OpenAIProvider.js';
import { prepareRequest } from '../../../providers/src/openai/OpenAIRequestPreparation.js';
import { prepareRequestBody } from '../../../providers/src/openai/__tests__/support/prepareRequestBody.js';
import { normalizedRows } from '../../../providers/src/__tests__/support/frozenWire/normalizedRows.js';
import { rowsSelection } from '../../../providers/src/__tests__/support/wireBodyCapture.js';
import { createRuntimeTokenizerFactory } from '../../../providers/src/composition/runtimeTokenizerFactory.js';
import {
  projectOpenAIChatPromptEnvelope,
  projectOpenAIChatPromptEnvelopeFromSource,
} from '../../../providers/src/runtime/promptEnvelopeProjections.js';
import { operationFileCreates } from '../compression/__tests__/support/operation-file-creates.js';

async function withPendingMedia(
  admission: MediaAdmissionService,
  pending: readonly IContent[],
  context: Parameters<MediaAdmissionService['releaseContents']>[1],
  consume: () => Promise<void>,
): Promise<void> {
  try {
    await consume();
  } finally {
    await admission.releaseContents(pending, context);
  }
}

async function assertReclamation(
  store: import('@vybestack/llxprt-code-core/storage/local-media-store.js').LocalMediaStore,
  expected: number,
): Promise<void> {
  expect(
    (await store.reclaimUnreferenced(new Set(), Number.MAX_SAFE_INTEGER))
      .objectsRemoved,
  ).toBe(expected);
}

async function assertPreparedSend(
  provider: OpenAIProvider,
  options: import('../../../providers/src/BaseProvider.js').NormalizedGenerateChatOptions,
  expectedBody: unknown,
  expectedTokens: number,
): Promise<void> {
  const prepared = await prepareRequest(
    options,
    'gpt-4o',
    undefined,
    logger,
    'openai',
    undefined,
    {},
    true,
  );
  try {
    if (prepared.estimate === undefined)
      throw new Error('Missing mandatory estimate');
    const projected = projectOpenAIChatPromptEnvelopeFromSource(
      prepared.estimate.projection,
      {
        model: 'gpt-4o',
        releaseIfUnsent: async () => undefined,
      },
    );
    const tokens = (
      await estimatePromptEnvelope(
        'openai',
        projected,
        createRuntimeTokenizerFactory(),
      )
    ).estimatedPromptTokens;
    expect(tokens).toBeGreaterThan(0);
    expect(Math.abs(tokens - expectedTokens)).toBeLessThanOrEqual(16);
    expect(prepared.spool.byteLength).toBe(
      Buffer.byteLength(JSON.stringify(expectedBody)),
    );
  } finally {
    await prepared.estimate?.projection.dispose();
    await prepared.release();
  }
  for await (const chunk of provider.generateChatCompletion({
    ...options,
    contents: (async function* () {
      yield* options.contents;
    })(),
  }))
    void chunk;
}

const logger = new DebugLogger('purge-view-http');
const image = {
  type: 'media',
  mimeType: 'image/png',
  encoding: 'base64',
  data: 'aW1hZ2U=',
  caption: 'image summary',
} satisfies IContent['blocks'][number];
const ai = (thought: string): IContent => ({
  speaker: 'ai',
  blocks: [
    { type: 'thinking', thought },
    { type: 'text', text: 'answer' },
  ],
});
const call: IContent = {
  speaker: 'ai',
  blocks: [{ type: 'tool_call', id: 'x', name: 'read', parameters: {} }],
};
const response: IContent = {
  speaker: 'tool',
  blocks: [
    { type: 'tool_response', callId: 'x', toolName: 'read', result: 'result' },
  ],
};
const cases: ReadonlyArray<{
  name: string;
  rows: readonly IContent[];
  changed: number;
  tail: readonly IContent[];
}> = [
  {
    name: 'mixed',
    rows: [
      ai('old'),
      { speaker: 'human', blocks: [image, { type: 'text', text: 'survivor' }] },
      ai('last'),
    ],
    changed: 1,
    tail: [],
  },
  {
    name: 'media-only AI shifts thinking rank',
    rows: [ai('old'), { speaker: 'ai', blocks: [image] }, ai('last')],
    changed: 1,
    tail: [],
  },
  {
    name: 'empty AI after media purge is uncurated',
    rows: [
      ai('old'),
      { speaker: 'ai', blocks: [image, { type: 'thinking', thought: '' }] },
      ai('last'),
    ],
    changed: 1,
    tail: [],
  },
  {
    name: 'relocated tool media',
    rows: [
      call,
      { ...response, blocks: [image, ...response.blocks] },
      ai('last'),
    ],
    changed: 1,
    tail: [],
  },
  {
    name: 'cross-speaker response after media with duplicate and empty IDs',
    rows: [
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'question' }, ...call.blocks],
      },
      {
        speaker: 'ai',
        blocks: [
          ...call.blocks,
          { type: 'tool_call', id: '', name: 'empty', parameters: {} },
          { type: 'thinking', thought: 'thought' },
        ],
      },
      {
        speaker: 'human',
        blocks: [
          image,
          {
            type: 'tool_response',
            callId: 'x',
            toolName: 'read',
            result: 'short',
            isComplete: false,
          },
          { type: 'text', text: 'survivor' },
        ],
      },
      {
        speaker: 'tool',
        blocks: [
          {
            type: 'tool_response',
            callId: 'x',
            toolName: 'read',
            result: 'complete longer response',
            isComplete: true,
          },
          {
            type: 'tool_response',
            callId: '',
            toolName: 'empty',
            result: 'unattached',
          },
        ],
      },
    ],
    changed: 2,
    tail: [],
  },
  {
    name: 'pending response replaces best',
    rows: [
      call,
      { ...response, blocks: [image, ...response.blocks] },
      ai('last'),
    ],
    changed: 1,
    tail: [
      {
        ...response,
        blocks: [
          {
            type: 'tool_response',
            callId: 'x',
            toolName: 'read',
            result: 'longer complete result',
            isComplete: true,
          },
          image,
        ],
      },
    ],
  },
];

describe('native semantic purge selected-view HTTP', () => {
  const configurations = cases
    .flatMap((input) =>
      (['remove', 'summary'] as const).map((mode) => ({ input, mode })),
    )
    .flatMap((value) =>
      [false, true].map((explicit) => ({ ...value, explicit })),
    )
    .flatMap((value) =>
      [false, true].map((published) => ({ ...value, published })),
    )
    .flatMap((value) =>
      [false, true].map((reference) => ({ ...value, reference })),
    );
  configurations.forEach(({ input, mode, explicit, published, reference }) => {
    it(`${input.name} ${mode} reference=${reference} explicit=${explicit} published=${published} matches old bytes and estimates`, async () => {
      await withNativePurgeFixture(async ({ history, store }) => {
        const selectedImage = reference
          ? {
              ...(await store.admit({
                bytes: Buffer.from(image.data, 'base64'),
                mimeType: 'image/png',
                semanticMetadata: {},
              })),
              caption: image.caption,
            }
          : image;
        await history.replaceAll(
          input.rows.map((row) => ({
            ...row,
            blocks: row.blocks.map((block) =>
              block === image ? selectedImage : block,
            ),
          })),
        );
        const session = new SemanticMediaPurgeSession({
          history,
          mode: () => mode,
          persist: async () => undefined,
        });
        const attempt = await session.begin(explicit);
        if (attempt === undefined) throw new Error('Missing purge attempt');
        const override = streamSemanticPurgeRequest(attempt);
        if (override === undefined) throw new Error('Missing native override');
        if (published)
          await attempt.complete({
            status: 'success',
            usage: explicit
              ? {
                  promptTokens: 1,
                  completionTokens: 0,
                  totalTokens: 1,
                  cache_creation_input_tokens: 1,
                }
              : undefined,
            cacheWriteEvidence:
              attempt.preparedBoundary === undefined
                ? undefined
                : {
                    boundaryId: attempt.preparedBoundary.boundaryId,
                    preparation: 'added',
                  },
            retryHandoff: false,
          });
        const expectedRows = explicit
          ? input.rows
          : input.rows.flatMap((row, index) => {
              if (index !== input.changed) return [row];
              const blocks = row.blocks.flatMap((block) => {
                if (block !== image) return [block];
                if (mode === 'remove') return [];
                return [{ type: 'text' as const, text: image.caption }];
              });
              return blocks.length === 0 ? [] : [{ ...row, blocks }];
            });
        const expectedUnits = await normalizedRows([
          ...buildCuratedHistory(logger, expectedRows, false),
          ...input.tail,
        ]);
        const bodies: string[] = [];
        const lengths: number[] = [];
        const server = Bun.serve({
          hostname: '127.0.0.1',
          port: 0,
          async fetch(request): Promise<Response> {
            bodies.push(await request.text());
            lengths.push(Number(request.headers.get('content-length')));
            return Response.json({
              id: 'reply',
              object: 'chat.completion',
              created: 0,
              model: 'gpt-4o',
              choices: [
                {
                  index: 0,
                  message: { role: 'assistant', content: 'ok' },
                  finish_reason: 'stop',
                },
              ],
              usage: {
                prompt_tokens: 1,
                completion_tokens: 1,
                total_tokens: 2,
              },
            });
          },
        });
        const admission = new MediaAdmissionService(store);
        const admissionContext = {
          turnId: 'purge-view-pending',
          source: 'user-input',
          reservationOwnerScope: 'turn:purge-view-pending',
        };
        const pending = reference
          ? await admission.admitContents(input.tail, admissionContext)
          : input.tail;
        const baseURL = `http://127.0.0.1:${server.port}/v1`;
        const provider = bindProviderMedia(
          new OpenAIProvider('test', baseURL),
          new RequestMediaResolver(store),
          1024,
        );
        try {
          await withPendingMedia(
            admission,
            pending,
            admissionContext,
            async () => {
              for (const strip of ['none', 'all', 'allButLast']) {
                const selection =
                  await history.prepareCuratedForProviderSnapshot(
                    pending,
                    {},
                    override,
                  );
                const invocation = createRuntimeInvocationContext({
                  runtimeId: 'purge-view',
                  providerName: 'openai',
                  ephemeralsSnapshot: {
                    streaming: 'disabled',
                    'reasoning.includeInContext': true,
                    'reasoning.stripFromContext': strip,
                  },
                });
                if (published && strip === 'allButLast') {
                  await attempt.finalize();
                  await assertReclamation(store, 0);
                }
                const options = {
                  contents: [],
                  metadata: {},
                  requestRows: selection,
                  contentCount: selection.count,
                  systemInstruction: 'system',
                  invocation,
                  resolved: { model: 'gpt-4o', baseURL, authToken: 'test' },
                };
                const old = await prepareRequestBody(
                  { ...options, requestRows: rowsSelection(expectedUnits) },
                  'gpt-4o',
                  undefined,
                  logger,
                  'openai',
                );
                const expectedTokens = await projectOpenAIChatPromptEnvelope(
                  old.requestBody,
                ).legacyEstimate();
                try {
                  const receipt = await operationFileCreates(async () => {
                    await assertPreparedSend(
                      provider,
                      options,
                      old.requestBody,
                      expectedTokens,
                    );
                  }, true);
                  expect(receipt).toStrictEqual({
                    directories: [],
                    files: [],
                  });
                  expect(bodies[bodies.length - 1]).toBe(
                    JSON.stringify(old.requestBody),
                  );
                  expect(lengths[lengths.length - 1]).toBe(
                    Buffer.byteLength(JSON.stringify(old.requestBody)),
                  );
                } finally {
                  await selection.close();
                }
              }
            },
          );
          expect(bodies).toHaveLength(3);
          if (published && reference) {
            await history.waitForOwnershipSettlement();
            await assertReclamation(store, 1);
          }
        } finally {
          await server.stop(true);
          await attempt.finalize();
        }
      });
    });
  });
});
