/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { SubAgentScope } from './subagent.js';
import type {
  ModelConfig,
  RunConfig,
  SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';

const mockMessageBus = {} as MessageBus;
const localDefaultModelConfig: ModelConfig = {
  model: 'gemini-1.5-flash-latest',
  temp: 0.5,
  top_p: 1,
};
const localDefaultRunConfig: RunConfig = {
  max_time_minutes: 5,
  max_turns: 10,
};

function createRuntimeBundle(config: Config): AgentRuntimeLoaderResult {
  const history = {
    clear: vi.fn(),
    add: vi.fn(),
    async *getCuratedForProviderStream() {
      yield* [];
    },
    getIdGeneratorCallback: vi.fn(() => vi.fn()),
    findUnmatchedToolCalls: vi.fn(() => []),
    generateTurnKey: vi.fn(() => `turn-${Date.now()}`),
  } as unknown as HistoryService;

  const runtimeContext = {
    state: {
      runtimeId: config.getSessionId(),
      provider: config.getProvider(),
      model: config.getModel(),
      sessionId: config.getSessionId(),
      proxyUrl: undefined,
      modelParams: {},
    },
    history,
    ephemerals: {
      compressionThreshold: () => 0.8,
      contextLimit: () => 60_000,
      preserveThreshold: () => 0.2,
      toolFormatOverride: () => undefined,
    },
    telemetry: {
      logApiRequest: vi.fn(),
      logApiResponse: vi.fn(),
      logApiError: vi.fn(),
    },
    provider: {
      getActiveProvider: vi.fn(
        () =>
          ({
            name: config.getProvider(),
            generateChatCompletion: vi.fn(async function* () {}),
            getDefaultModel: () => config.getModel(),
          }) as unknown as IProvider,
      ),
      setActiveProvider: vi.fn(),
    },
    tools: {
      listToolNames: () => [],
      getToolMetadata: () => undefined,
    },
    providerRuntime: {
      runtimeId: config.getSessionId(),
      metadata: {},
      settingsService: config.getSettingsService(),
      config,
    } as unknown as ProviderRuntimeContext,
  } as unknown as AgentRuntimeContext;

  return {
    runtimeContext,
    history,
    providerAdapter: runtimeContext.provider,
    telemetryAdapter: runtimeContext.telemetry,
    toolsView: runtimeContext.tools,
    contentGenerator: {} as ContentGenerator,
    toolRegistry: new ToolRegistry(
      config,
      mockMessageBus,
      new SettingsService(),
    ),
  };
}

export async function createIdleScope(
  timeoutMs: number,
  agentName: string,
  systemPrompt: string,
  maxTimeMinutes = localDefaultRunConfig.max_time_minutes,
): Promise<{ config: Config; scope: SubAgentScope }> {
  const settingsService = new SettingsService();
  const configParams: ConfigParameters = {
    sessionId: 'test-session',
    model: 'gemini-2.5-pro',
    targetDir: '.',
    debugMode: false,
    cwd: process.cwd(),
    settingsService,
  };
  const config = new Config(configParams);
  config.setEphemeralSetting('stream-idle-timeout-ms', timeoutMs);
  await initializeTestConfig(config);

  const overrides: SubAgentRuntimeOverrides = {
    runtimeBundle: createRuntimeBundle(config),
    toolRegistry: new ToolRegistry(
      config,
      mockMessageBus,
      new SettingsService(),
    ),
  };
  const scope = await SubAgentScope.create(
    agentName,
    config,
    { systemPrompt },
    localDefaultModelConfig,
    { ...localDefaultRunConfig, max_time_minutes: maxTimeMinutes },
    undefined,
    undefined,
    overrides,
  );
  return { config, scope };
}
