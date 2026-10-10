import { createSessionSettingsFixture } from '../api/__tests__/helpers/session-settings-fixture.js';
import { createSessionPolicyFixture } from './__tests__/session-policy-fixture.js';
/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Behavioral tests for token re-estimation on HistoryService reuse.
 * Verifies that when createChatSession reuses a stored HistoryService
 * across a provider switch, it resets stale token accounting and
 * re-estimates all history tokens with the new provider's tokenizer.
 */
import { instructionFixture } from './__tests__/instruction-fixture.js';

import { installTestWorkspacePaths } from '@vybestack/llxprt-code-test-utils/core/config.js';
const fixturePaths = installTestWorkspacePaths({
  targetDir: process.cwd(),
  isTrusted: () => true,
});

import { describe, it, expect, vi, beforeEach, type Mock } from 'bun:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { MediaAdmissionService } from '@vybestack/llxprt-code-core/storage/media-admission-service.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import { withChatSessionFactoryMediaFixture } from './chatSessionFactoryMediaTestHelper.js';

const realHistoryServiceModule = {
  ...(await import(
    '@vybestack/llxprt-code-core/services/history/HistoryService.js'
  )),
};

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
    createProviderRuntimeContext: vi.fn().mockReturnValue({}),
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

void vi.mock(
  '@vybestack/llxprt-code-core/services/history/HistoryService.js',
  () => ({
    HistoryService: vi.fn().mockImplementation(() => ({
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      setTokenizerFactory: vi.fn(),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      getTotalTokens: vi.fn().mockReturnValue(0),
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
      isEmpty: vi.fn().mockReturnValue(false),
      getAll: vi.fn().mockReturnValue([]),
    })),
  }),
);

void vi.mock('@vybestack/llxprt-code-core/utils/errorReporting.js', () => ({
  reportError: vi.fn().mockResolvedValue(undefined),
}));

import { createChatSession } from './ChatSessionFactory.js';
import type { Config } from '@vybestack/llxprt-code-core/config/config.js';
import type { AgentRuntimeState } from '@vybestack/llxprt-code-core/runtime/AgentRuntimeState.js';
import type { ContentGenerator } from '@vybestack/llxprt-code-core/core/contentGenerator.js';
import type { TodoContinuationService } from './TodoContinuationService.js';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { installChatSessionFactoryConfigFixture } from './chatSessionFactoryConfigFixture.js';

const createFixtureConfig = installChatSessionFactoryConfigFixture();

function makeConfig(overrides: Partial<Config> = {}): Config {
  const config = createFixtureConfig();
  Object.assign(config, {
    ...overrides,
  });
  return config;
}

