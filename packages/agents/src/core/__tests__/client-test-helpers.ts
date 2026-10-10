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
 * IMPORTANT: vi.mock() registrations are file-scoped. Each test file that
 * exercises AgentClient must declare its own vi.mock() calls and the mock fns
 * they reference at the top of the file, before the module under test is
 * imported. The setup function below receives those mock fns as arguments so
 * it can wire them into the shared Config and content-generator mocks.
 */

import { vi, type Mock } from 'bun:test';
import type { ContentGeneratorConfig } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { ConfigParameters } from '@vybestack/llxprt-code-core/config/config.js';
import { buildMockContentGenerator } from './chatSession-density-helpers.js';
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
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

/** Build and register the mock Config implementation. */
function setupConfigMock(mockFns: ClientMockFns): ContentGeneratorConfig {
  const MockedConfig = Config as unknown as Mock<(...args: never[]) => unknown>;
  const contentGenerator = buildMockContentGenerator();
  contentGenerator.generateContent = mockFns.mockGenerateContentFn;
  contentGenerator.embedContent = mockFns.mockEmbedContentFn;
  const contentGeneratorConfig: ContentGeneratorConfig = {
    model: 'test-model',
    apiKey: 'test-key',
    vertexai: false,
    contentGeneratorFactory: {
      createContentGenerator: () => contentGenerator,
    },
  };
  const mockConfigObject = Object.assign(
    new HostConfig({
      sessionId: 'test-session-id',
      cwd: process.cwd(),
      targetDir: process.cwd(),
      debugMode: false,
      model: 'test-model',
      telemetry: { enabled: false },
    }),
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
  MockedConfig.mockImplementation(() => mockConfigObject as unknown as Config);
  return contentGeneratorConfig;
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

/**
 * Performs the shared beforeEach setup for agent client tests.
 * Returns the constructed client and mock config.
 */
export async function setupAgentClient(
  mockFns: ClientMockFns,
  config?: Config,
  mediaStore?: LocalMediaStore,
): Promise<ClientTestContext> {
  resetAndApplyServiceMocks();
  const contentGeneratorConfig = setupConfigMock(mockFns);
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
    config,
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
