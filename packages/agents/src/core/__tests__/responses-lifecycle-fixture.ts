/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { captureProviderInvocation } from '@vybestack/llxprt-code-core/runtime/providerRequestContext.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import {
  createProviderAdapterFromManager,
  createTelemetryAdapter,
  createToolRegistryViewFromRegistry,
} from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { OpenAIResponsesProvider } from '../../../../providers/src/openai-responses/OpenAIResponsesProvider.js';
import {
  createCodexResponsesWebSocketTransport,
  type WebSocketTransport,
} from '../../../../providers/src/openai-responses/openAIResponsesWebSocketTransport.js';
import type { SocketHarness } from '../../../../providers/src/openai-responses/__tests__/openAIResponsesWebSocketTransport.test-helpers.js';
import { TestRuntimeProviderManager } from '../../test-utils/runtimeProviderManager.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
import { createConfigParams } from '../chatSession-runtime-helpers.js';
import { ChatSession } from '../chatSession.js';
import { installModelToolFixture } from './model-tool-fixture.js';

const unusedContentGenerator: ContentGenerator = {
  async generateContent() {
    throw new Error('Unused generator');
  },
  async generateContentStream() {
    throw new Error('Unused generator');
  },
  async countTokens() {
    throw new Error('Unused generator');
  },
  async embedContent() {
    throw new Error('Unused generator');
  },
};

class SocketBoundaryProvider extends OpenAIResponsesProvider {
  constructor(private readonly harness: SocketHarness) {
    super(
      'test-key',
      'https://chatgpt.com/backend-api/codex',
      undefined,
      undefined,
      [],
      'codex',
    );
  }
  protected override createWebSocketTransport(): WebSocketTransport {
    return createCodexResponsesWebSocketTransport({
      openSocket: this.harness.openSocket,
    });
  }
  protected override async getCodexAccountId(): Promise<string> {
    return 'test-account';
  }
  protected override async getAuthTokenForPrompt(): Promise<string> {
    return 'test-token';
  }
}

function createProvider(harness: SocketHarness): {
  config: Config;
  providerRuntime: ReturnType<typeof createProviderRuntimeContext>;
  manager: TestRuntimeProviderManager;
  promptEstimator: ReturnType<
    typeof configureProviderRuntimeFactories
  >['tokenizerFactory'];
  provider: OpenAIResponsesProvider;
} {
  const settingsService = new SettingsService();
  settingsService.setProviderSetting('codex', 'model', 'gpt-5.6-sol');
  settingsService.set('retries', 0);
  const config = new Config({
    ...createConfigParams(settingsService),
    model: 'gpt-5.6-sol',
  });
  const providerRuntime = createProviderRuntimeContext({
    settingsService,
    config,
    runtimeId: 'responses-lifecycle',
  });
  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  const { tokenizerFactory: promptEstimator } =
    configureProviderRuntimeFactories(config, manager);
  const provider = new SocketBoundaryProvider(harness);
  manager.registerProvider(provider);
  manager.setActiveProvider(provider.name);
  return { config, providerRuntime, manager, promptEstimator, provider };
}

interface ResponsesLifecycleFixture {
  chat: ChatSession;
  history: HistoryService;
  provider: OpenAIResponsesProvider;
  httpRequests: () => number;
  runtime: AgentRuntimeContext;
  config: Config;
  contentGenerator: ContentGenerator;
}

export function installResponsesLifecycleFixture(): (
  harness: SocketHarness,
) => ResponsesLifecycleFixture {
  const modelTools = installModelToolFixture();
  const originalFetch = globalThis.fetch;
  const resources: Array<{
    provider: OpenAIResponsesProvider;
    config: Config;
    chat: ChatSession;
    history: HistoryService;
  }> = [];
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    for (const { provider, config, chat, history } of resources.splice(0)) {
      await chat.waitForIdle();
      await history.dispose();
      provider.clearState();
      await config.dispose();
    }
  });
  return (harness) => {
    let httpRequests = 0;
    globalThis.fetch = Object.assign(async (): Promise<Response> => {
      httpRequests += 1;
      throw new Error('Unexpected HTTP request');
    }, originalFetch);
    const { config, providerRuntime, manager, promptEstimator, provider } =
      createProvider(harness);
    const history = new HistoryService();
    const runtime = createAgentRuntimeContext({
      prepareProviderInvocation: (name, parameters, signal) =>
        captureProviderInvocation(providerRuntime, name, parameters, signal),
      state: createAgentRuntimeState({
        runtimeId: 'responses-lifecycle',
        provider: provider.name,
        model: 'gpt-5.6-sol',
        sessionId: config.getSessionId(),
      }),
      history,
      settings: {
        compressionThreshold: 0.8,
        contextLimit: 128000,
        preserveThreshold: 0.2,
        'reasoning.includeInContext': true,
        'reasoning.includeInResponse': false,
      },
      provider: createProviderAdapterFromManager(manager),
      telemetry: createTelemetryAdapter(
        config,
        createSessionSettingsFixture(config).settingsOwner.telemetry,
      ),
      tools: createToolRegistryViewFromRegistry(modelTools()),
      providerRuntime,
      promptEstimator,
    });
    const chat = new ChatSession(
      runtime,
      unusedContentGenerator,
      { systemInstruction: 'Exercise connection lifecycle recovery.' },
      [],
    );
    resources.push({ provider, config, chat, history });
    return {
      chat,
      history,
      provider,
      httpRequests: () => httpRequests,
      runtime,
      config,
      contentGenerator: unusedContentGenerator,
    };
  };
}
