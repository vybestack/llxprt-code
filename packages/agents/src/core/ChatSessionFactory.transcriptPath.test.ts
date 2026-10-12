import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { createSessionPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { instructionFixture } from './__tests__/instruction-fixture.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { describe, it, expect, vi, type Mock } from 'bun:test';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));
void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));
void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  getEnvironmentContext: vi.fn().mockResolvedValue([]),
}));
void vi.mock('./chatSession.js', () => ({
  ChatSession: vi.fn(),
}));
void vi.mock(
  '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js',
  () => ({
    loadAgentRuntime: vi.fn().mockResolvedValue({
      runtimeContext: {},
      contentGenerator: {},
      toolsView: { listToolNames: () => [] },
    }),
  }),
);
void vi.mock(
  '@vybestack/llxprt-code-core/runtime/providerRuntimeContext.js',
  () => ({
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  }),
);
void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { createChatSession } from './ChatSessionFactory.js';
import { ChatSession } from './chatSession.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import { installChatSessionFactoryConfigFixture } from './chatSessionFactoryConfigFixture.js';

const createFixtureConfig = installChatSessionFactoryConfigFixture();

function makeConfig(): Config {
  const config = createFixtureConfig();
  Object.assign(config, {
    getSessionRecordingService: () => {
      throw new Error('shared Config recording getter used');
    },
  });
  return config;
}

describe('createChatSession unbound recording path', () => {
  it('does not install a Config-backed transcript path on the shared chat', async () => {
    const installedProviders: Array<() => string | undefined> = [];
    const chatDouble = {
      setActiveTodosProvider: vi.fn(),
      setTranscriptPathProvider: (provider: () => string | undefined) => {
        installedProviders.push(provider);
      },
    };
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(() => chatDouble as unknown as ChatSession);
    const history = {
      isEmpty: () => true,
      setBaseTokenOffset: () => undefined,
      estimateTokensForText: () => Promise.resolve(100),
      setActiveTokenizationTarget: () => undefined,
      resetTokenAccounting: () => undefined,
      recalculateTotalTokens: () => Promise.resolve(),
    } as unknown as HistoryService;
    const todo = {
      updateTodoToolAvailabilityFromDeclarations: () => undefined,
      readTodoSnapshot: () => Promise.resolve([]),
      getActiveTodos: () => [],
    } as unknown as TodoContinuationService;

    const config = makeConfig();
    await createChatSession({
      ...createSessionPolicyFixture(),
      instructions: instructionFixture(
        config.getProvidedInstructions(),
        'core memory text',
      ),
      workspaceDirectories: () => fixturePaths().directories(),
      readMcpInstructions: () => undefined,
      config,
      telemetry: createSessionSettingsFixture(config).settingsOwner.telemetry,
      mediaStore: new LocalMediaStore({
        rootDirectory: config.projectTempDir + '/media',
        quotaBytes: config.getMediaStoreQuotaByteLimit(),
      }),
      runtimeState: {
        model: 'gemini-2.5-flash',
        provider: 'gemini',
        runtimeId: 'test-runtime-id',
        sessionId: 'test-session-id',
      } as unknown as AgentRuntimeState,
      contentGenerator: {} as ContentGenerator,
      storedHistoryService: history,
      clearStoredHistoryService: () => undefined,
      generateContentConfig: {},
      todoContinuationService: todo,
      toolRegistry: undefined,
    });

    expect(installedProviders).toHaveLength(0);
  });
});
