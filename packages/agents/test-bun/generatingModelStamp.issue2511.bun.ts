/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #2511: model stamping must read the LIVE active provider at record
 * time, not the immutable AgentRuntimeState.model snapshot captured at
 * ChatSession construction. When a profile is loaded mid-session the snapshot
 * goes stale while the provider resolves the new model, so a freshly generated
 * AI turn would be persisted with the wrong model and misattributed on restore.
 *
 * These Bun-native tests build REAL objects (real Config, SettingsService,
 * HistoryService, AgentRuntimeContext, real ConversationManager / ChatSession)
 * on top of a stub provider whose getCurrentModel() reports a different model
 * than the runtime-state snapshot, and assert that the recorded AI turn is
 * stamped with the live provider model. They cover both stamping sites:
 *  - ConversationManager.recordHistory (3 tests, AC1/AC2/AC3), and
 *  - TurnProcessor._commitSendResult via a real ChatSession.sendMessage
 *    (2 tests, AC1/AC2 and the throw-fallback AC3).
 */

import { describe, it, expect } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import {
  createAgentRuntimeState,
  type AgentRuntimeState,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { emptyModelOutput } from '@vybestack/llxprt-code-core/llm-types/modelEnvelope.js';
import { ConversationManager } from '../src/core/ConversationManager.js';
import { ChatSession } from '../src/core/chatSession.js';
import { TestRuntimeProviderManager } from '../src/test-utils/runtimeProviderManager.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { createConfigParams } from '../src/core/chatSession-runtime-helpers.js';

const STALE_SNAPSHOT_MODEL = 'claude-opus-5';
const LIVE_PROVIDER_MODEL = 'glm-5.2';
const GENERATING_BASE_URL = 'https://api.anthropic.com';

/**
 * Controls the `getCurrentModel()` accessor on the registered stub provider.
 * - undefined: accessor is omitted entirely (structural absence).
 * - string: accessor returns that string.
 * - 'throw': accessor throws synchronously.
 */
interface LiveProviderOptions {
  liveModel?: string | 'throw';
}

function buildConversationManager(
  runtimeModel: string,
  baseURL: string | undefined,
  liveProvider?: LiveProviderOptions,
): {
  conversationManager: ConversationManager;
  historyService: HistoryService;
} {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');

  const providerRuntime: ProviderRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime.conversationManager.modelStamp',
    metadata: { source: 'generatingModelStamp.issue2511.bun' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: async () => [],
    getDefaultModel: () => runtimeModel,
    generateChatCompletion: async function* () {},
  };
  if (liveProvider?.liveModel === 'throw') {
    provider.getCurrentModel = (): string => {
      throw new Error('getCurrentModel exploded');
    };
  } else if (liveProvider?.liveModel !== undefined) {
    const live = liveProvider.liveModel;
    provider.getCurrentModel = (): string => live;
  }
  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-conversationManager-modelStamp',
    provider: provider.name,
    model: runtimeModel,
    sessionId: config.getSessionId(),
  });
  const historyService = new HistoryService();
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
      // Include thoughts so the recording path exercises the thought-block
      // attachment that the fix stamps.
      'reasoning.includeInContext': true,
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime },
  });

  const conversationManager = new ConversationManager(
    historyService,
    view,
    baseURL,
  );

  return { conversationManager, historyService };
}

async function recordSimpleAiTurn(
  conversationManager: ConversationManager,
): Promise<void> {
  const userInput: IContent = {
    speaker: 'human',
    blocks: [{ type: 'text', text: 'Write a haiku' }],
  };
  const modelOutput: IContent[] = [
    { speaker: 'ai', blocks: [{ type: 'text', text: 'Quiet morning dew' }] },
  ];
  await conversationManager.recordHistory(userInput, modelOutput);
}

describe('ConversationManager stamps the live provider model, not the stale snapshot (issue #2511)', () => {
  it('AC1/AC2: stamps the live provider model when the runtime-state snapshot is stale', async () => {
    const { conversationManager, historyService } = buildConversationManager(
      STALE_SNAPSHOT_MODEL,
      GENERATING_BASE_URL,
      { liveModel: LIVE_PROVIDER_MODEL },
    );

    await recordSimpleAiTurn(conversationManager);

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(LIVE_PROVIDER_MODEL);
  });

  it('AC3: falls back to the runtime-state model when the live accessor returns a blank string', async () => {
    const { conversationManager, historyService } = buildConversationManager(
      STALE_SNAPSHOT_MODEL,
      GENERATING_BASE_URL,
      { liveModel: '' },
    );

    await recordSimpleAiTurn(conversationManager);

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(STALE_SNAPSHOT_MODEL);
  });

  it('AC3: falls back to the runtime-state model when the live accessor throws', async () => {
    const { conversationManager, historyService } = buildConversationManager(
      STALE_SNAPSHOT_MODEL,
      GENERATING_BASE_URL,
      { liveModel: 'throw' },
    );

    await recordSimpleAiTurn(conversationManager);

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(STALE_SNAPSHOT_MODEL);
  });

  it('AC3: falls back to the runtime-state model when the provider omits getCurrentModel entirely', async () => {
    // `RuntimeProvider.getCurrentModel` is optional in the contract, so a
    // provider may not implement it at all. Recording must fall back rather
    // than calling a non-function.
    const { conversationManager, historyService } = buildConversationManager(
      STALE_SNAPSHOT_MODEL,
      GENERATING_BASE_URL,
    );

    await recordSimpleAiTurn(conversationManager);

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(STALE_SNAPSHOT_MODEL);
  });
});

