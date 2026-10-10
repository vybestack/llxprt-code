import { RootTelemetry } from '@vybestack/llxprt-code-telemetry';
import { createSessionPolicyFixture } from './session-policy-fixture.js';
import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import type { WorkspacePathOperations } from '@vybestack/llxprt-code-core/services/workspace-filesystem-owner.js';

/**
 * Shared helpers for subagent test files. Extracted from the original
 * monolithic subagent.test.ts so no file-level max-lines disable is needed.
 *
 * IMPORTANT: vi.mock() calls are file-scoped and hoisted by the test runner above
 * all imports. Each test file that exercises SubAgentScope must declare
 * its own vi.mock() calls. The helpers here are pure functions that can
 * be imported.
 */

import type { Mock } from 'bun:test';
import { afterEach, vi } from 'bun:test';
import type { ContentBlock } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { toModelStreamChunk } from '@vybestack/llxprt-code-core/llm-types/index.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { StreamEventType } from '../chatSession.js';
import { type ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { ProviderRuntimeContext } from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { initializeTestMcpRuntime } from '@vybestack/llxprt-code-test-utils/core/config.js';
import type { ToolSelection } from '@vybestack/llxprt-code-tools';
import type { ToolErrorType } from '@vybestack/llxprt-code-tools';
import type {
  ModelConfig,
  RunConfig,
  SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

const mockConfigs = new Map<
  Config,
  Awaited<ReturnType<typeof initializeTestMcpRuntime>>
>();

afterEach(async () => {
  const configs = Array.from(mockConfigs.keys());
  await Promise.all(configs.map((config) => disposeMockConfig(config)));
});

export async function disposeMockConfig(config: Config): Promise<void> {
  await mockConfigs.get(config)?.dispose();
  mockConfigs.delete(config);
  await config.dispose();
}

export function createCompletedToolCallResponse(params: {
  callId: string;
  responseParts?: ContentBlock[];
  resultDisplay?: unknown;
  error?: Error;
  errorType?: ToolErrorType;
  agentId?: string;
}) {
  return {
    status: params.error ? ('error' as const) : ('success' as const),
    request: {
      callId: params.callId,
      name: 'mock_tool',
      args: {},
      isClientInitiated: true,
      prompt_id: 'mock-prompt',
      agentId: params.agentId ?? 'primary',
    },
    response: {
      callId: params.callId,
      responseParts: params.responseParts ?? [],
      resultDisplay: params.resultDisplay,
      error: params.error,
      errorType: params.errorType,
      agentId: params.agentId ?? 'primary',
    },
  };
}

type ToolSelectionMethodOverrides = Partial<
  Pick<
    ToolSelection,
    | 'getTool'
    | 'getFunctionDeclarationsFiltered'
    | 'getEnabledTools'
    | 'getAllTools'
  >
>;

export async function createMockConfig(
  toolRegistryMethods: ToolSelectionMethodOverrides = {},
  initialSettings: Readonly<Record<string, unknown>> = {},
): Promise<{
  config: Config;
  settingsService: SettingsService;
  settingsOwner: ReturnType<
    typeof createSessionSettingsFixture
  >['settingsOwner'];
  toolRegistry: ToolSelection;
  mcpRuntime: Awaited<ReturnType<typeof initializeTestMcpRuntime>>;
}> {
  // The settings service flows explicitly through ConfigParameters (issue
  // #2616: no ambient runtime context install).
  const settingsService = new SettingsService();
  for (const [key, value] of Object.entries(initialSettings))
    settingsService.set(key, value);
  const configParams: ConfigParameters = {
    initialSettings,
    sessionId: 'test-session',
    model: 'gemini-2.5-pro',
    targetDir: '.',
    debugMode: false,
    cwd: process.cwd(),
  };
  const config = new Config(configParams);
  const settingsRoot = createSessionSettingsFixture(config, settingsService);
  const mcpRuntime = await initializeTestMcpRuntime(config);
  mockConfigs.set(config, mcpRuntime);

  vi.spyOn(config, 'getContentGeneratorConfig').mockReturnValue({
    model: 'gemini-2.5-pro',
  });

  const toolRegistry = mcpRuntime.toolSelection;
  vi.spyOn(toolRegistry, 'getTool').mockImplementation(
    toolRegistryMethods.getTool ?? (() => undefined),
  );
  vi.spyOn(toolRegistry, 'getFunctionDeclarationsFiltered').mockImplementation(
    toolRegistryMethods.getFunctionDeclarationsFiltered ?? (() => []),
  );

  if (toolRegistryMethods.getEnabledTools)
    vi.spyOn(toolRegistry, 'getEnabledTools').mockImplementation(
      toolRegistryMethods.getEnabledTools,
    );
  if (toolRegistryMethods.getAllTools)
    vi.spyOn(toolRegistry, 'getAllTools').mockImplementation(
      toolRegistryMethods.getAllTools,
    );
  return {
    config,
    settingsService,
    settingsOwner: settingsRoot.settingsOwner,
    toolRegistry,
    mcpRuntime,
  };
}

export function createMockStream(
  functionCallsList: Array<
    | Array<{ name: string; args?: Record<string, unknown>; id?: string }>
    | 'stop'
  >,
) {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const response = functionCallsList[index] ?? 'stop';
    index++;

    return (async function* () {
      let blocks: ContentBlock[];

      if (response === 'stop' || response.length === 0) {
        blocks = [{ type: 'text', text: 'Done.' }];
      } else {
        blocks = response.map((call) => ({
          type: 'tool_call' as const,
          id: call.id ?? call.name,
          name: call.name,
          parameters: call.args ?? {},
        }));
      }

      const chunk = toModelStreamChunk({
        speaker: 'ai',
        blocks,
      });

      yield {
        type: StreamEventType.CHUNK,
        value: chunk,
      };
    })();
  });
}

