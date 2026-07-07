/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared helpers for client test files. Extracted from the original
 * monolithic client.test.ts so no file-level max-lines disable is needed.
 *
 * IMPORTANT: vi.mock() calls are file-scoped and hoisted by vitest above
 * all imports. Each test file that exercises AgentClient must declare its
 * own vi.mock() calls and vi.hoisted() mock-fn references at the top of
 * the file. The setup function below receives those mock fns as arguments
 * so it can wire them into the shared Config / provider-mock surface.
 */

import { vi } from 'vitest';
import type {
  ContentGenerator,
  ContentGeneratorConfig,
} from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import type { ChatSession } from './chatSession.js';
import { AgentClient } from './client.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { FileDiscoveryService } from '@vybestack/llxprt-code-core/services/fileDiscoveryService.js';
import { setSimulate429 } from '@vybestack/llxprt-code-core/utils/testUtils.js';
import { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';

/**
 * Array.fromAsync ponyfill, which will be available in es 2024.
 *
 * Buffers an async generator into an array and returns the result.
 */
export async function fromAsync<T>(
  promise: AsyncGenerator<T>,
): Promise<readonly T[]> {
  const results: T[] = [];
  for await (const result of promise) {
    results.push(result);
  }
  return results;
}

export interface ClientTestContext {
  client: AgentClient;
  mockConfig: Config;
}

export interface ClientMockFns {
  mockGenerateContentFn: ReturnType<typeof vi.fn>;
  mockEmbedContentFn: ReturnType<typeof vi.fn>;
}

/** Reset all mocks and re-apply the shared service mocks. */
function resetAndApplyServiceMocks(): void {
  vi.resetAllMocks();
  vi.mocked(uiTelemetryService.setLastPromptTokenCount).mockClear();

  vi.mocked(getCoreSystemPromptAsync).mockResolvedValue(
    'Test system instruction',
  );

  vi.mocked(ComplexityAnalyzer).mockImplementation(
    () =>
      ({
        analyzeComplexity: vi.fn().mockReturnValue({
          complexityScore: 0.2,
          isComplex: false,
          detectedTasks: [],
          sequentialIndicators: [],
          questionCount: 0,
          shouldSuggestTodos: false,
        }),
      }) as unknown as ComplexityAnalyzer,
  );

  vi.mocked(TodoReminderService).mockImplementation(
    () =>
      ({
        getComplexTaskSuggestion: vi.fn(),
        getEscalatedComplexTaskSuggestion: vi.fn(),
        getCreateListReminder: vi.fn(),
        getUpdateActiveTodoReminder: vi.fn(),
        getEscalatedActiveTodoReminder: vi.fn(),
      }) as unknown as TodoReminderService,
  );

  setSimulate429(false);
}

/** Wire the content-generator mock fns. The AgentClient obtains its provider
 * surface via createContentGenerator (core), not a provider SDK constructor;
 * these mock fns are assigned directly onto client['contentGenerator'] /
 * client['chat'] by individual tests as needed. */
function setupProviderMocks(mockFns: ClientMockFns): void {
  const { mockGenerateContentFn } = mockFns;

  mockGenerateContentFn.mockResolvedValue({
    content: {
      speaker: 'ai',
      blocks: [{ type: 'text', text: '{"key": "value"}' }],
    },
  });
}

/** Build and register the mock Config implementation. */
function setupConfigMock(): ContentGeneratorConfig {
  const mockToolRegistry = {
    getFunctionDeclarations: vi.fn().mockReturnValue([]),
    getTool: vi.fn().mockReturnValue(null),
    getAllTools: vi.fn().mockReturnValue([]),
  };
  const fileService = new FileDiscoveryService('/test/dir');
  const MockedConfig = vi.mocked(Config, true);
  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: 'test-model',
    apiKey: 'test-key',
    vertexai: false,
  };
  const mockConfigObject = {
    getContentGeneratorConfig: vi.fn().mockReturnValue(contentGeneratorConfig),
    getToolRegistry: vi.fn().mockReturnValue(mockToolRegistry),
    getModel: vi.fn().mockReturnValue('test-model'),
    setModel: vi.fn(),
    getEmbeddingModel: vi.fn().mockReturnValue('test-embedding-model'),
    getApiKey: vi.fn().mockReturnValue('test-key'),
    getVertexAI: vi.fn().mockReturnValue(false),
    getUserAgent: vi.fn().mockReturnValue('test-agent'),
    getUserMemory: vi.fn().mockReturnValue(''),
    getCoreMemory: vi.fn().mockReturnValue(''),
    getJitMemoryForPath: vi.fn().mockResolvedValue(''),
    getEnvironmentMemory: vi.fn().mockReturnValue(''),
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(''),

    getSessionId: vi.fn().mockReturnValue('test-session-id'),
    getProxy: vi.fn().mockReturnValue(undefined),
    getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
    getFileService: vi.fn().mockReturnValue(fileService),
    getMaxSessionTurns: vi.fn().mockReturnValue(0),
    getNoBrowser: vi.fn().mockReturnValue(false),
    getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
    getIdeMode: vi.fn().mockReturnValue(true),
    getDebugMode: vi.fn().mockReturnValue(false),
    getWorkspaceContext: vi.fn().mockReturnValue({
      getDirectories: vi.fn().mockReturnValue(['/test/dir']),
    }),
    getAgentClient: vi.fn(),
    setFallbackMode: vi.fn(),
    getProvider: vi.fn().mockReturnValue('gemini'),
    getComplexityAnalyzerSettings: vi.fn().mockReturnValue({
      complexityThreshold: 0.5,
      minTasksForSuggestion: 3,
      suggestionCooldownMs: 300000,
    }),
    getContinueOnFailedApiCall: vi.fn().mockReturnValue(true),
    getChatCompression: vi.fn().mockReturnValue(undefined),
    getEphemeralSettings: vi.fn().mockReturnValue({}),
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getMcpClientManager: vi.fn().mockReturnValue(undefined),
    getModelRouterService: vi.fn().mockReturnValue(undefined),
  };
  MockedConfig.mockImplementation(() => mockConfigObject as unknown as Config);
  return contentGeneratorConfig;
}

