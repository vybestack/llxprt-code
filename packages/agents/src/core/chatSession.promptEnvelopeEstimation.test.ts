/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral tests for prompt-envelope estimation at the final per-attempt
 * send seam (issue #2817).
 *
 * These tests exercise the REAL ChatSession → TurnProcessor code path. The
 * provider is the infrastructure-boundary test double; its projection uses a
 * deterministic serialized-length estimate so the tests can assert ChatSession
 * plumbing and finalized-send-seam behavior independently of provider tokenizers.
 *
 * Proves:
 * - A6: The pre-send estimate reflects history, pending content, system
 *   instruction, tools, and provider-added prompt material.
 * - A7: The estimate is produced at the final send seam and is observable
 *   via chat.getPromptEnvelopeEstimate().
 * - A8: After success, provider-reported promptTokens remain authoritative
 *   (HistoryService total is synced to the real value).
 */

import { advanceTimersByTimeAsync } from '@vybestack/llxprt-code-test-utils';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  onTestFinished,
} from 'bun:test';
import { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import * as providerRuntime from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createChatSessionRuntime } from '@vybestack/llxprt-code-core/test-utils/runtime.js';
import type {
  GenerateChatOptions,
  IProvider,
} from '@vybestack/llxprt-code-providers/IProvider.js';
import type { PromptEnvelopeProjection } from '@vybestack/llxprt-code-core/runtime/contracts/PromptEstimation.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { waitForCondition } from '../test-utils/eventLoop.js';

/**
 * A fake provider that implements projectPromptEnvelope by serializing the
 * finalized contents array (the same prompt-bearing structure transport
 * sends). The estimate therefore changes as history, pending, tools, and
 * instructions grow — exercising the REAL estimation seam.
 */
function createEstimatingProvider(
  overrides: {
    reportedPromptTokens?: number;
    systemPrompt?: string;
  } = {},
): {
  provider: IProvider;
  estimateHistory: number[];
} {
  const estimateHistory: number[] = [];
  const preparedEnvelopes = new WeakMap<object, string>();
  const reportedPromptTokens = overrides.reportedPromptTokens ?? 5000;
  const systemPrompt = overrides.systemPrompt;

  const provider: IProvider = {
    name: 'test-estimating-provider',
    isDefault: true,
    getDefaultModel: () => 'test-model',
    getCurrentModel: () => 'test-model',
    getModels: () => Promise.resolve([]),
    getServerTools: () => [],
    invokeServerTool: () => Promise.resolve(undefined),
    async *generateChatCompletion(
      options: GenerateChatOptions,
    ): AsyncIterableIterator<IContent> {
      const preparedPrompt =
        options.promptEnvelopeTransportToken === undefined
          ? undefined
          : preparedEnvelopes.get(options.promptEnvelopeTransportToken);
      if (preparedPrompt === undefined) {
        throw new Error(
          'transport did not receive the prepared prompt envelope',
        );
      }
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: preparedPrompt }],
        metadata: {
          usage: {
            promptTokens: reportedPromptTokens,
            cachedTokens: 400,
            completionTokens: 10,
            totalTokens: reportedPromptTokens + 10,
          },
        },
      };
    },
    async projectPromptEnvelope(
      options: GenerateChatOptions,
    ): Promise<PromptEnvelopeProjection> {
      const serialized = JSON.stringify({
        contents: options.contents,
        tools: options.tools,
        systemPrompt: systemPrompt ?? options.systemInstruction,
      });
      const tokenCount = Math.max(Math.ceil(serialized.length / 4), 1);
      const transportToken = Object.freeze({});
      estimateHistory.push(tokenCount);
      preparedEnvelopes.set(transportToken, serialized);
      return {
        model: 'test-model',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken,
        legacyEstimate: () => Promise.resolve(tokenCount),
      };
    },
  };

  return { provider, estimateHistory };
}

interface TestFixture {
  mockConfig: Config;
  runtimeState: AgentRuntimeState;
  providerRuntimeSnapshot: ProviderRuntimeContext;
  historyService: HistoryService;
  mockContentGenerator: {
    generateContent: ReturnType<typeof vi.fn>;
    generateContentStream: ReturnType<typeof vi.fn>;
    countTokens: ReturnType<typeof vi.fn>;
    embedContent: ReturnType<typeof vi.fn>;
  };
}

