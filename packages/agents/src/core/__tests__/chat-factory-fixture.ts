import { createSessionSettingsFixture } from '../../api/__tests__/helpers/session-settings-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService } from '@vybestack/llxprt-code-settings';
import type { AdmittedModelParameters } from '@vybestack/llxprt-code-core/runtime/admittedModelParameters.js';
import { instructionFixture } from './instruction-fixture.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
export const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { createFactoryFixtureMediaStore } from './support/chatSessionFactoryMediaTestHelper.js';
import { vi } from 'bun:test';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';

export const realHistoryServiceModule = {
  ...(await import(
    '@vybestack/llxprt-code-core/services/history/HistoryService.js'
  )),
};
const realChatSessionModule = { ...(await import('../chatSession.js')) };
const realProviderRuntimeContextModule = {
  ...(await import(
    '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js'
  )),
};
const realEnvironmentContextModule = {
  ...(await import('@vybestack/llxprt-code-core/utils/environmentContext.js')),
};
const realClientToolGovernance = {
  ...(await import('../clientToolGovernance.js')),
};

/**
 * Bun module mocks are process-wide, so a suite that installs this fixture
 * restores the real modules once it finishes.
 */
export function restoreChatFactoryFixtureModules(): void {
  void vi.mock('../clientToolGovernance.js', () => realClientToolGovernance);
  void vi.mock(
    '@vybestack/llxprt-code-core/utils/environmentContext.js',
    () => realEnvironmentContextModule,
  );
  void vi.mock('../chatSession.js', () => realChatSessionModule);
  void vi.mock(
    '@vybestack/llxprt-code-core/services/history/HistoryService.js',
    () => realHistoryServiceModule,
  );
  void vi.mock(
    '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js',
    () => realProviderRuntimeContextModule,
  );
}

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));

void vi.mock('../clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a', 'tool_b']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

export const environmentContextMock = vi.fn(async (): Promise<never[]> => []);

void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  getEnvironmentContext: environmentContextMock,
}));

void vi.mock('../chatSession.js', () => ({
  ChatSession: vi.fn().mockImplementation(() => ({
    setActiveTodosProvider: vi.fn(),
    setTranscriptPathProvider: vi.fn(),
    getHistoryService: vi.fn().mockReturnValue(null),
  })),
}));

