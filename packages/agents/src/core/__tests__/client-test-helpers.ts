/**
 * @license
 * Copyright 2025 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import {
  Config as HostConfig,
  TELEMETRY_OUTFILE_BOUND_DEFAULTS,
} from '@vybestack/llxprt-code-core';
import { createSessionPolicyFixture } from './session-policy-fixture.js';
import type { InstructionReadOperations } from '@vybestack/llxprt-code-core/services/workspace-memory-owner.js';

import { emptyInstructionReads } from '@vybestack/llxprt-code-test-utils/core/instructions.js';

import { SettingsService } from '@vybestack/llxprt-code-settings';
import { installModelToolFixture } from './model-tool-fixture.js';
const modelTools = installModelToolFixture();

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
export const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

/**
 * Shared helpers for client test files. Extracted from the original
 * monolithic client.test.ts so no file-level max-lines disable is needed.
 *
 * Bun vi.mock() registrations can affect other files in a shared test process.
 * Tests that need real Config or Turn modules should inject their Config fixture
 * and Turn factory instead of mocking those modules. The legacy setup still
 * supports client tests that register their own module mocks.
 */

import { afterAll, vi, type Mock } from 'bun:test';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { buildMockContentGenerator } from './chatSession-density-helpers.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { ChatSession } from '../chatSession.js';
import type { MessageStreamDeps } from '../MessageStreamOrchestrator.js';
import { AgentClient } from '../client.js';
import { Config } from '@vybestack/llxprt-code-core/config/config.js';
import { DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES } from '@vybestack/llxprt-code-core/config/configTypes.js';
import { createAgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import { setSimulate429 } from '@vybestack/llxprt-code-core/utils/testUtils.js';
import { ComplexityAnalyzer } from '@vybestack/llxprt-code-core/services/complexity-analyzer.js';
import { TodoReminderService } from '@vybestack/llxprt-code-core/services/todo-reminder-service.js';
import { getCoreSystemPromptAsync } from '@vybestack/llxprt-code-core/core/prompts.js';
import { uiTelemetryService } from '@vybestack/llxprt-code-core/telemetry/uiTelemetry.js';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const fixtureHistories = new Set<HistoryService>();
afterAll(async () => {
  for (const history of fixtureHistories) await history.dispose();
  fixtureHistories.clear();
});
export function createClientHistoryFixture(): Pick<
  ChatSession,
  'getHistoryService' | 'clearHistoryForDisposal'
> {
  const history = new HistoryService();
  return {
    getHistoryService: () => history,
    clearHistoryForDisposal: async (): Promise<void> => {
      await history.dispose();
    },
  };
}

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
  instructionData: {
    userMemory: string;
    coreMemory: string;
    jitMemory: string;
  };
  instructionReads: InstructionReadOperations;
}

/**
 * Neutral structural type for the vi.mock of generateContentResponseUtilities.
 * Used by all client test files to type the mocked `getResponseText` parameter
 * without importing any Google provider type.
 */
export interface MockResponseShape {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
}

export interface ClientMockFns {
  mockChatCreateFn: ReturnType<typeof vi.fn>;
  mockGenerateContentFn: ReturnType<typeof vi.fn>;
  mockEmbedContentFn: ReturnType<typeof vi.fn>;
  createTurn?: MessageStreamDeps['createTurn'];
  readonly model?: string;
}