function createTestFixture(provider: IProvider): TestFixture {
  const providerManager = {
    getActiveProvider: vi.fn(() => provider),
  } as never;

  const runtimeSetup = createChatSessionRuntime({
    provider,
    providerManager,
    configOverrides: {
      getModel: vi.fn().mockReturnValue('test-model'),
      setModel: vi.fn(),
      getQuotaErrorOccurred: vi.fn().mockReturnValue(false),
      setQuotaErrorOccurred: vi.fn(),
      getEphemeralSettings: vi.fn().mockReturnValue({}),
      getEphemeralSetting: vi.fn().mockReturnValue(undefined),
      getProviderManager: vi.fn().mockReturnValue(providerManager),
    },
  });

  const mockConfig = runtimeSetup.config;
  const providerRuntimeSnapshot: ProviderRuntimeContext = {
    ...runtimeSetup.runtime,
    config: mockConfig,
  };
  providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

  if (
    'projectPromptEnvelope' in provider &&
    typeof provider.projectPromptEnvelope === 'function'
  ) {
    providerRuntimeSnapshot.metadata = {
      ...providerRuntimeSnapshot.metadata,
      promptEnvelopeEstimation: true,
    };
  }

  const mockContentGenerator = {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn().mockReturnValue(100),
    embedContent: vi.fn(),
  };

  const runtimeState = createAgentRuntimeState({
    runtimeId: runtimeSetup.runtime.runtimeId,
    provider: 'test-estimating-provider',
    model: 'test-model',
    sessionId: 'test-session-id',
  });

  const historyService = new HistoryService();

  return {
    mockConfig,
    runtimeState,
    providerRuntimeSnapshot,
    historyService,
    mockContentGenerator,
  };
}

function buildChatSession(fixture: TestFixture): ChatSession {
  const view = createAgentRuntimeContext({
    state: fixture.runtimeState,
    history: fixture.historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: false, target: null },
    },
    provider: createProviderAdapterFromManager(
      fixture.mockConfig.getProviderManager(),
    ),
    telemetry: createTelemetryAdapterFromConfig(fixture.mockConfig),
    tools: createToolRegistryViewFromRegistry(),
    providerRuntime: fixture.providerRuntimeSnapshot,
  });

  return new ChatSession(view, fixture.mockContentGenerator, {}, []);
}

