/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: OpenAIResponsesProvider.projectPromptEnvelope must project
 * the SAME finalized request that transport sends (issue #2817 acceptance A5).
 *
 * Exercises the REAL provider preparation path (buildRequestContext) through
 * projectPromptEnvelope, proving the estimate reflects history, pending
 * content, instructions, and tools without rebuilding the payload outside
 * the provider.
 *
 * @requirement:REQ-PE-001 (issue #2817 acceptance A5, A10)
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { OpenAIResponsesProvider } from '../OpenAIResponsesProvider.js';
import {
  clearActiveProviderRuntimeContext,
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createProviderCallOptions } from '@vybestack/llxprt-code-core/test-utils/providerCallOptions.js';
import {
  estimatePromptEnvelope,
  type PromptEnvelopeEstimate,
} from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type {
  RuntimePromptEstimateRequest,
  RuntimeTokenizerFactory,
} from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeTokenizerFactory.js';

void vi.mock('openai', () => ({
  default: class FakeOpenAI {
    readonly responses = {
      create: vi.fn(async () => ({ output: [] })),
    };
  },
}));

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn(async () => 'core-prompt'),
}));

class TestResponsesProvider extends OpenAIResponsesProvider {
  constructor() {
    super('token-test', 'https://api.openai.com/v1');
  }

  protected override async getAuthToken(): Promise<string> {
    return 'token-test';
  }

  readonly promptAuthResolutions: string[] = [];

  protected override async getAuthTokenForPrompt(): Promise<string> {
    const token = `token-${this.promptAuthResolutions.length + 1}`;
    this.promptAuthResolutions.push(token);
    return token;
  }
}

function buildCallOptions(
  provider: OpenAIResponsesProvider,
  overrides: Parameters<typeof createProviderCallOptions>[0],
) {
  return createProviderCallOptions({
    providerName: provider.name,
    resolved: {
      model: 'gpt-4o',
      baseURL: 'https://api.openai.com/v1',
      telemetry: { providerName: provider.name },
    },
    ...overrides,
  });
}

function finalizedPromptLength(request: RuntimePromptEstimateRequest): number {
  const projection = request.finalizedProjection;
  if (
    typeof projection !== 'object' ||
    projection === null ||
    !('promptText' in projection) ||
    typeof projection.promptText !== 'string'
  ) {
    throw new Error('Expected a finalized provider prompt projection');
  }
  return projection.promptText.length;
}

function createLengthTokenizerFactory(): RuntimeTokenizerFactory {
  return {
    getTokenizer: () => undefined,
    estimatePrompt: async (request) => ({
      count: finalizedPromptLength(request),
      method: 'exact',
      family: 'projection-length-fixture',
      estimatorVersion: '1',
      assetRevision: 'fixture',
      projectionRevision: request.projectionRevision,
    }),
  };
}

function createRecordingFetch(
  transportedBodies: string[],
  authorizationHeaders: string[],
): typeof fetch {
  return async (_input, init): Promise<Response> => {
    const requestBody = init?.body;
    if (requestBody === undefined || requestBody === null) {
      throw new Error('Expected Responses transport to send a body');
    }
    transportedBodies.push(await new Response(requestBody).text());
    authorizationHeaders.push(
      new Headers(init?.headers).get('authorization') ?? '',
    );
    const encoder = new TextEncoder();
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(
          encoder.encode(
            'data: {"type":"response.completed","response":{"id":"r1","status":"completed"}}\n\n',
          ),
        );
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    return Promise.resolve(
      new Response(body, {
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
      }),
    );
  };
}

function requireIncrementalTokens(estimate: PromptEnvelopeEstimate): number {
  if (estimate.incrementalTokens === undefined) {
    throw new Error('Expected a stateful incremental estimate');
  }
  return estimate.incrementalTokens;
}

function createStatefulParentMetadata(
  promptTokens: number | undefined,
  completionTokens: number | undefined,
): {
  readonly id: string;
  readonly responsesStored: true;
  readonly usage?: {
    readonly promptTokens: number;
    readonly completionTokens: number;
    readonly totalTokens: number;
  };
} {
  if (promptTokens === undefined || completionTokens === undefined) {
    return { id: 'resp_1', responsesStored: true };
  }
  return {
    id: 'resp_1',
    responsesStored: true,
    usage: {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    },
  };
}

