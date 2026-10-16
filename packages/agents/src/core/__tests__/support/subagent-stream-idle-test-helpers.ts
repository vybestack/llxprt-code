/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { vi } from 'bun:test';
import { SubAgentScope } from '../../subagent.js';
import type {
  ModelConfig,
  RunConfig,
  SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import { createProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import { createToolRegistryViewFromRegistry } from '@vybestack/llxprt-code-core/runtime/runtimeAdapters.js';
import { createAgentRuntimeContext } from '@vybestack/llxprt-code-core/runtime/createAgentRuntimeContext.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { ToolRegistry } from '@vybestack/llxprt-code-tools/tools/tool-registry.js';
import type { MessageBus } from '@vybestack/llxprt-code-core/confirmation-bus/message-bus.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { createSessionSettingsFixture } from '../../../api/__tests__/helpers/session-settings-fixture.js';

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

function createRuntimeBundle(
  config: Config,
  settingsService: SettingsService,
): AgentRuntimeLoaderResult {
  const { settingsOwner } = createSessionSettingsFixture(
    config,
    settingsService,
  );
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
  const state = createAgentRuntimeState({
    runtimeId: config.getSessionId(),
    sessionId: config.getSessionId(),
    provider: 'stub',
    model: config.getModel(),
    modelParams: {},
  });
  const provider = {
    getActiveProvider: vi.fn(() => ({
      name: 'stub',
      isDefault: true,
      getModels: async () => [],
      generateChatCompletion: vi.fn(async function* () {}),
      getDefaultModel: () => config.getModel(),
    })),
    setActiveProvider: vi.fn(),
  };
  const telemetry = {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
  };
  const toolRegistry = new ToolRegistry(config, mockMessageBus, () =>
    settingsOwner.readRegistryPolicy([]),
  );
  const runtimeContext = createAgentRuntimeContext({
    state,
    history,
    provider,
    telemetry,
    settings: settingsOwner.readRuntimePolicy(),
    readRuntimeSettings: () => settingsOwner.readRuntimePolicy(),
    providerRuntime: createProviderRuntimeContext({
      runtimeId: state.runtimeId,
      settingsService,
      config,
    }),
    prepareProviderInvocation: (name, parameters, signal) =>
      settingsOwner.prepareProviderInvocation(
        state.runtimeId,
        name,
        parameters,
        signal,
      ),
    tools: createToolRegistryViewFromRegistry(toolRegistry),
  });
  return {
    runtimeContext,
    history,
    providerAdapter: provider,
    telemetryAdapter: telemetry,
    telemetryRoot: RootTelemetry.prepare({
      enabled: false,
      sessionId: 'subagent-stream-idle-fixture',
      maxBytes: 1024,
      maxFiles: 1,
    }),
    toolsView: runtimeContext.tools,
    contentGenerator: {} as ContentGenerator,
    toolRegistry,
  };
}

export async function createIdleScope(
  timeoutMs: number,
  agentName: string,
  systemPrompt: string,
  maxTimeMinutes = localDefaultRunConfig.max_time_minutes,
): Promise<{
  config: Config;
  scope: SubAgentScope;
  runtimeBundle: AgentRuntimeLoaderResult;
}> {
  const settingsService = new SettingsService();
  const configParams: ConfigParameters = {
    sessionId: 'test-session',
    model: 'gemini-2.5-pro',
    targetDir: '.',
    debugMode: false,
    cwd: process.cwd(),
    initialSettings: settingsService.getAllGlobalSettings(),
  };
  const config = new Config(configParams);
  settingsService.set('stream-idle-timeout-ms', timeoutMs);
  const mcpRuntime = await initializeTestConfig(config);

  const runtimeBundle = createRuntimeBundle(config, settingsService);
  const overrides: SubAgentRuntimeOverrides = {
    instructions: mcpRuntime.workspaceMemory.operations,
    workspacePaths: mcpRuntime.workspaceFilesystem.paths,
    readMcpInstructions: () => undefined,
    runtimeBundle,
    toolRegistry: new ToolRegistry(
      config,
      mockMessageBus,
      assembleTaskSchemaPolicy(new SettingsService()),
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
  return { config, scope, runtimeBundle };
}