void vi.mock(
  '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js',
  () => ({
    loadAgentRuntime: vi.fn().mockResolvedValue({
      runtimeContext: {},
      contentGenerator: {},
      toolsView: { listToolNames: () => [] },
      history: {},
      providerAdapter: {},
      telemetryAdapter: {},
    }),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js',
  () => ({
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js',
  () => ({
    HistoryService: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      addBatch: vi.fn().mockResolvedValue(undefined),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      resetTokenAccounting: vi.fn(),
      setActiveTokenizationTarget: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(true),
    })),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/ContentConverters.js',
  () => ({
    ContentConverters: {
      toIContent: vi.fn().mockReturnValue({ speaker: 'human', blocks: [] }),
    },
  }),
);

void vi.mock('@vybestack/llxprt-code-core/utils/toolOutputLimiter.js', () => ({
  estimateTokens: vi.fn().mockReturnValue(50),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { TodoContinuationService } from '../TodoContinuationService.js';
import type { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { installChatSessionFactoryConfigFixture } from '../chatSessionFactoryConfigFixture.js';
import { createChatSession } from '../ChatSessionFactory.js';
import { createOwnerPolicyFixture } from './session-policy-fixture.js';
import { observeStoredHistoryReuse } from './chat-session-factory-history-test-observation.js';
const createFixtureConfig = installChatSessionFactoryConfigFixture();

export function makeConfig(
  overrides: Partial<Config> & { userMemory?: string } = {},
): Config {
  const config = createFixtureConfig(undefined, overrides.userMemory);
  Object.assign(config, {
    isJitContextEnabled: () => false,
    isInteractive: () => true,
    ...overrides,
  });
  return config;
}

export function makeRuntimeState(
  overrides: Partial<AgentRuntimeState> = {},
): AgentRuntimeState {
  return {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    runtimeId: 'test-runtime-id',
    sessionId: 'test-session-id',
    proxyUrl: undefined,
    ...overrides,
  } as unknown as AgentRuntimeState;
}

export function makeTodoContinuationService(): TodoContinuationService {
  return {
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    readTodoSnapshot: vi.fn().mockResolvedValue([]),
    getActiveTodos: vi.fn().mockReturnValue([]),
  } as unknown as TodoContinuationService;
}

export const noMcp = (): undefined => undefined;

export function makeContentGenerator(): ContentGenerator {
  return {} as unknown as ContentGenerator;
}

export function makeGenerationDeps(
  runtimeId: string,
  owner = new SessionSettingsOwner(new SettingsService()),
) {
  return {
    workspaceDirectories: () => fixturePaths().directories(),
    readMcpInstructions: noMcp,
    readRuntimeSettings: () => owner.readRuntimePolicy(),
    readToolGovernance: () => owner.readToolGovernance([]),
    prepareProviderInvocation: (
      provider: string,
      parameters?: AdmittedModelParameters,
      signal?: AbortSignal,
    ) =>
      owner.prepareProviderInvocation(runtimeId, provider, parameters, signal),
    contentGenerator: makeContentGenerator(),
    generateContentConfig: {},
    toolRegistry: undefined,
  };
}

export function createTestChatSession(
  config: Config,
  runtimeState: AgentRuntimeState,
  extraHistory?: IContent[],
  mediaStore: LocalMediaStore = createFactoryFixtureMediaStore(config),
): ReturnType<typeof createChatSession> {
  return createChatSession({
    instructions: instructionFixture(
      config.getProvidedInstructions(),
      'core memory text',
    ),
    ...makeGenerationDeps(runtimeState.runtimeId),
    config,
    telemetry: createSessionSettingsFixture(config).settingsOwner.telemetry,
    mediaStore,
    runtimeState,
    storedHistoryService: undefined,
    clearStoredHistoryService: vi.fn(),
    extraHistory,
    todoContinuationService: makeTodoContinuationService(),
  });
}

export const observeReusedHistory = async () => {
  // A mid-session provider switch stores the live (non-empty) HistoryService;
  // setupHistoryService must reuse it as-is and NOT also load extraHistory,
  // or the conversation would be duplicated. This pins the isEmpty()
  // discriminator's other branch.
  const { HistoryService: RealHistoryService } = realHistoryServiceModule;
  const storedHistoryService = new RealHistoryService();
  // Pre-seed the stored service so it is non-empty (simulating a live conv).
  storedHistoryService.add(
    {
      speaker: 'human',
      blocks: [{ type: 'text', text: 'live turn before switch' }],
    },
    'model-x',
  );
  const wasInitiallyNonEmpty = !storedHistoryService.isEmpty();

  const config = makeConfig();
  const runtimeState = makeRuntimeState();
  const todoContinuationService = makeTodoContinuationService();
  const clearStoredHistoryService = vi.fn();

  const extraHistory = [
    {
      speaker: 'human' as const,
      blocks: [{ type: 'text' as const, text: 'stale carried history' }],
    },
  ];

  await createChatSession({
    instructions: instructionFixture(
      config.getProvidedInstructions(),
      'core memory text',
    ),
    ...makeGenerationDeps(runtimeState.runtimeId),
    config,
    telemetry: createSessionSettingsFixture(config).settingsOwner.telemetry,
    mediaStore: createFactoryFixtureMediaStore(config),
    runtimeState,
    storedHistoryService,
    clearStoredHistoryService,
    extraHistory,
    todoContinuationService,
  });

  // The stored service keeps exactly its one live turn; extraHistory was
  // ignored, not appended.
  return {
    clearStoredHistoryService,
    historyState: await observeStoredHistoryReuse(
      storedHistoryService,
      wasInitiallyNonEmpty,
    ),
  };
};

export const configureProfileContextLimit = async () => {
  const config = makeConfig();
  const { owner } = createOwnerPolicyFixture({ 'context-limit': 200000 });
  const runtimeState = makeRuntimeState({
    provider: 'anthropic',
    model: 'claude-opus-4-8',
  });
  const todoContinuationService = makeTodoContinuationService();

  await createChatSession({
    instructions: instructionFixture(
      config.getProvidedInstructions(),
      'core memory text',
    ),
    ...makeGenerationDeps(runtimeState.runtimeId, owner),
    config,
    telemetry: createSessionSettingsFixture(config).settingsOwner.telemetry,
    mediaStore: createFactoryFixtureMediaStore(config),
    runtimeState,
    storedHistoryService: undefined,
    clearStoredHistoryService: vi.fn(),
    todoContinuationService,
  });
};