describe('OpenAIResponsesProvider.projectPromptEnvelope (issue #2817 A5)', () => {
  beforeEach(() => {
    setActiveProviderRuntimeContext(
      createProviderRuntimeContext({
        settingsService: new SettingsService(),
        runtimeId: 'openai-responses-envelope-test',
      }),
    );
  });

  afterEach(() => {
    clearActiveProviderRuntimeContext();
  });

  it('projects without resolving transport authentication', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        ],
      }),
    );

    expect(await projection.legacyEstimate()).toBeGreaterThan(0);
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('AC-1: reports equal transmitted and effective tokens for a stateless request', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
        ],
      }),
    );

    const estimate = await estimatePromptEnvelope(
      provider.name,
      projection,
      createLengthTokenizerFactory(),
    );

    expect(estimate.statefulParentUsed).toBe(false);
    expect(estimate.retainedBaselineTokens).toBe(0);
    expect(estimate.transmittedTokens).toBe(estimate.effectiveTokens);
    expect(estimate.estimatedPromptTokens).toBe(estimate.effectiveTokens);
  });

  it('AC-1: prefers a large provider-observed retained baseline to a deliberately smaller local replay without subtracting cached tokens', async () => {
    const provider = new TestResponsesProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'small question' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'small answer' }],
        metadata: {
          id: 'resp_1',
          responsesStored: true,
          usage: {
            promptTokens: 50_000,
            completionTokens: 0,
            totalTokens: 50_000,
            cachedTokens: 45_000,
          },
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'small follow up' }],
      },
    ];
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents,
        ephemerals: { 'responses-stateful': true },
      }),
    );
    const fullHistory = await provider.projectPromptEnvelope(
      buildCallOptions(provider, { contents }),
    );
    const factory = createLengthTokenizerFactory();

    const estimate = await estimatePromptEnvelope(
      provider.name,
      projection,
      factory,
    );
    const fullHistoryEstimate = await estimatePromptEnvelope(
      provider.name,
      fullHistory,
      factory,
    );
    const incrementalTokens = requireIncrementalTokens(estimate);

    expect(estimate.retainedBaselineTokens).toBe(50_000);
    expect(estimate.effectiveTokens).toBe(50_000 + incrementalTokens);
    expect(estimate.effectiveTokens).toBeGreaterThan(
      fullHistoryEstimate.effectiveTokens,
    );
  });

  it('includes nonzero parent completion usage without serializing complete local history', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'question' }] },
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'answer' }],
            metadata: {
              id: 'resp_with_completion',
              responsesStored: true,
              usage: {
                promptTokens: 700,
                completionTokens: 300,
                totalTokens: 1_000,
              },
            },
          },
          {
            speaker: 'human',
            blocks: [{ type: 'text', text: 'follow up' }],
          },
        ],
        configOverrides: {
          getEphemeralSettings: () => {
            throw new Error('retained local history was serialized');
          },
        },
        ephemerals: { 'responses-stateful': true },
      }),
    );

    const estimate = await estimatePromptEnvelope(
      provider.name,
      projection,
      createLengthTokenizerFactory(),
    );

    expect(estimate.retainedBaselineTokens).toBe(1_000);
  });

  it('counts current changed instructions and tools even though prior noncarried configuration may be conservatively overcounted', async () => {
    const provider = new TestResponsesProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'first question' }] },
      {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'first answer' }],
        metadata: {
          id: 'resp_before_configuration_change',
          responsesStored: true,
          usage: {
            promptTokens: 700,
            completionTokens: 300,
            totalTokens: 1_000,
          },
        },
      },
      {
        speaker: 'human',
        blocks: [{ type: 'text', text: 'use the changed configuration' }],
      },
    ];
    const configuredProjection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents,
        systemInstruction:
          'These current instructions must remain visible to the model.',
        tools: [
          {
            functionDeclarations: [
              {
                name: 'lookup_current_record',
                description:
                  'Look up a record under the current tool contract.',
                parametersJsonSchema: {
                  type: 'object',
                  properties: { id: { type: 'string' } },
                  required: ['id'],
                },
              },
            ],
          },
        ],
        ephemerals: { 'responses-stateful': true },
      }),
    );
    const plainProjection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents,
        ephemerals: { 'responses-stateful': true },
      }),
    );
    const factory = createLengthTokenizerFactory();

    const configuredEstimate = await estimatePromptEnvelope(
      provider.name,
      configuredProjection,
      factory,
    );
    const plainEstimate = await estimatePromptEnvelope(
      provider.name,
      plainProjection,
      factory,
    );
    const configuredIncrementalTokens =
      requireIncrementalTokens(configuredEstimate);
    const plainIncrementalTokens = requireIncrementalTokens(plainEstimate);

    expect(configuredIncrementalTokens).toBe(
      configuredEstimate.transmittedTokens,
    );
    expect(configuredIncrementalTokens).toBeGreaterThan(plainIncrementalTokens);
  });

  it.each([
    ['missing usage', undefined, undefined],
    ['negative prompt usage', -1, 20],
    ['fractional prompt usage', 1.5, 20],
    ['nonfinite prompt usage', Number.POSITIVE_INFINITY, 20],
    ['negative completion usage', 20, -1],
    ['fractional completion usage', 20, 1.5],
    ['nonfinite completion usage', 20, Number.POSITIVE_INFINITY],
  ])(
    'AC-1: falls back to complete model-visible local history for %s',
    async (_case, promptTokens, completionTokens) => {
      const provider = new TestResponsesProvider();
      const contents = [
        { speaker: 'human', blocks: [{ type: 'text', text: 'previous q' }] },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'previous a' }],
          metadata: createStatefulParentMetadata(
            promptTokens,
            completionTokens,
          ),
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'follow up' }],
        },
      ];
      const stateful = await provider.projectPromptEnvelope(
        buildCallOptions(provider, {
          contents,
          ephemerals: { 'responses-stateful': true },
        }),
      );
      const fullHistory = await provider.projectPromptEnvelope(
        buildCallOptions(provider, { contents }),
      );
      const factory = createLengthTokenizerFactory();
      const statefulEstimate = await estimatePromptEnvelope(
        provider.name,
        stateful,
        factory,
      );
      const fullHistoryEstimate = await estimatePromptEnvelope(
        provider.name,
        fullHistory,
        factory,
      );

      expect(statefulEstimate.statefulParentUsed).toBe(true);
      expect(statefulEstimate.effectiveTokens).toBe(
        fullHistoryEstimate.effectiveTokens,
      );
      expect(statefulEstimate.effectiveTokens).toBeGreaterThan(
        statefulEstimate.transmittedTokens,
      );
    },
  );

  it('AC-2: transports only the selected parent id and post-parent delta from a prepared envelope', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'previous q' }] },
        {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'previous a' }],
          metadata: {
            id: 'resp_1',
            responsesStored: true,
            usage: {
              promptTokens: 40_000,
              completionTokens: 100,
              totalTokens: 40_100,
            },
          },
        },
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'follow up' }],
        },
      ],
      ephemerals: { 'responses-stateful': true },
    });
    const projection = await provider.projectPromptEnvelope(options);
    const transportedBodies: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(createRecordingFetch(transportedBodies, []));

    try {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        // Drain the real provider stream.
      }
    } finally {
      global.fetch = originalFetch;
    }

    expect(projection.accounting?.statefulParentUsed).toBe(true);
    expect(transportedBodies).toHaveLength(1);
    expect(transportedBodies[0]).toContain('"previous_response_id":"resp_1"');
    expect(transportedBodies[0]).not.toContain('previous q');
    expect(transportedBodies[0]).not.toContain('previous a');
    expect(transportedBodies[0]).toContain('follow up');
  });

  it('identifies openai-responses protocol, responses/v1 method, and the model', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        {
          speaker: 'human',
          blocks: [{ type: 'text', text: 'Hello' }],
        },
      ],
    });

    const projection = await provider.projectPromptEnvelope(options);

    expect(projection.protocol).toBe('openai-responses');
    expect(projection.method).toBe('responses/v1');
    expect(projection.projectionRevision).toBe(3);
    expect(projection.model).toBe('gpt-4o');
  });

  it('counts more tokens for a larger conversation history', async () => {
    const provider = new TestResponsesProvider();

    const small = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          { speaker: 'human', blocks: [{ type: 'text', text: 'Hi' }] },
        ],
      }),
    );
    const large = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'text',
                text: 'Please explain in great detail the entire theory of relativity.',
              },
            ],
          },
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'text',
                text: 'The theory of relativity transformed our understanding of physics.',
              },
            ],
          },
        ],
      }),
    );

    const smallTokens = await small.legacyEstimate();
    const largeTokens = await large.legacyEstimate();
    expect(largeTokens).toBeGreaterThan(smallTokens);
  });

  it('counts more tokens when tools are declared', async () => {
    const provider = new TestResponsesProvider();
    const baseContents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const withoutTools = await provider.projectPromptEnvelope(
      buildCallOptions(provider, { contents: baseContents }),
    );
    const withTools = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        contents: baseContents,
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_weather',
                description: 'Get the weather for a city',
                parametersJsonSchema: {
                  type: 'object',
                  properties: { city: { type: 'string' } },
                },
              },
            ],
          },
        ],
      }),
    );

    const withoutTokens = await withoutTools.legacyEstimate();
    const withTokens = await withTools.legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('counts a longer system instruction as more finalized instructions', async () => {
    const provider = new TestResponsesProvider();
    const contents = [
      { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
    ];

    const baselineOptions = buildCallOptions(provider, { contents });
    const withoutInstruction = await provider.projectPromptEnvelope({
      ...baselineOptions,
      systemInstruction: 'Be brief.',
    });
    const withLongInstruction = await provider.projectPromptEnvelope({
      ...baselineOptions,
      systemInstruction:
        'Always answer with extensive detail, follow every formatting rule, explain assumptions, and avoid unsupported speculation in every response.',
    });

    const withoutTokens = await withoutInstruction.legacyEstimate();
    const withTokens = await withLongInstruction.legacyEstimate();
    expect(withTokens).toBeGreaterThan(withoutTokens);
  });

  it('resolves fresh authentication only when transporting the prepared body', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    const projection = await provider.projectPromptEnvelope(options);
    const transportedBodies: string[] = [];
    const authorizationHeaders: string[] = [];
    const originalFetch = global.fetch;
    global.fetch = vi.fn(
      createRecordingFetch(transportedBodies, authorizationHeaders),
    );

    try {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        // drain
      }
    } finally {
      global.fetch = originalFetch;
    }

    expect(provider.promptAuthResolutions).toStrictEqual(['token-1']);
    expect(authorizationHeaders).toStrictEqual(['Bearer token-1']);
    expect(transportedBodies).toHaveLength(1);
    expect(JSON.parse(transportedBodies[0])).toMatchObject({
      model: 'gpt-4o',
    });
  });

  it('fails fast when transport receives an unknown prepared token', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });

    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        promptEnvelopeTransportToken: Object.freeze({}),
      })) {
        // drain
      }
    };

    await expect(drain()).rejects.toThrow(
      'Unknown OpenAI Responses prompt-envelope transport token',
    );
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('requires fresh preparation when the prepared endpoint changes', async () => {
    const provider = new TestResponsesProvider();
    const options = buildCallOptions(provider, {
      contents: [
        { speaker: 'human', blocks: [{ type: 'text', text: 'Hello' }] },
      ],
    });
    const projection = await provider.projectPromptEnvelope(options);

    const drain = async (): Promise<void> => {
      for await (const _chunk of provider.generateChatCompletion({
        ...options,
        resolved: {
          ...options.resolved,
          baseURL: 'https://different.example/v1',
        },
        promptEnvelopeTransportToken: projection.transportToken,
      })) {
        // drain
      }
    };

    await expect(drain()).rejects.toThrow(
      /Projection\/transport endpoint mismatch/i,
    );
    expect(provider.promptAuthResolutions).toStrictEqual([]);
  });

  it('excludes unsupported media bytes from projected token counts', async () => {
    const provider = new TestResponsesProvider();
    const project = (data: string) =>
      provider.projectPromptEnvelope(
        buildCallOptions(provider, {
          contents: [
            {
              speaker: 'human',
              blocks: [
                {
                  type: 'media',
                  mimeType: 'audio/wav',
                  data,
                  encoding: 'base64',
                },
              ],
            },
          ],
        }),
      );

    const small = await project('AAAA');
    const large = await project('A'.repeat(100_000));

    expect(small.unsupportedMedia[0]?.mediaType).toBe('audio');
    expect(await large.legacyEstimate()).toBe(await small.legacyEstimate());
  });

  it('surfaces disabled PDFs and all unsupported substitutions structurally', async () => {
    const provider = new TestResponsesProvider();
    const projection = await provider.projectPromptEnvelope(
      buildCallOptions(provider, {
        ephemerals: { 'media.pdf.enabled': false },
        contents: [
          {
            speaker: 'human',
            blocks: [
              {
                type: 'media',
                mimeType: 'application/pdf',
                data: 'JVBERi0=',
                encoding: 'base64',
                filename: 'disabled.pdf',
              },
              {
                type: 'media',
                mimeType: 'audio/wav',
                data: 'AAAA',
                encoding: 'base64',
              },
              {
                type: 'media',
                mimeType: 'video/mp4',
                data: 'AAAA',
                encoding: 'base64',
              },
              {
                type: 'media',
                mimeType: 'application/octet-stream',
                data: 'AAAA',
                encoding: 'base64',
              },
            ],
          },
        ],
      }),
    );

    expect(
      projection.unsupportedMedia.map((entry) => entry.mediaType),
    ).toStrictEqual(['pdf', 'audio', 'video', 'unknown']);
  });
});
