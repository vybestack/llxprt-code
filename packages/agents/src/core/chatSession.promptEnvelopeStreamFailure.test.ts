/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Behavioral test: a streaming attempt that fails AFTER the first chunk must
 * clear its prompt-envelope estimate, exactly like an attempt that fails
 * before the first chunk (issue #2817 remediation).
 *
 * The design contract is that failed attempts clear the estimate while the
 * latest SUCCESSFUL estimate remains observable. `_sendProviderRequest`
 * returns the generator to the caller after the first chunk, so a mid-stream
 * provider disconnect never re-enters its try/catch and would otherwise leave
 * a failed attempt's estimate visible.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'bun:test';
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

/**
 * Provider whose stream yields one chunk and then throws, simulating a
 * provider disconnect after the caller already holds the generator.
 */
function createMidStreamFailingProvider(): IProvider {
  return {
    name: 'test-midstream-failing-provider',
    isDefault: true,
    getDefaultModel: () => 'test-model',
    getCurrentModel: () => 'test-model',
    getModels: () => Promise.resolve([]),
    async *generateChatCompletion(): AsyncIterableIterator<IContent> {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'partial' }],
      };
      throw new Error('provider disconnected mid-stream');
    },
    async projectPromptEnvelope(
      options: GenerateChatOptions,
    ): Promise<PromptEnvelopeProjection> {
      const serialized = JSON.stringify({ contents: options.contents });
      const tokenCount = Math.max(Math.ceil(serialized.length / 4), 1);
      return {
        model: 'test-model',
        protocol: 'anthropic-messages',
        method: 'messages/v1',
        projectionRevision: 1,
        unsupportedMedia: [],
        transportToken: Object.freeze({}),
        finalizedProjection: Object.freeze({}),
        legacyEstimate: () => Promise.resolve(tokenCount),
      };
    },
  };
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
    metadata: {
      ...runtimeSetup.runtime.metadata,
      promptEnvelopeEstimation: true,
    },
  };
  providerRuntime.setActiveProviderRuntimeContext(providerRuntimeSnapshot);

  return {
    mockConfig,
    runtimeState: createAgentRuntimeState({
      runtimeId: runtimeSetup.runtime.runtimeId,
      provider: 'test-midstream-failing-provider',
      model: 'test-model',
      sessionId: 'test-session-id',
    }),
    providerRuntimeSnapshot,
    historyService: new HistoryService(),
    mockContentGenerator: {
      generateContent: vi.fn(),
      generateContentStream: vi.fn(),
      countTokens: vi.fn().mockReturnValue(100),
      embedContent: vi.fn(),
    },
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

describe('ChatSession prompt-envelope estimate on mid-stream failure (issue #2817)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    providerRuntime.setActiveProviderRuntimeContext(null);
  });

  it('clears the estimate when the stream fails after the first chunk', async () => {
    const fixture = createTestFixture(createMidStreamFailingProvider());
    const chat = buildChatSession(fixture);

    const stream = await chat.sendMessageStream(
      { message: [{ text: 'Hello' }] },
      'prompt-midstream',
    );

    const iterator = stream[Symbol.asyncIterator]();
    const firstChunk = await iterator.next();
    expect(firstChunk.done).toBe(false);

    const estimateBeforeFailure = chat.getPromptEnvelopeEstimate();
    expect(estimateBeforeFailure).not.toBeNull();
    expect(estimateBeforeFailure?.estimatedPromptTokens).toBeGreaterThan(0);
    expect(estimateBeforeFailure?.protocol).toBe('anthropic-messages');

    await expect(
      (async () => {
        for (
          let next = await iterator.next();
          next.done !== true;
          next = await iterator.next()
        ) {
          // drain until the provider disconnects
        }
      })(),
    ).rejects.toThrow('provider disconnected mid-stream');

    expect(chat.getPromptEnvelopeEstimate()).toBeNull();
  });
});