/** Reset all mocks and re-apply the shared service mocks. */
function resetAndApplyServiceMocks(): void {
  vi.resetAllMocks();
  (
    uiTelemetryService.setLastPromptTokenCount as Mock<
      typeof uiTelemetryService.setLastPromptTokenCount
    >
  ).mockClear();

  (
    getCoreSystemPromptAsync as Mock<typeof getCoreSystemPromptAsync>
  ).mockResolvedValue('Test system instruction');

  (
    ComplexityAnalyzer as unknown as Mock<(...args: never[]) => unknown>
  ).mockImplementation(
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

  (
    TodoReminderService as unknown as Mock<(...args: never[]) => unknown>
  ).mockImplementation(
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

function buildClientContentGeneratorConfig(
  mockFns: ClientMockFns,
): ContentGeneratorConfig {
  const contentGenerator = buildMockContentGenerator();
  contentGenerator.generateContent = mockFns.mockGenerateContentFn;
  contentGenerator.embedContent = mockFns.mockEmbedContentFn;
  return {
    model: 'test-model',
    apiKey: 'test-key',
    vertexai: false,
    contentGeneratorFactory: {
      createContentGenerator: () => contentGenerator,
    },
  };
}

/** Build the Config fixture, optionally injecting it without a module mock. */
function setupConfigMock(
  mockFns: ClientMockFns,
  useInjectedConfig: boolean,
): { contentGeneratorConfig: ContentGeneratorConfig; config: Config } {
  const contentGeneratorConfig = buildClientContentGeneratorConfig(mockFns);
  // The automocked Config constructor loses its instance-building
  // implementation when vi.resetAllMocks() runs (Bun 1.4 resets mock
  // implementations), so build the instance from the mocked prototype directly.
  const mockConfigObject = Object.assign(
    useInjectedConfig
      ? new HostConfig({
          sessionId: 'test-session-id',
          cwd: process.cwd(),
          targetDir: process.cwd(),
          debugMode: false,
          model: 'test-model',
          telemetry: { enabled: false },
        })
      : Object.create(HostConfig.prototype),
    {
      getContentGeneratorConfig: vi
        .fn()
        .mockReturnValue(contentGeneratorConfig),
      getModel: vi.fn().mockReturnValue('test-model'),
      getEmbeddingModel: vi.fn().mockReturnValue('test-embedding-model'),
      getApiKey: vi.fn().mockReturnValue('test-key'),
      getVertexAI: vi.fn().mockReturnValue(false),
      getUserAgent: vi.fn().mockReturnValue('test-agent'),
      isJitContextEnabled: vi.fn().mockReturnValue(false),

      getSessionId: vi.fn().mockReturnValue('test-session-id'),
      // The automocked Config only mocks methods declared on Config itself,
      // so telemetry getters inherited from the config base classes are
      // absent and must be supplied for session telemetry binding.
      getTelemetryEnabled: vi.fn().mockReturnValue(false),
      getTelemetryOutfile: vi.fn().mockReturnValue(undefined),
      getTelemetryOutfileMaxBytes: vi
        .fn()
        .mockReturnValue(TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxBytes),
      getTelemetryOutfileMaxFiles: vi
        .fn()
        .mockReturnValue(TELEMETRY_OUTFILE_BOUND_DEFAULTS.outfileMaxFiles),
      getProxy: vi.fn().mockReturnValue(undefined),
      getWorkingDir: vi.fn().mockReturnValue('/test/dir'),
      getMaxSessionTurns: vi.fn().mockReturnValue(0),
      getNoBrowser: vi.fn().mockReturnValue(false),
      getUsageStatisticsEnabled: vi.fn().mockReturnValue(true),
      getIdeMode: vi.fn().mockReturnValue(true),
      getDebugMode: vi.fn().mockReturnValue(false),

      setFallbackMode: vi.fn(),
      getProvider: vi.fn().mockReturnValue('gemini'),
      getComplexityAnalyzerSettings: vi.fn().mockReturnValue({
        complexityThreshold: 0.5,
        minTasksForSuggestion: 3,
        suggestionCooldownMs: 300000,
      }),
      getContinueOnFailedApiCall: vi.fn().mockReturnValue(true),
      getImagePayloadBudgetBytes: vi
        .fn()
        .mockReturnValue(DEFAULT_IMAGE_PAYLOAD_BUDGET_BYTES),
      getChatCompression: vi.fn().mockReturnValue(undefined),
      isTrustedFolder: () => true,
      isInteractive: vi.fn().mockReturnValue(true),
      getModelRouterService: vi.fn().mockReturnValue(undefined),
    },
  );
  const config = mockConfigObject as unknown as Config;
  if (!useInjectedConfig) {
    const MockedConfig = Config as unknown as Mock<
      (...args: never[]) => unknown
    >;
    MockedConfig.mockImplementation(() => config);
  }
  return { contentGeneratorConfig, config };
}

/** Instantiate the AgentClient and wire its chat mock. */
async function createAndInitClient(
  contentGeneratorConfig: ContentGeneratorConfig,
  createTurn?: MessageStreamDeps['createTurn'],
  config?: Config,
  mediaStore?: LocalMediaStore,
  instructions: InstructionReadOperations = emptyInstructionReads,
  model = 'test-model',
): Promise<AgentClient> {
  const mockConfig =
    config ??
    new Config({
      sessionId: 'test-session-id',
    } as ConfigParameters);
  const runtimeState = createAgentRuntimeState({
    runtimeId: 'test-runtime',
    provider: 'gemini',
    model,
    sessionId: 'test-session-id',
  });
  const client = new AgentClient(
    mockConfig,
    runtimeState,
    () => undefined,
    mediaStore ??
      new LocalMediaStore({
        rootDirectory: join(tmpdir(), `client-test-${randomUUID()}`),
        quotaBytes: 1024 * 1024,
      }),
    fixturePaths(),
    undefined,
    createTurn,
    instructions,
  );
  const policies = createSessionPolicyFixture(
    new SettingsService(),
    runtimeState.runtimeId,
  );
  policies.owner.initializeProviderSelection(
    runtimeState.provider,
    runtimeState.model,
  );
  client.bindRuntimeSettings(policies.readRuntimeSettings, () =>
    policies.owner.readToolGovernance([]),
  );
  policies.owner.bindTelemetry(mockConfig);
  client.bindTelemetry(policies.owner.telemetry);
  client.bindProviderInvocation(policies.prepareProviderInvocation);
  client.bindToolSelection(modelTools());
  await client.initialize(contentGeneratorConfig);

  // Tests steer the history seen by the client by resolving this stub.
  const stubbedHistory = vi
    .fn<() => Promise<readonly IContent[]>>()
    .mockResolvedValue([]);
  client.getHistory = stubbedHistory as unknown as typeof client.getHistory;
  vi.spyOn(client, 'streamHistory').mockImplementation(async function* () {
    yield* await stubbedHistory();
  });

  const historyService = new HistoryService();
  fixtureHistories.add(historyService);
  const mockChat = {
    addHistory: vi.fn(),
    getHistory: vi.fn().mockReturnValue([]),
    getHistoryService: vi.fn().mockReturnValue(historyService),
    clearHistory: vi.fn(async () => {
      await historyService.clear();
    }),
    clearHistoryForDisposal: async (): Promise<void> => {
      await historyService.dispose();
    },
    sendMessageStream: vi.fn(),
    getLastPromptTokenCount: vi.fn().mockReturnValue(0),
    getProjectedPromptBaseline: vi.fn().mockReturnValue(0),
    getContextLimit: vi.fn().mockReturnValue(0),
    getConfig: vi.fn().mockReturnValue(undefined),
    getTokenUsageLogger: vi.fn().mockReturnValue({
      isEnabled: () => false,
    }),
  };
  client['chat'] = mockChat as unknown as ChatSession;

  return client;
}

export interface SetupAgentClientOptions {
  /** Inject the fixture Config instead of registering a Config module mock. */
  useInjectedConfig?: boolean;
  config?: Config;
  mediaStore?: LocalMediaStore;
}

function isSetupOptions(
  value: Config | SetupAgentClientOptions | undefined,
): value is SetupAgentClientOptions | undefined {
  return (
    value === undefined ||
    'useInjectedConfig' in value ||
    'mediaStore' in value ||
    'config' in value
  );
}

/**
 * Performs the shared beforeEach setup for agent client tests.
 * Returns the constructed client and mock config.
 */
export async function setupAgentClient(
  mockFns: ClientMockFns,
  configOrOptions?: Config | SetupAgentClientOptions,
  mediaStoreArg?: LocalMediaStore,
): Promise<ClientTestContext> {
  const options: SetupAgentClientOptions = isSetupOptions(configOrOptions)
    ? (configOrOptions ?? {})
    : { config: configOrOptions };
  const mediaStore = options.mediaStore ?? mediaStoreArg;
  const useInjectedConfig = options.useInjectedConfig === true;
  if (!useInjectedConfig) {
    resetAndApplyServiceMocks();
  }
  const { contentGeneratorConfig, config } = setupConfigMock(
    mockFns,
    useInjectedConfig,
  );
  const instructionData = { userMemory: '', coreMemory: '', jitMemory: '' };
  const instructions: InstructionReadOperations = {
    snapshot: () => ({
      memoryContent: instructionData.userMemory,
      globalMemory: instructionData.userMemory,
      coreMemory: instructionData.coreMemory,
      environmentMemory: '',
      filePaths: [],
      fileCount: 0,
      coreMemoryFileCount: 0,
    }),
    jit: vi.fn(async () => instructionData.jitMemory),
  };
  const client = await createAndInitClient(
    contentGeneratorConfig,
    mockFns.createTurn,
    options.config ?? (useInjectedConfig ? config : undefined),
    mediaStore,
    instructions,
    mockFns.model,
  );
  const mockConfig = client['config'];
  return {
    client,
    mockConfig,
    instructionData,
    instructionReads: instructions,
  };
}