describe('ChatSession prompt-envelope estimation (issue #2817)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    providerRuntime.setActiveProviderRuntimeContext(null);
  });

  it('A7: produces a pre-send estimate at the final send seam (non-streaming)', async () => {
    const { provider } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    expect(chat.getPromptEnvelopeEstimate()).toBeNull();

    await chat.sendMessage(
      { message: [{ text: 'Hello, tell me about AI.' }] },
      'test-prompt-1',
    );

    const estimate = chat.getPromptEnvelopeEstimate();
    expect(estimate).not.toBeNull();
    expect(estimate!.estimatedPromptTokens).toBeGreaterThan(0);
    expect(estimate!.model).toBe('test-model');
    expect(estimate!.protocol).toBe('anthropic-messages');
    expect(estimate!.method).toBe('messages/v1');
  });

  it('A6: a larger conversation history produces a larger estimate', async () => {
    const { provider, estimateHistory } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    await chat.sendMessage(
      { message: [{ text: 'Brief question.' }] },
      'prompt-small',
    );

    const smallEstimate = chat.getPromptEnvelopeEstimate();
    expect(smallEstimate).not.toBeNull();

    // Add substantial history before the next send
    for (let i = 0; i < 5; i++) {
      fixture.historyService.add(
        {
          speaker: 'human',
          blocks: [
            {
              type: 'text',
              text: `Question number ${i} with some additional context and detail.`,
            },
          ],
        },
        'test-model',
      );
      fixture.historyService.add(
        {
          speaker: 'ai',
          blocks: [
            {
              type: 'text',
              text: `Answer number ${i} with a thorough explanation of the topic.`,
            },
          ],
        },
        'test-model',
      );
    }

    await chat.sendMessage(
      { message: [{ text: 'Now answer another question.' }] },
      'prompt-large',
    );

    const largeEstimate = chat.getPromptEnvelopeEstimate();
    expect(largeEstimate).not.toBeNull();
    expect(largeEstimate!.estimatedPromptTokens).toBeGreaterThan(
      smallEstimate!.estimatedPromptTokens,
    );
    expect(estimateHistory.length).toBeGreaterThanOrEqual(2);
    expect(estimateHistory[estimateHistory.length - 1]).toBeGreaterThan(
      estimateHistory[0],
    );
  });

  it('A6: pending message content affects the estimate', async () => {
    const { provider, estimateHistory } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    await chat.sendMessage(
      { message: [{ text: 'Short message.' }] },
      'prompt-1',
    );
    const shortEstimate = chat.getPromptEnvelopeEstimate()!;

    await chat.sendMessage(
      {
        message: [
          {
            text: 'This is a significantly longer pending message that contains much more textual content and therefore should produce a higher token estimate because the projection serializes the finalized contents.',
          },
        ],
      },
      'prompt-2',
    );
    const longEstimate = chat.getPromptEnvelopeEstimate()!;

    expect(longEstimate.estimatedPromptTokens).toBeGreaterThan(
      shortEstimate.estimatedPromptTokens,
    );
    expect(estimateHistory[estimateHistory.length - 1]).toBeGreaterThan(
      estimateHistory[0],
    );
  });

  it('A8: provider-reported promptTokens remain authoritative after success', async () => {
    const reportedPromptTokens = 9999;
    const { provider, estimateHistory } = createEstimatingProvider({
      reportedPromptTokens,
    });
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    await chat.sendMessage({ message: [{ text: 'Hello' }] }, 'test-prompt');

    await fixture.historyService.waitForTokenUpdates();

    const actualTokens = fixture.historyService.getTotalTokens();
    // The provider's reported usage is authoritative for the total — not the
    // pre-send estimate, and not a derivation of cached tokens.
    expect(actualTokens).toBe(reportedPromptTokens);

    const estimate = chat.getPromptEnvelopeEstimate();
    expect(estimate).not.toBeNull();
    const estimateTokens = estimate!.estimatedPromptTokens;
    expect(estimateTokens).toBe(estimateHistory[estimateHistory.length - 1]);
    expect(actualTokens).not.toBe(estimateTokens);
  });

  it('A6: system instruction forwarded via ChatSession affects the estimate', async () => {
    const longSystemPrompt =
      'You are a detailed assistant with extensive instructions about how to behave in every situation including safety, formatting, tone, and content guidelines that span multiple paragraphs.';

    const baselineProvider = createEstimatingProvider();
    const baselineFixture = createTestFixture(baselineProvider.provider);
    const baselineChat = buildChatSession(baselineFixture);
    await baselineChat.sendMessage(
      { message: [{ text: 'Hello' }] },
      'prompt-baseline',
    );
    const baselineEstimate = baselineChat.getPromptEnvelopeEstimate()!;

    const { provider, estimateHistory } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);
    chat.setSystemInstruction(longSystemPrompt);

    await chat.sendMessage({ message: [{ text: 'Hello' }] }, 'prompt-1');

    const estimate = chat.getPromptEnvelopeEstimate();
    expect(estimate).not.toBeNull();
    expect(estimate!.estimatedPromptTokens).toBeGreaterThan(
      baselineEstimate.estimatedPromptTokens,
    );
    expect(estimateHistory.length).toBeGreaterThanOrEqual(1);
  });

  it('A6: tools in the request affect the estimate', async () => {
    const { provider, estimateHistory } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    await chat.sendMessage({ message: [{ text: 'Hello' }] }, 'prompt-1');
    const withoutToolsEstimate = chat.getPromptEnvelopeEstimate()!;

    const largeToolSet = [
      {
        functionDeclarations: Array.from({ length: 8 }, (_, i) => ({
          name: `tool_${i}`,
          description: `Tool number ${i} with a lengthy description that adds prompt material so the projected envelope grows. This tool performs an action relevant to the conversation and its schema is non-trivial.`,
          parametersJsonSchema: {
            type: 'object',
            properties: {
              arg: { type: 'string', description: `argument for tool ${i}` },
            },
          },
        })),
      },
    ];

    await chat.sendMessage(
      { message: [{ text: 'Hello' }], config: { tools: largeToolSet } },
      'prompt-with-tools',
    );
    const withToolsEstimate = chat.getPromptEnvelopeEstimate()!;

    expect(withoutToolsEstimate.estimatedPromptTokens).toBeGreaterThan(0);
    expect(withToolsEstimate.estimatedPromptTokens).toBeGreaterThan(
      withoutToolsEstimate.estimatedPromptTokens,
    );
    expect(estimateHistory.length).toBeGreaterThanOrEqual(2);
    expect(estimateHistory[estimateHistory.length - 1]).toBeGreaterThan(
      estimateHistory[0],
    );
  });

  it('A7: produces a pre-send estimate for streaming sends', async () => {
    const { provider } = createEstimatingProvider();
    const fixture = createTestFixture(provider);
    const chat = buildChatSession(fixture);

    expect(chat.getPromptEnvelopeEstimate()).toBeNull();

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'Stream me a haiku.' }] },
      'stream-prompt-1',
    );

    for await (const _chunk of stream) {
      // drain
    }

    const estimate = chat.getPromptEnvelopeEstimate();
    expect(estimate).not.toBeNull();
    expect(estimate!.estimatedPromptTokens).toBeGreaterThan(0);
    expect(estimate!.protocol).toBe('anthropic-messages');
  });

  it('A7: re-estimates each attempt so a materially changed retry gets a fresh estimate', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'Date'] });
    // Restore real timers even if an assertion below throws, so fake timers
    // cannot leak into subsequent tests.
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const estimateHistory: number[] = [];
    const transportedBodies: string[] = [];
    const preparedBodies = new WeakMap<object, string>();
    let preparationAttempt = 0;
    let attempt = 0;

    const retryingProvider: IProvider = {
      name: 'retrying-estimating-provider',
      isDefault: true,
      getDefaultModel: () => 'test-model',
      getCurrentModel: () => 'test-model',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        const token = options.promptEnvelopeTransportToken;
        const body =
          token === undefined ? undefined : preparedBodies.get(token);
        if (body === undefined) {
          throw new Error('retry transport did not consume a prepared body');
        }
        transportedBodies.push(body);
        attempt += 1;
        if (attempt === 1) {
          const transient: Error & { status?: number } = new Error(
            'upstream temporarily unavailable',
          );
          transient.status = 503;
          throw transient;
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Recovered response.' }],
          metadata: {
            usage: {
              promptTokens: 4242,
              completionTokens: 5,
              totalTokens: 4247,
            },
          },
        };
      },
      async projectPromptEnvelope(
        options: GenerateChatOptions,
      ): Promise<PromptEnvelopeProjection> {
        preparationAttempt += 1;
        const preparedBody = JSON.stringify({
          contents: options.contents,
          retryMaterial: 'x'.repeat(preparationAttempt * 40),
        });
        const tokenCount = Math.max(Math.ceil(preparedBody.length / 4), 1);
        const transportToken = Object.freeze({});
        preparedBodies.set(transportToken, preparedBody);
        estimateHistory.push(tokenCount);
        return {
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken,
          legacyEstimate: () => Promise.resolve(tokenCount),
        };
      },
    };

    const fixture = createTestFixture(retryingProvider);
    const chat = buildChatSession(fixture);

    const sendPromise = chat.sendMessage(
      { message: [{ text: 'Retry me.' }] },
      'retry-1',
    );

    // Advance past the default 5s retry backoff delay so no real wall-clock
    // time is consumed by the test.
    expect(await waitForCondition(() => attempt >= 1)).toBe(true);
    await advanceTimersByTimeAsync(10_000);
    await sendPromise;

    expect(attempt).toBeGreaterThanOrEqual(2);
    expect(estimateHistory.length).toBe(attempt);
    expect(estimateHistory[1]).toBeGreaterThan(estimateHistory[0]);
    expect(transportedBodies).toHaveLength(attempt);
    expect(transportedBodies[1]).not.toBe(transportedBodies[0]);
    expect(chat.getPromptEnvelopeEstimate()?.estimatedPromptTokens).toBe(
      estimateHistory.at(-1),
    );
  });

  it('fails fast before transport when finalized projection preparation fails', async () => {
    const failingProjectionProvider: IProvider = {
      name: 'failing-projection-provider',
      isDefault: true,
      getDefaultModel: () => 'test-model',
      getCurrentModel: () => 'test-model',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(
        _options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [
            { type: 'text', text: 'Response despite estimate failure.' },
          ],
        };
      },
      projectPromptEnvelope(): Promise<PromptEnvelopeProjection> {
        return Promise.reject(new Error('projection blew up'));
      },
    };

    const fixture = createTestFixture(failingProjectionProvider);
    const chat = buildChatSession(fixture);

    await expect(
      chat.sendMessage({ message: [{ text: 'Hello' }] }, 'estimate-failure'),
    ).rejects.toThrow('projection blew up');
  });

  it('returns null estimate when provider lacks projectPromptEnvelope', async () => {
    const providerWithoutEstimation: IProvider = {
      name: 'no-estimation-provider',
      isDefault: true,
      getDefaultModel: () => 'test-model',
      getCurrentModel: () => 'test-model',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(
        _options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Response.' }],
        };
      },
    };

    const fixture = createTestFixture(providerWithoutEstimation);
    const chat = buildChatSession(fixture);

    await chat.sendMessage({ message: [{ text: 'Hello' }] }, 'test-prompt');

    expect(chat.getPromptEnvelopeEstimate()).toBeNull();
  });

  it('clears the failed-request estimate when the provider call throws, preserving the prior authoritative token count (issue #2817)', async () => {
    const reportedPromptTokens = 1234;
    let attempt = 0;
    const failingThenRecoveringProvider: IProvider = {
      name: 'failing-call-provider',
      isDefault: true,
      getDefaultModel: () => 'test-model',
      getCurrentModel: () => 'test-model',
      getModels: () => Promise.resolve([]),
      getServerTools: () => [],
      invokeServerTool: () => Promise.resolve(undefined),
      async *generateChatCompletion(
        options: GenerateChatOptions,
      ): AsyncIterableIterator<IContent> {
        const token = options.promptEnvelopeTransportToken;
        if (token === undefined) {
          throw new Error('transport did not receive the prepared envelope');
        }
        attempt += 1;
        if (attempt === 1) {
          throw new Error('upstream provider exploded after estimation');
        }
        yield {
          speaker: 'ai',
          blocks: [{ type: 'text', text: 'Recovered response.' }],
          metadata: {
            usage: {
              promptTokens: reportedPromptTokens,
              completionTokens: 5,
              totalTokens: reportedPromptTokens + 5,
            },
          },
        };
      },
      async projectPromptEnvelope(
        options: GenerateChatOptions,
      ): Promise<PromptEnvelopeProjection> {
        const serialized = JSON.stringify(options.contents);
        const tokenCount = Math.max(Math.ceil(serialized.length / 4), 1);
        const transportToken = Object.freeze({});
        return {
          model: 'test-model',
          protocol: 'anthropic-messages',
          method: 'messages/v1',
          projectionRevision: 1,
          unsupportedMedia: [],
          transportToken,
          legacyEstimate: () => Promise.resolve(tokenCount),
        };
      },
    };

    const fixture = createTestFixture(failingThenRecoveringProvider);
    const chat = buildChatSession(fixture);

    await expect(
      chat.sendMessage({ message: [{ text: 'Boom' }] }, 'prompt-fails'),
    ).rejects.toThrow('upstream provider exploded after estimation');

    expect(chat.getPromptEnvelopeEstimate()).toBeNull();

    await chat.sendMessage(
      { message: [{ text: 'Now succeed' }] },
      'prompt-succeeds',
    );

    const estimate = chat.getPromptEnvelopeEstimate();
    expect(estimate).not.toBeNull();
    expect(estimate!.estimatedPromptTokens).toBeGreaterThan(0);

    await fixture.historyService.waitForTokenUpdates();
    expect(fixture.historyService.getTotalTokens()).toBe(reportedPromptTokens);
  });
});