function buildChatSessionWithLiveProvider(
  runtimeModel: string,
  liveProvider?: LiveProviderOptions,
): {
  chat: ChatSession;
  historyService: HistoryService;
} {
  const settingsService = new SettingsService();
  const config = new Config(createConfigParams(settingsService));

  settingsService.set('providers.stub.base-url', 'https://stub.example.com');
  settingsService.set('providers.stub.auth-key', 'stub-api-key');
  settingsService.set('providers.stub.model', 'stub-model');

  const providerRuntime: ProviderRuntimeContext = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'test.runtime.turnprocessor.modelStamp',
    metadata: { source: 'generatingModelStamp.issue2511.bun' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: async () => [],
    getDefaultModel: () => runtimeModel,
    generateChatCompletion: async function* () {
      yield {
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'Quiet morning dew.' }],
      } satisfies IContent;
    },
  };
  if (liveProvider?.liveModel !== undefined) {
    if (liveProvider.liveModel === 'throw') {
      provider.getCurrentModel = (): string => {
        throw new Error('provider accessor blew up');
      };
    } else {
      const live = liveProvider.liveModel;
      provider.getCurrentModel = (): string => live;
    }
  }
  manager.registerProvider(provider);

  const runtimeState: AgentRuntimeState = createAgentRuntimeState({
    runtimeId: 'runtime-turnprocessor-modelstamp',
    provider: provider.name,
    model: runtimeModel,
    sessionId: config.getSessionId(),
  });

  const historyService = new HistoryService();
  const view = createAgentRuntimeContext({
    state: runtimeState,
    history: historyService,
    settings: {
      compressionThreshold: 0.8,
      contextLimit: 200000,
      preserveThreshold: 0.2,
      telemetry: { enabled: true, target: null },
    },
    provider: createProviderAdapterFromManager(config.getProviderManager()),
    telemetry: createTelemetryAdapterFromConfig(config),
    tools: createToolRegistryViewFromRegistry(config.getToolRegistry()),
    providerRuntime: { ...providerRuntime },
  });

  const chat = new ChatSession(
    view,
    {
      generateContent: async () => emptyModelOutput(),
      // Intentionally yields nothing; these tests exercise the non-streaming
      // commit path only. The IIFE is needed because the contract expects a
      // function returning Promise<AsyncGenerator>, not an async generator
      // function itself.
      generateContentStream: async () => (async function* () {})(),
      countTokens: async () => ({ totalTokens: 100 }),
      embedContent: async () => ({ embeddings: [] }),
    },
    {},
    [],
  );

  return { chat, historyService };
}

describe('TurnProcessor._commitSendResult stamps the live provider model (issue #2511)', () => {
  it('AC1/AC2: stamps the live provider model, not the stale runtime-state snapshot', async () => {
    const { chat, historyService } = buildChatSessionWithLiveProvider(
      STALE_SNAPSHOT_MODEL,
      { liveModel: LIVE_PROVIDER_MODEL },
    );

    await chat.sendMessage(
      { message: [{ type: 'text', text: 'Write a haiku' }] },
      'test-prompt-id',
    );

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(LIVE_PROVIDER_MODEL);
  });

  it('AC3: falls back to the runtime-state model when the live accessor throws', async () => {
    const { chat, historyService } = buildChatSessionWithLiveProvider(
      STALE_SNAPSHOT_MODEL,
      { liveModel: 'throw' },
    );

    await chat.sendMessage(
      { message: [{ type: 'text', text: 'Write a haiku' }] },
      'test-prompt-id',
    );

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(STALE_SNAPSHOT_MODEL);
  });

  it('AC3: falls back to the runtime-state model when the provider omits getCurrentModel entirely', async () => {
    const { chat, historyService } =
      buildChatSessionWithLiveProvider(STALE_SNAPSHOT_MODEL);

    await chat.sendMessage(
      { message: [{ type: 'text', text: 'Write a haiku' }] },
      'test-prompt-id',
    );

    const ai = historyService.getAll().find((c) => c.speaker === 'ai');
    expect(ai?.metadata?.model).toBe(STALE_SNAPSHOT_MODEL);
  });
});