function makeRuntimeState(
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

function makeTodoContinuationService(): TodoContinuationService {
  return {
    updateTodoToolAvailabilityFromDeclarations: vi.fn(),
    readTodoSnapshot: vi.fn().mockResolvedValue([]),
    getActiveTodos: vi.fn().mockReturnValue([]),
  } as unknown as TodoContinuationService;
}

function makeContentGenerator(): ContentGenerator {
  return {} as unknown as ContentGenerator;
}

function makeReusedHistoryService(): HistoryService & {
  resetTokenAccounting: ReturnType<typeof vi.fn>;
  recalculateTotalTokens: ReturnType<typeof vi.fn>;
  setTokenizerFactory: ReturnType<typeof vi.fn>;
  setActiveTokenizationTarget: ReturnType<typeof vi.fn>;
} {
  return {
    add: vi.fn(),
    generateTurnKey: vi.fn().mockReturnValue('turn-1'),
    setBaseTokenOffset: vi.fn(),
    estimateTokensForText: vi.fn().mockResolvedValue(100),
    setTokenizerFactory: vi.fn(),
    setActiveTokenizationTarget: vi.fn(),
    resetTokenAccounting: vi.fn(),
    recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
    getTotalTokens: vi.fn().mockReturnValue(0),
    waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    isEmpty: vi.fn().mockReturnValue(false),
    getAll: vi.fn().mockReturnValue([]),
  } as unknown as HistoryService & {
    resetTokenAccounting: ReturnType<typeof vi.fn>;
    recalculateTotalTokens: ReturnType<typeof vi.fn>;
    setTokenizerFactory: ReturnType<typeof vi.fn>;
    setActiveTokenizationTarget: ReturnType<typeof vi.fn>;
  };
}

describe('createChatSession - token re-estimation on HistoryService reuse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('resets token accounting and re-estimates tokens when reusing HistoryService', async () => {
    const config = makeConfig({
      getModel: vi.fn().mockReturnValue('claude-3-5-sonnet-20241022'),
    });
    const runtimeState = makeRuntimeState({
      model: 'claude-3-5-sonnet-20241022',
      provider: 'anthropic',
    });
    const todoContinuationService = makeTodoContinuationService();
    const reusedHistory = makeReusedHistoryService();

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
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: reusedHistory,
      clearStoredHistoryService: vi.fn(),
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(reusedHistory.resetTokenAccounting).toHaveBeenCalledTimes(1);
    expect(reusedHistory.recalculateTotalTokens).toHaveBeenCalledTimes(1);
    expect(reusedHistory.setActiveTokenizationTarget).toHaveBeenCalledWith(
      'claude-3-5-sonnet-20241022',
      'anthropic',
    );
    expect(reusedHistory.recalculateTotalTokens).toHaveBeenCalledWith();
  });

  it('does NOT reset token accounting when creating a new HistoryService', async () => {
    const { HistoryService } = await import(
      '@vybestack/llxprt-code-core/services/history/HistoryService.js'
    );
    const newHistoryInstance = {
      add: vi.fn(),
      generateTurnKey: vi.fn().mockReturnValue('turn-1'),
      setBaseTokenOffset: vi.fn(),
      estimateTokensForText: vi.fn().mockResolvedValue(100),
      setActiveTokenizationTarget: vi.fn(),
      setTokenizerFactory: vi.fn(),
      resetTokenAccounting: vi.fn(),
      recalculateTotalTokens: vi.fn().mockResolvedValue(undefined),
      getTotalTokens: vi.fn().mockReturnValue(0),
      waitForTokenUpdates: vi.fn().mockResolvedValue(undefined),
    };
    (
      HistoryService as unknown as Mock<(...args: never[]) => unknown>
    ).mockImplementationOnce(
      () => newHistoryInstance as unknown as HistoryService,
    );

    const config = makeConfig();
    const runtimeState = makeRuntimeState();
    const todoContinuationService = makeTodoContinuationService();

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
      runtimeState,
      contentGenerator: makeContentGenerator(),
      storedHistoryService: undefined,
      clearStoredHistoryService: vi.fn(),
      generateContentConfig: {},
      todoContinuationService,
      toolRegistry: undefined,
    });

    expect(newHistoryInstance.resetTokenAccounting).not.toHaveBeenCalled();
    expect(newHistoryInstance.recalculateTotalTokens).not.toHaveBeenCalled();
  });
});