export const defaultModelConfig: ModelConfig = {
  model: 'gemini-1.5-flash-latest',
  temp: 0.5,
  top_p: 1,
};

export const defaultRunConfig: RunConfig = {
  max_time_minutes: 5,
  max_turns: 10,
};

export function createStatelessRuntimeBundle(
  options: {
    toolsView?: ToolRegistryView;
    providerAdapter?: AgentRuntimeProviderAdapter;
    telemetryAdapter?: AgentRuntimeTelemetryAdapter;
    contentGenerator?: ContentGenerator;
    toolRegistry?: ToolSelection;
    history?: HistoryService;
    settings?: SettingsService;
  } = {},
): AgentRuntimeLoaderResult {
  const toolsView = options.toolsView ?? createDefaultToolsView();
  const providerAdapter =
    options.providerAdapter ?? createDefaultProviderAdapter();
  const telemetryAdapter =
    options.telemetryAdapter ?? createDefaultTelemetryAdapter();
  const history = options.history ?? createDefaultHistory();
  const toolRegistry = options.toolRegistry ?? createDefaultToolSelection();
  const runtimeContext = createRuntimeContext(
    history,
    telemetryAdapter,
    providerAdapter,
    toolsView,
    options.settings,
  );
  const contentGenerator =
    options.contentGenerator ?? createDefaultContentGenerator();

  return {
    runtimeContext,
    history,
    providerAdapter,
    telemetryAdapter,
    telemetryRoot: RootTelemetry.prepare({
      enabled: false,
      sessionId: 'subagent-fixture',
      maxBytes: 1024,
      maxFiles: 1,
    }),
    toolsView,
    contentGenerator,
    toolRegistry,
  };
}

function createDefaultToolsView(): ToolRegistryView {
  return {
    listToolNames: vi.fn(() => []),
    getToolMetadata: vi.fn(() => undefined),
  } as ToolRegistryView;
}

function createDefaultProviderAdapter(): AgentRuntimeProviderAdapter {
  return {
    getActiveProvider: vi.fn(
      () =>
        ({
          name: 'gemini',
          generateChatCompletion: vi.fn(async function* () {
            yield { speaker: 'ai', blocks: [] };
          }),
          getDefaultModel: () => defaultModelConfig.model,
        }) as unknown as IProvider,
    ),
    setActiveProvider: vi.fn(),
  } as AgentRuntimeProviderAdapter;
}

function createDefaultTelemetryAdapter(): AgentRuntimeTelemetryAdapter {
  return {
    logApiRequest: vi.fn(),
    logApiResponse: vi.fn(),
    logApiError: vi.fn(),
  } as AgentRuntimeTelemetryAdapter;
}

function createDefaultHistory(): HistoryService {
  const history = new HistoryService();
  vi.spyOn(history, 'clear');
  vi.spyOn(history, 'add');
  vi.spyOn(history, 'getCuratedForProvider');
  vi.spyOn(history, 'getIdGeneratorCallback');
  vi.spyOn(history, 'findUnmatchedToolCalls');
  vi.spyOn(history, 'generateTurnKey');
  return history;
}