/** Instantiate the AgentClient and wire its chat/content-generator mocks. */
async function createAndInitClient(
  contentGeneratorConfig: ContentGeneratorConfig,
  mockFns: ClientMockFns,
): Promise<AgentClient> {
  const mockConfig = new Config({
    sessionId: 'test-session-id',
  } as ConfigParameters);
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: 'gemini',
    model: 'test-model',
    sessionId: 'test-session-id',
  });
  const client = new AgentClient(mockConfig, runtimeState);
  await client.initialize(contentGeneratorConfig);

  client.getHistory = vi.fn().mockReturnValue([]);

  const mockChat = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue({
      clear: vi.fn(),
      findUnmatchedToolCalls: vi.fn().mockReturnValue([]),
      getCurated: vi.fn().mockReturnValue([]),
      getTotalTokens: vi.fn().mockReturnValue(0),
    }),
    clearHistory: vi.fn(),
    sendMessageStream: vi.fn(),
    getLastPromptTokenCount: vi.fn().mockReturnValue(0),
  };
  client['chat'] = mockChat as unknown as ChatSession;

  // Wire a mock content generator so tests that exercise BaseLLMClient paths
  // (generateEmbedding, generateJson, generateContent) hit the provided mock
  // fns instead of the real provider SDK. The embedContent adapter mirrors
  // the core GoogleGenAIWrapper transform so tests can use the Google-shaped
  // mock data ({ embeddings: [{ values: number[] }] }).
  client['contentGenerator'] = {
    embedContent: async (request: { texts: string[] }) => {
      const raw = (await mockFns.mockEmbedContentFn(request)) as {
        embeddings?: Array<{ values?: number[] }>;
      };
      // Missing embeddings intentionally becomes an empty result so
      // BaseLLMClient exercises its no-embeddings error path.
      const embeddings = Array.isArray(raw.embeddings)
        ? raw.embeddings.map((emb) => emb.values ?? [])
        : [];
      return { embeddings };
    },
    generateContent: mockFns.mockGenerateContentFn,
    countTokens: vi.fn().mockResolvedValue({ totalTokens: 0 }),
    generateContentStream: vi.fn(async () => (async function* () {})()),
  } as unknown as ContentGenerator;

  return client;
}

/**
 * Performs the shared beforeEach setup for Gemini Client tests.
 * Returns the constructed client and mock config.
 */
export async function setupGeminiClient(
  mockFns: ClientMockFns,
): Promise<ClientTestContext> {
  resetAndApplyServiceMocks();
  setupProviderMocks(mockFns);
  const contentGeneratorConfig = setupConfigMock();
  const client = await createAndInitClient(contentGeneratorConfig, mockFns);
  const mockConfig = client['config'];
  return { client, mockConfig };
}