describe('createChatSession explicit media input', () => {
  it('uses the supplied store for retained base64 and reference history and the runtime loader', async () => {
    await withChatSessionFactoryMediaFixture(async (fixture) => {
      const configDirectory = await mkdtemp(join(tmpdir(), 'factory-config-'));
      const configStore = new LocalMediaStore({
        rootDirectory: join(configDirectory, 'media'),
        quotaBytes: 1024 * 1024,
      });
      try {
        const config = makeConfig();
        const admission = new MediaAdmissionService(fixture.store);
        const sourceContext = { turnId: 'source', source: 'test' };
        const references = await admission.admitContents(
          fixture.history,
          sourceContext,
        );
        await admission.releaseContents(references, sourceContext);
        const reference = references[0].blocks[0];
        const base64 = fixture.history[0].blocks[0];
        if (
          reference.type !== 'media' ||
          reference.encoding !== 'reference' ||
          base64.type !== 'media' ||
          base64.encoding !== 'base64'
        ) {
          throw new Error('Expected base64 and reference media');
        }

        const { HistoryService: RealHistoryService } = realHistoryServiceModule;
        const historyService = new RealHistoryService();
        await createChatSession({
          ...createSessionPolicyFixture(),
          instructions: instructionFixture(
            config.getProvidedInstructions(),
            'core memory text',
          ),
          workspaceDirectories: () => fixturePaths().directories(),
          readMcpInstructions: () => undefined,
          config,
          telemetry:
            createSessionSettingsFixture(config).settingsOwner.telemetry,
          mediaStore: fixture.store,
          runtimeState: makeRuntimeState(),
          contentGenerator: makeContentGenerator(),
          storedHistoryService: historyService,
          clearStoredHistoryService: vi.fn(),
          extraHistory: [...fixture.history, references[0]],
          generateContentConfig: {},
          todoContinuationService: makeTodoContinuationService(),
          toolRegistry: undefined,
        });

        const retained = historyService.getAll();
        expect(retained).toHaveLength(2);
        for (const entry of retained) {
          const block = entry.blocks[0];
          if (block.type !== 'media' || block.encoding !== 'reference') {
            throw new Error('Expected retained media reference');
          }
          expect(block.contentId).toBe(reference.contentId);
          expect(await fixture.store.readVerified(block)).toStrictEqual(
            Buffer.from(base64.data, 'base64'),
          );
          expect(await fixture.store.hasReservations(block.contentId)).toBe(
            false,
          );
        }
        const objectName = reference.contentId.slice('sha256:'.length);
        expect(
          await readFile(
            join(fixture.store.rootDirectory, 'objects', 'sha256', objectName),
          ),
        ).toStrictEqual(Buffer.from(base64.data, 'base64'));
        await expect(
          readFile(
            join(configStore.rootDirectory, 'objects', 'sha256', objectName),
          ),
        ).rejects.toThrow('ENOENT');
        expect(await configStore.getStoredByteLength()).toBe(0);
        const { loadAgentRuntime } = await import(
          '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js'
        );
        expect(loadAgentRuntime).toHaveBeenCalledWith(
          expect.objectContaining({ mediaStore: fixture.store }),
        );
      } finally {
        await configStore.close();
        await rm(configDirectory, { recursive: true, force: true });
      }
    });
  });

  async function startMediaChat(
    config: Config,
    store: LocalMediaStore,
    history: readonly IContent[],
  ): Promise<void> {
    const { HistoryService: RealHistoryService } = realHistoryServiceModule;
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
      mediaStore: store,
      runtimeState: makeRuntimeState(),
      contentGenerator: makeContentGenerator(),
      storedHistoryService: new RealHistoryService(),
      clearStoredHistoryService: vi.fn(),
      extraHistory: history,
      generateContentConfig: {},
      todoContinuationService: makeTodoContinuationService(),
      toolRegistry: undefined,
    });
  }

  it('releases admitted history after a post-admission setup error without reading Config media', async () => {
    await withChatSessionFactoryMediaFixture(async (fixture) => {
      const config = makeConfig();
      const { loadAgentRuntime } = await import(
        '@vybestack/llxprt-code-core/runtime/AgentRuntimeLoader.js'
      );
      (loadAgentRuntime as Mock<typeof loadAgentRuntime>).mockRejectedValueOnce(
        new Error('runtime setup failed'),
      );

      await expect(
        startMediaChat(config, fixture.store, fixture.history),
      ).rejects.toThrow('runtime setup failed');
      expect(await fixture.hasReservationsAfterProbe()).toBe(false);
    });
  });

  it('releases temporary initial media admission after successful setup', async () => {
    await withChatSessionFactoryMediaFixture(async (fixture) => {
      const config = makeConfig();
      await startMediaChat(config, fixture.store, fixture.history);
      expect(await fixture.hasReservationsAfterProbe()).toBe(false);
    });
  });
});
