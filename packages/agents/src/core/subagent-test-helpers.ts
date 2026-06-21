/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for subagent test files. Extracted from the original
 * monolithic subagent.test.ts so no file-level max-lines disable is needed.
 *
 * IMPORTANT: vi.mock() calls are file-scoped and hoisted by vitest above
 * all imports. Each test file that exercises SubAgentScope must declare
 * its own vi.mock() calls. The helpers here are pure functions that can
 * be imported.
 */

import type { Mock } from 'vitest';
import { vi } from 'vitest';
import type {
  Content,
  FunctionCall,
  GenerateContentResponse,
  Part,
} from '@google/genai';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { StreamEventType } from './chatSession.js';
import { type ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import {
  createProviderRuntimeContext,
  setActiveProviderRuntimeContext,
  type ProviderRuntimeContext,
} from '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js';
import type {
  AgentRuntimeContext,
  AgentRuntimeProviderAdapter,
  AgentRuntimeTelemetryAdapter,
  ToolRegistryView,
} from '@vybestack/llxprt-code-core/runtime/AgentRuntimeContext.js';
import type { AgentRuntimeLoaderResult } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js';
import type { RuntimeProvider as IProvider } from '@vybestack/llxprt-code-core/runtime/contracts/RuntimeProvider.js';
import { initializeTestConfig } from '@vybestack/llxprt-code-core/test-utils/config.js';
import type { ToolRegistry } from '@vybestack/llxprt-code-tools';
import { DEFAULT_GEMINI_MODEL } from '@vybestack/llxprt-code-core/config/models.js';
import type { ToolErrorType } from '@vybestack/llxprt-code-tools';
import type {
  ModelConfig,
  RunConfig,
  SubAgentRuntimeOverrides,
} from '@vybestack/llxprt-code-core/core/subagentTypes.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';

export function createCompletedToolCallResponse(params: {
  callId: string;
  responseParts?: Part[];
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

export async function createMockConfig(
  toolRegistryMocks = {},
): Promise<{ config: Config; toolRegistry: ToolRegistry }> {
  const settingsService = new SettingsService();
  setActiveProviderRuntimeContext(
    createProviderRuntimeContext({ settingsService }),
  );
  const configParams: ConfigParameters = {
    sessionId: 'test-session',
    model: DEFAULT_GEMINI_MODEL,
    targetDir: '.',
    debugMode: false,
    cwd: process.cwd(),
    settingsService,
  };
  const config = new Config(configParams);
  await initializeTestConfig(config);

  await config.refreshAuth();

  vi.spyOn(config, 'getContentGeneratorConfig').mockReturnValue({
    model: DEFAULT_GEMINI_MODEL,
  });

  const mockToolRegistry = {
    getTool: vi.fn(),
    getFunctionDeclarationsFiltered: vi.fn().mockReturnValue([]),
    ...toolRegistryMocks,
  } as unknown as ToolRegistry;

  vi.spyOn(config, 'getToolRegistry').mockReturnValue(mockToolRegistry);
  return { config, toolRegistry: mockToolRegistry };
}

export function createMockStream(
  functionCallsList: Array<FunctionCall[] | 'stop'>,
) {
  let index = 0;
  return vi.fn().mockImplementation(async () => {
    const response = functionCallsList[index] ?? 'stop';
    index++;

    return (async function* () {
      let mockResponseValue: Partial<GenerateContentResponse>;

      if (response === 'stop' || response.length === 0) {
        mockResponseValue = {
          candidates: [{ content: { parts: [{ text: 'Done.' }] } }],
        };
      } else {
        mockResponseValue = {
          candidates: [],
          functionCalls: response,
        };
      }

      yield {
        type: StreamEventType.CHUNK,
        value: mockResponseValue as GenerateContentResponse,
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
    toolRegistry?: ToolRegistry;
  } = {},
): AgentRuntimeLoaderResult {
  const toolsView = options.toolsView ?? createDefaultToolsView();
  const providerAdapter =
    options.providerAdapter ?? createDefaultProviderAdapter();
  const telemetryAdapter =
    options.telemetryAdapter ?? createDefaultTelemetryAdapter();
  const history = createDefaultHistory();
  const toolRegistry = options.toolRegistry ?? createDefaultToolRegistry();
  const runtimeContext = createRuntimeContext(
    history,
    telemetryAdapter,
    providerAdapter,
    toolsView,
  );
  const contentGenerator =
    options.contentGenerator ?? createDefaultContentGenerator();

  return {
    runtimeContext,
    history,
    providerAdapter,
    telemetryAdapter,
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
          getServerTools: () => [],
          invokeServerTool: vi.fn(),
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
  return {
    clear: vi.fn(),
    add: vi.fn(),
    getCuratedForProvider: vi.fn(() => []),
    getIdGeneratorCallback: vi.fn(() => vi.fn()),
    findUnmatchedToolCalls: vi.fn(() => []),
    generateTurnKey: vi.fn(() => `turn-${Date.now()}`),
  } as unknown as HistoryService;
}

function createDefaultToolRegistry(): ToolRegistry {
  return {
    getTool: vi.fn(),
    getFunctionDeclarationsFiltered: vi.fn(() => []),
    getAllTools: vi.fn(() => []),
  } as unknown as ToolRegistry;
}

function createRuntimeContext(
  history: HistoryService,
  telemetryAdapter: AgentRuntimeTelemetryAdapter,
  providerAdapter: AgentRuntimeProviderAdapter,
  toolsView: ToolRegistryView,
): AgentRuntimeContext {
  return {
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
      compressionThreshold: () => 0.8,
      contextLimit: () => 60_000,
      preserveThreshold: () => 0.2,
      toolFormatOverride: () => undefined,
    },
    telemetry: telemetryAdapter,
    provider: providerAdapter,
    tools: toolsView,
    providerRuntime: {
      runtimeId: 'runtime-123',
      metadata: {},
      settingsService: {
        get: vi.fn(),
        set: vi.fn(),
      },
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
) => Promise<Part[]>;

const DEFAULT_ENV_CONTEXT: Part[] = [{ text: 'Env Context' }];

export function defaultEnvironmentLoader(): EnvironmentLoader {
  return vi.fn(async () => DEFAULT_ENV_CONTEXT);
}

export function createRuntimeOverrides(
  options: {
    runtimeBundle?: AgentRuntimeLoaderResult;
    environmentLoader?: EnvironmentLoader;
    toolRegistry?: ToolRegistry;
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
    });

  const environmentLoader =
    options.environmentLoader ?? defaultEnvironmentLoader();

  const overrides: SubAgentRuntimeOverrides = {
    runtimeBundle,
    environmentContextLoader: environmentLoader,
  };

  if (options.toolRegistry) {
    overrides.toolRegistry = options.toolRegistry;
  }

  return { overrides, runtimeBundle, environmentLoader };
}

export type { Content, ContentGenerator, Mock, ToolRegistryView };
