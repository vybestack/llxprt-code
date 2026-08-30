/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioural tests for issue #2933: createChatSession must hand the chat a
 * transcript path provider that reads the recording service off Config on
 * every call. Recording can be enabled part way through a session, swapped for
 * a different service by a resume, or stopped, and the JSONL file does not
 * exist until the recorder materializes it — a value captured at construction
 * would be wrong in all four situations.
 */

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';

void vi.mock('@vybestack/llxprt-code-core/core/prompts.js', () => ({
  getCoreSystemPromptAsync: vi.fn().mockResolvedValue('core system prompt'),
}));

void vi.mock('./clientToolGovernance.js', () => ({
  getToolGovernanceEphemerals: vi.fn().mockReturnValue(undefined),
  getEnabledToolNamesForPrompt: vi.fn().mockReturnValue(['tool_a', 'tool_b']),
  shouldIncludeSubagentDelegationForConfig: vi.fn().mockResolvedValue(false),
  buildToolDeclarationsFromView: vi.fn().mockReturnValue([]),
}));

void vi.mock('@vybestack/llxprt-code-core/utils/environmentContext.js', () => ({
  getEnvironmentContext: vi.fn().mockResolvedValue([]),
}));

void vi.mock('./chatSession.js', () => ({
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
    setProviderRuntimeStateFactory: vi.fn(),
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
  }),
);

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js',
  () => ({
    HistoryService: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      setTokenizerFactory: vi.fn(),
      setActiveTokenizationTarget: vi.fn(),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(true),
      getAll: vi.fn().mockReturnValue([]),
    })),
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
import type { TodoContinuationService } from './TodoContinuationService.js';

interface RecordingServiceStub {
  isActive: () => boolean;
  getFilePath: () => string | null;
}

function activeRecording(filePath: string | null): RecordingServiceStub {
  return { isActive: () => true, getFilePath: () => filePath };
}

function makeConfig(
  getSessionRecordingService: () => RecordingServiceStub | undefined,
): Config {
  return {
    getEphemeralSetting: vi.fn().mockReturnValue(undefined),
    isJitContextEnabled: vi.fn().mockReturnValue(false),
    getGlobalMemory: vi.fn().mockReturnValue(undefined),
    getUserMemory: vi.fn().mockReturnValue('user memory text'),
    getCoreMemory: vi.fn().mockReturnValue('core memory text'),
    getJitMemoryForPath: vi.fn().mockResolvedValue(null),
    getMcpInstructions: vi.fn().mockReturnValue(undefined),
    isInteractive: vi.fn().mockReturnValue(true),
    getWorkingDir: vi.fn().mockReturnValue('/workspace'),
    getSettingsService: vi.fn().mockReturnValue({
      get: vi.fn().mockReturnValue(undefined),
    }),
    getContentGeneratorConfig: vi.fn().mockReturnValue({}),
    getModel: vi.fn().mockReturnValue('gemini-2.5-flash'),
    getToolRegistry: vi.fn().mockReturnValue(undefined),
    getProviderManager: vi.fn().mockReturnValue(undefined),
    getSessionRecordingService,
  } as unknown as Config;
}

function makeRuntimeState(): AgentRuntimeState {
  return {
    model: 'gemini-2.5-flash',
    provider: 'gemini',
    runtimeId: 'test-runtime-id',
    sessionId: 'test-session-id',
    proxyUrl: undefined,
  } as unknown as AgentRuntimeState;
}

function makeTodoContinuationService(): TodoContinuationService {
  return {
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    readTodoSnapshot: vi.fn().mockResolvedValue([]),
    getActiveTodos: vi.fn().mockReturnValue([]),
  } as unknown as TodoContinuationService;
}

describe('createChatSession transcript path wiring (#2933)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Builds a chat session against a Config whose recording service can be
   * changed afterwards, and returns the provider the factory installed.
   */
  async function wireProvider(
    readRecording: () => RecordingServiceStub | undefined,
  ): Promise<() => string | undefined> {
    const installedProviders: Array<() => string | undefined> = [];
    const chatDouble = {
      setActiveTodosProvider: vi.fn(),
      setTranscriptPathProvider: (provider: () => string | undefined) => {
        installedProviders.push(provider);
      },
      getHistoryService: vi.fn().mockReturnValue(null),
    };
    (
      ChatSession as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(() => chatDouble as unknown as ChatSession);

    await createChatSession({
      config: makeConfig(readRecording),
      runtimeState: makeRuntimeState(),
      contentGenerator: {} as unknown as ContentGenerator,
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      generateContentConfig: {},
      todoContinuationService: makeTodoContinuationService(),
      toolRegistry: undefined,
    });

    expect(installedProviders).toHaveLength(1);
    return installedProviders[0];
  }

  it('resolves no path while recording is disabled', async () => {
    const resolvePath = await wireProvider(() => undefined);

    expect(resolvePath()).toBeUndefined();
  });

  it('resolves no path while the recording has not materialized a file', async () => {
    const resolvePath = await wireProvider(() => activeRecording(null));

    expect(resolvePath()).toBeUndefined();
  });

  it('resolves no path from a recorder that stopped on a write failure', async () => {
    const resolvePath = await wireProvider(() => ({
      isActive: () => false,
      getFilePath: () => '/chats/session-one.jsonl',
    }));

    expect(resolvePath()).toBeUndefined();
  });

  it('resolves the materialized path of the installed recording', async () => {
    const resolvePath = await wireProvider(() =>
      activeRecording('/chats/session-one.jsonl'),
    );

    expect(resolvePath()).toBe('/chats/session-one.jsonl');
  });

  it('follows a resume that swaps the recording service, then a stop', async () => {
    let installed: RecordingServiceStub | undefined = activeRecording(
      '/chats/session-one.jsonl',
    );
    const resolvePath = await wireProvider(() => installed);

    expect(resolvePath()).toBe('/chats/session-one.jsonl');

    installed = activeRecording('/chats/resumed-session.jsonl');
    expect(resolvePath()).toBe('/chats/resumed-session.jsonl');

    installed = undefined;
    expect(resolvePath()).toBeUndefined();
  });
});