function createDefaultToolSelection(): ToolSelection {
  return {
    getTool: vi.fn(),
    getFunctionDeclarationsFiltered: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
  } as unknown as ToolSelection;
}

function createRuntimeContext(
  history: HistoryService,
  telemetryAdapter: AgentRuntimeTelemetryAdapter,
  providerAdapter: AgentRuntimeProviderAdapter,
  toolsView: ToolRegistryView,
  settings?: SettingsService,
): AgentRuntimeContext {
  const policies = createSessionPolicyFixture(settings);
  return {
    ...policies,
    readPromptPolicy: () =>
      policies.owner.readRuntimePolicy().promptPolicy ?? {},
    readCompletionBudgetSetting: () =>
      policies.owner.readRuntimePolicy().maxOutputTokens,
    readPromptCachingPolicy: () =>
      policies.owner.readRuntimePolicy().promptCaching,
    showCitations: () =>
      policies.owner.readRuntimePolicy().showCitations === true,
    tokenUsageLoggingEnabled:
      policies.owner.readRuntimePolicy().tokenUsageLoggingEnabled !== false,
    readToolExecutionPolicy: policies.readExecutionPolicy,
    readStreamTimeoutPolicy: () =>
      policies.owner.readRuntimePolicy().streamTimeoutPolicy,
    state: {
      runtimeId: 'runtime-123',
      provider: 'gemini',
      model: defaultModelConfig.model,
      sessionId: 'runtime-session',
      proxyUrl: undefined,
      modelParams: {
        temperature: defaultModelConfig.temp,
        topP: defaultModelConfig.top_p,
      },
    },
    history,
    ephemerals: {
      // #3199 added this ephemeral; the real chat path reads it on every turn.
      semanticMediaPurge: () => 'off' as const,
      compressionThreshold: () => 0.8,
      contextLimit: () => 60_000,
      preserveThreshold: () => 0.2,
      toolFormatOverride: () => undefined,
      reasoning: {
        enabled: () => false,
        includeInContext: () => false,
        includeInResponse: () => false,
        format: () => 'native' as const,
        stripFromContext: () => 'none' as const,
        effort: () => undefined,
        maxTokens: () => undefined,
        adaptiveThinking: () => undefined,
      },
    },
    telemetry: telemetryAdapter,
    provider: providerAdapter,
    tools: toolsView,
    providerRuntime: {
      runtimeId: 'runtime-123',
      metadata: {},
      settingsService: policies.settings,
    } as unknown as ProviderRuntimeContext,
  } as unknown as AgentRuntimeContext;
}

function createDefaultContentGenerator(): ContentGenerator {
  return {
    generateContent: vi.fn(),
    generateContentStream: vi.fn(),
    countTokens: vi.fn(),
  } as unknown as ContentGenerator;
}

export type EnvironmentLoader = (
  runtime: AgentRuntimeContext,
) => Promise<Array<{ text?: string }>>;

const DEFAULT_ENV_CONTEXT: Array<{ text?: string }> = [{ text: 'Env Context' }];

export function defaultEnvironmentLoader(): EnvironmentLoader {
  return vi.fn(async () => DEFAULT_ENV_CONTEXT);
}

export function createRuntimeOverrides(
  workspacePaths: WorkspacePathOperations,
  options: {
    runtimeBundle?: AgentRuntimeLoaderResult;
    environmentLoader?: EnvironmentLoader;
    toolRegistry?: ToolSelection;
    settings?: SettingsService;
  } = {},
): {
  overrides: SubAgentRuntimeOverrides;
  runtimeBundle: AgentRuntimeLoaderResult;
  environmentLoader: EnvironmentLoader;
} {
  const runtimeBundle =
    options.runtimeBundle ??
    createStatelessRuntimeBundle({
      toolRegistry: options.toolRegistry,
      settings: options.settings,
    });

  const environmentLoader =
    options.environmentLoader ?? defaultEnvironmentLoader();

  const overrides: SubAgentRuntimeOverrides = {
    instructions: emptyInstructionReads,
    workspacePaths,
    readMcpInstructions: () => undefined,
    runtimeBundle,
    environmentContextLoader: environmentLoader,
  };

  if (options.toolRegistry) {
    overrides.toolRegistry = options.toolRegistry;
  }

  return { overrides, runtimeBundle, environmentLoader };
}

export type { ContentGenerator, Mock, ToolRegistryView };
