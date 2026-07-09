/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Issue #207: When a model turn is recorded with a responseId, the recorded
 * AI history entry must carry metadata.id so the Responses API provider can
 * thread it as previous_response_id for stateful conversations.
 *
 * This exercises ConversationManager.recordHistory → _addModelOutputToHistory.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import type { Content } from '@google/genai';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapterFromConfig,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { ConversationManager } from './ConversationManager.js';
import { TestRuntimeProviderManager } from '../test-utils/runtimeProviderManager.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { createConfigParams } from './chatSession-runtime-helpers.js';

const GENERATING_MODEL = 'gpt-5.2';

function buildConversationManager(model: string): {
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
    runtimeId: 'test.runtime.conversationManager.responseId',
    metadata: { source: 'ConversationManager.responseId.test' },
  });

  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  config.setProviderManager(manager);

  const provider: IProvider = {
    name: 'stub',
    isDefault: true,
    getModels: () => [],
    getDefaultModel: () => model,
    async *generateChatCompletion() {
      /* stub */
    },
    getServerTools: () => [],
    invokeServerTool: undefined,
    getAuthToken: undefined,
  };
  manager.registerProvider(provider);

  const runtimeState = createAgentRuntimeState({
    runtimeId: 'runtime-conversationManager-responseId',
    provider: provider.name,
    model,
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

  const conversationManager = new ConversationManager(
    historyService,
    view,
    model,
  );

  return { conversationManager, historyService };
}

describe('ConversationManager records responseId into history @issue:207', () => {
  let conversationManager: ConversationManager;
  let historyService: HistoryService;

  const USER_INPUT: Content = {
    role: 'user',
    parts: [{ text: 'Hello' }],
  };
  const MODEL_OUTPUT: Content[] = [
    { role: 'model', parts: [{ text: 'Hi there.' }] },
  ];

  beforeEach(() => {
    ({ conversationManager, historyService } =
      buildConversationManager(GENERATING_MODEL));
  });

  it('records metadata.id when a responseId is passed', () => {
    conversationManager.recordHistory(
      USER_INPUT,
      MODEL_OUTPUT,
      undefined,
      null,
      'resp_abc',
    );

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBe('resp_abc');
  });

  it('does not set metadata.id when responseId is null', () => {
    conversationManager.recordHistory(
      USER_INPUT,
      MODEL_OUTPUT,
      undefined,
      null,
      null,
    );

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBeUndefined();
  });

  it('does not set metadata.id when responseId is omitted (undefined)', () => {
    conversationManager.recordHistory(USER_INPUT, MODEL_OUTPUT);

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBeUndefined();
  });

  it('sets metadata.responsesStored when responsesStored is true', () => {
    conversationManager.recordHistory(
      USER_INPUT,
      MODEL_OUTPUT,
      undefined,
      null,
      'resp_stored',
      true,
    );

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBe('resp_stored');
    expect(ai?.metadata?.responsesStored).toBe(true);
  });

  it('does not set metadata.responsesStored when responsesStored is false', () => {
    conversationManager.recordHistory(
      USER_INPUT,
      MODEL_OUTPUT,
      undefined,
      null,
      'resp_unstored',
      false,
    );

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBe('resp_unstored');
    expect(ai?.metadata?.responsesStored).toBeUndefined();
  });

  it('does not set metadata.id when responseId is an empty string', () => {
    conversationManager.recordHistory(
      USER_INPUT,
      MODEL_OUTPUT,
      undefined,
      null,
      '',
    );

    const all = historyService.getAll();
    const ai = all.find((c) => c.speaker === 'ai');
    expect(ai).toBeDefined();
    expect(ai?.metadata?.id).toBeUndefined();
  });
});
