/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { afterEach } from 'bun:test';
import type {
  AgentRuntimeContext,
  PrepareProviderInvocation,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

import { createRuntimeTokenizerFactory } from '../../../../providers/src/composition/runtimeTokenizerFactory.js';
import type { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
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
import { chatSessionPorts } from '../chatSessionPorts.js';
import { installModelToolFixture } from './model-tool-fixture.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { NetworkFetch } from '@vybestack/llxprt-code-core/utils/fetch.js';

const requestFetch: NetworkFetch = (input, init) =>
  globalThis.fetch(input, init);

function lifecycleInvocationReader(
  providerRuntime: ProviderRuntimeContext,
  settingsService: SettingsService,
): PrepareProviderInvocation {
  return (name, parameters, signal) =>
    captureProviderInvocation(
      {
        fetch: requestFetch,
        runtimeId: providerRuntime.runtimeId,
        metadata: providerRuntime.metadata,
        globalSettings: settingsService.getAllGlobalSettings(),
        providerSettings: settingsService.getProviderSettings(name),
      },
      name,
      parameters,
      signal,
    );
}

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
  promptEstimator: ReturnType<typeof createRuntimeTokenizerFactory>;
  settingsService: SettingsService;
  settingsOwner: ReturnType<
    typeof createSessionSettingsFixture
  >['settingsOwner'];
  provider: OpenAIResponsesProvider;
} {
  const settingsService = new SettingsService();
  settingsService.setProviderSetting('codex', 'model', 'gpt-5.6-sol');
  settingsService.set('retries', 0);
  const config = new Config({
    ...createConfigParams(settingsService),
    cwd: process.cwd(),
    targetDir: process.cwd(),
    model: 'gpt-5.6-sol',
    provider: 'codex',
  });
  const { settingsOwner } = createSessionSettingsFixture(
    config,
    settingsService,
  );
  const providerRuntime = createProviderRuntimeContext({
    runtimeId: 'responses-lifecycle',
  });
  const manager = new TestRuntimeProviderManager(providerRuntime);
  manager.setConfig(config);
  const promptEstimator = createRuntimeTokenizerFactory();
  const provider = new SocketBoundaryProvider(harness);
  manager.registerProvider(provider);
  manager.setActiveProvider(provider.name);
  return {
    config,
    providerRuntime,
    manager,
    promptEstimator,
    settingsService,
    settingsOwner,
    provider,
  };
}

interface ResponsesLifecycleFixture {
  chat: ChatSession;
  history: HistoryService;
  provider: OpenAIResponsesProvider;
  httpRequests: () => number;
  runtime: AgentRuntimeContext;
  config: Config;
  contentGenerator: ContentGenerator;
  telemetryRoot: RootTelemetry;
  toolRegistry: ToolSelection;
}

function createLifecycleChatSession(
  runtime: AgentRuntimeContext,
  config: Config,
): ChatSession {
  return new ChatSession(
    chatSessionPorts(runtime),
    config,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    unusedContentGenerator,
    { systemInstruction: 'Exercise connection lifecycle recovery.' },
    [],
  );
}

export function installResponsesLifecycleFixture(): (
  harness: SocketHarness,
) => ResponsesLifecycleFixture {
  const modelTools = installModelToolFixture();
  const originalFetch = globalThis.fetch;
  const resources: Array<{
    provider: OpenAIResponsesProvider;
    config: Config;
  }> = [];
  afterEach(async () => {
    globalThis.fetch = originalFetch;
    for (const { provider, config } of resources.splice(0)) {
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
    const {
      config,
      providerRuntime,
      manager,
      promptEstimator,
      settingsService,
      settingsOwner,
      provider,
    } = createProvider(harness);
    const history = new HistoryService();
    const toolRegistry = modelTools();
    const runtime = createAgentRuntimeContext({
      prepareProviderInvocation: lifecycleInvocationReader(
        providerRuntime,
        settingsService,
      ),
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
      telemetry: createTelemetryAdapter(config, settingsOwner.telemetry),
      tools: createToolRegistryViewFromRegistry(toolRegistry),
      providerRuntime,
      promptEstimator,
    });
    resources.push({ provider, config });
    return {
      chat: createLifecycleChatSession(runtime, config),
      history,
      provider,
      httpRequests: () => httpRequests,
      runtime,
      config,
      contentGenerator: unusedContentGenerator,
      telemetryRoot: settingsOwner.telemetry,
      toolRegistry,
    };
  };
}
