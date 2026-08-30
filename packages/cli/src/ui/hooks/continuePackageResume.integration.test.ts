/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  DebugLogger,
  LocalMediaStore,
  MessageBus,
  PerformCompressionResult,
  SessionDiscovery,
  SessionRecordingService,
  emptyModelOutput,
  exportSessionMediaPackage,
  getProjectHash,
  type AgentChatContract,
  type AgentClientContract,
  type IContent,
  type LockHandle,
  type MediaReferenceBlock,
  type RecordingIntegration,
  type SessionMetadata,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { continueCommand } from '../commands/continueCommand.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import { createMockCommandContext } from '../../test-utils/mockCommandContext.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import type { Message } from '../types.js';

interface ActiveRecordingState {
  recording: SessionRecordingService | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

interface PackageFixture {
  readonly directory: string;
  readonly references: readonly MediaReferenceBlock[];
}

function createAgentClient(history: HistoryService): AgentClientContract {
  async function* emptyStream() {}
  const chat: AgentChatContract = {
    sendMessage: async () => emptyModelOutput(),
    sendMessageStream: async () => emptyStream(),
    generateDirectMessage: async () => emptyModelOutput(),
    getHistory: () => history.getAll(),
    setHistory: (next) => history.replaceAll([...next]),
    clearHistory: () => history.clear(),
    getHistoryService: () => history,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.SKIPPED_EMPTY,
    recordCompletedToolCalls: () => {},
  };
  return {
    initialize: async () => {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    getHistory: async () => history.getAll(),
    getHistoryService: () => history,
    storeHistoryServiceForReuse: () => {},
    storeHistoryForLaterUse: async () => {},
    dispose: async () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async (content) => history.add(content),
    resetChat: async () => history.clear(),
    resumeChat: (next) => history.replaceAll([...next]),
    setHistory: (next) => history.replaceAll([...next]),
    restoreHistory: (next) => history.replaceAll([...next]),
    addDirectoryContext: async () => {},
    getContentGenerator: () => {
      throw new Error('Content generation is not used by session resume tests');
    },
    startChat: async () => chat,
    generateDirectMessage: async () => emptyModelOutput(),
    generateJson: async () => ({}),
    generateContent: async () => emptyModelOutput(),
    generateEmbedding: async (texts) => texts.map(() => []),
    sendMessageStream: () => emptyStream(),
    getCurrentSequenceModel: () => null,
  };
}

async function createConfig(
  projectRoot: string,
  sessionId: string,
  history: HistoryService,
): Promise<Config> {
  const client = createAgentClient(history);
  const config = new Config({
    sessionId,
    targetDir: projectRoot,
    cwd: projectRoot,
    debugMode: false,
    model: 'resume-test-model',
    provider: 'resume-test-provider',
    interactive: true,
    agentClientFactory: () => client,
    toolSchedulerFactory: () => ({
      schedule: async () => {},
      cancelAll: () => {},
      dispose: () => {},
      setCallbacks: () => {},
      handleConfirmationResponse: async () => {},
    }),
  });
  await config.initialize({
    messageBus: new MessageBus(config.getPolicyEngine(), false),
  });
  return config;
}

async function createPackage(
  root: string,
  media: readonly Uint8Array[],
): Promise<PackageFixture> {
  const projectHash = 'portable-source-project';
  const sourceRoot = join(root, `source-${randomUUID()}`);
  const sourceStore = new LocalMediaStore({
    rootDirectory: join(sourceRoot, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const references: MediaReferenceBlock[] = [];
  for (const bytes of media) {
    references.push(
      await sourceStore.admit({
        bytes,
        mimeType: 'image/png',
        semanticMetadata: {},
      }),
    );
  }
  const recording = new SessionRecordingService({
    sessionId: randomUUID(),
    projectHash,
    chatsDir: join(sourceRoot, 'chats'),
    workspaceDirs: [],
    provider: 'source-provider',
    model: 'source-model',
    mediaStore: sourceStore,
  });
  recording.recordContent({
    speaker: 'human',
    blocks: [
      { type: 'text', text: 'history restored through perform_resume' },
      ...references,
    ],
  });
  await recording.flush();
  const recordingPath = recording.getFilePath();
  if (recordingPath === null) throw new Error('Expected source recording');
  const directory = join(root, `package-${randomUUID()}`);
  await exportSessionMediaPackage(
    recordingPath,
    projectHash,
    sourceStore,
    directory,
  );
  await recording.dispose();
  return { directory, references };
}

function createActions(): SlashCommandProcessorActions {
  return {
    openAuthDialog: () => {},
    openThemeDialog: () => {},
    openEditorDialog: () => {},
    openPrivacyNotice: () => {},
    openSettingsDialog: () => {},
    openLoggingDialog: () => {},
    openSubagentDialog: () => {},
    openModelsDialog: () => {},
    openPermissionsDialog: () => {},
    openPoliciesDialog: () => {},
    openProviderDialog: () => {},
    openLoadProfileDialog: () => {},
    openCreateProfileDialog: () => {},
    openProfileListDialog: () => {},
    viewProfileDetail: () => {},
    openProfileEditor: () => {},
    quit: () => {},
    setDebugMessage: () => {},
    toggleCorgiMode: () => {},
    toggleDebugProfiler: () => {},
    dispatchExtensionStateUpdate: () => {},
    addConfirmUpdateExtensionRequest: () => {},
    openWelcomeDialog: () => {},
    openSessionBrowserDialog: () => {},
  };
}

function createRecordingCallbacks(
  state: ActiveRecordingState,
  failActivation: boolean,
): RecordingSwapCallbacks {
  return {
    getCurrentRecording: () => state.recording,
    getCurrentIntegration: () => state.integration,
    getCurrentLockHandle: () => state.lock,
    setRecording: (recording, integration, lock, metadata) => {
      if (failActivation) throw new Error('resume activation rejected');
      state.recording = recording;
      state.integration = integration;
      state.lock = lock;
      state.metadata = metadata;
    },
  };
}

function createHandlerDeps(
  config: Config,
  callbacks: RecordingSwapCallbacks,
  messages: Message[],
): SlashCommandHandlerDeps {
  const commandContext = createMockCommandContext({
    services: { config },
    recordingSwapCallbacks: callbacks,
  });
  return {
    commands: [continueCommand],
    config,
    commandContext,
    actions: createActions(),
    addItem: commandContext.ui.addItem,
    addMessage: (message) => messages.push(message),
    setIsProcessing: () => {},
    setLocalIsProcessing: () => {},
    setPendingItem: () => {},
    setSessionShellAllowlist: () => {},
    setConfirmationRequest: () => {},
    recordingSwapCallbacks: callbacks,
    confirmationLogger: new DebugLogger('continue-package-confirmation-test'),
    slashCommandLogger: new DebugLogger('continue-package-resume-test'),
    beginSlashCommandAction: () => new AbortController(),
    endSlashCommandAction: () => {},
  };
}

async function disposeActiveState(state: ActiveRecordingState): Promise<void> {
  await state.integration?.dispose();
  if (state.recording !== null) await state.recording.dispose();
  if (state.lock !== null) await state.lock.release();
}

function historyText(history: readonly IContent[]): string {
  return history
    .flatMap((entry) => entry.blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

describe('continue package perform_resume integration', () => {
  it('publishes the validated package and assigns it only after real resume activation succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'continue-package-resume-'));
    const history = new HistoryService();
    const originalSessionId = randomUUID();
    const config = await createConfig(
      join(root, 'destination-workspace'),
      originalSessionId,
      history,
    );
    const projectTemp = config.storage.getProjectTempDir();
    const state: ActiveRecordingState = {
      recording: null,
      integration: null,
      lock: null,
      metadata: null,
    };
    const messages: Message[] = [];

    try {
      const sessionPackage = await createPackage(root, []);
      const result = await processSlashCommand(
        createHandlerDeps(
          config,
          createRecordingCallbacks(state, false),
          messages,
        ),
        `/continue import ${sessionPackage.directory}`,
      );
      const sessions = await SessionDiscovery.listSessions(
        config.storage.getProjectChatsDir(),
        getProjectHash(config.getProjectRoot()),
      );

      expect(result).toEqual({ type: 'handled' });
      expect(sessions).toHaveLength(1);
      expect(config.getSessionId()).toBe(sessions[0]?.sessionId);
      expect(state.recording?.getSessionId()).toBe(config.getSessionId());
      expect(historyText(history.getAll())).toContain(
        'history restored through perform_resume',
      );
      expect(messages).toEqual([]);
    } finally {
      await disposeActiveState(state);
      await config.dispose();
      await rm(projectTemp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rolls back only new import artifacts when real resume activation fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'continue-package-rollback-'));
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'original active history' }],
    });
    const originalSessionId = randomUUID();
    const config = await createConfig(
      join(root, 'destination-workspace'),
      originalSessionId,
      history,
    );
    const projectTemp = config.storage.getProjectTempDir();
    const destinationStore = config.getLocalMediaStore();
    const deduplicatedBytes = new Uint8Array([10, 20, 30]);
    const importedOnlyBytes = new Uint8Array([40, 50, 60, 70]);
    const preExistingReference = await destinationStore.admit({
      bytes: deduplicatedBytes,
      mimeType: 'image/png',
      semanticMetadata: {},
    });
    const sessionPackage = await createPackage(root, [
      deduplicatedBytes,
      importedOnlyBytes,
    ]);
    const importedOnlyReference = sessionPackage.references.find(
      (_reference, index) => index === 1,
    );
    if (importedOnlyReference === undefined) {
      throw new Error('Expected imported-only package reference');
    }
    const state: ActiveRecordingState = {
      recording: null,
      integration: null,
      lock: null,
      metadata: null,
    };
    const messages: Message[] = [];

    try {
      await processSlashCommand(
        createHandlerDeps(
          config,
          createRecordingCallbacks(state, true),
          messages,
        ),
        `/continue import ${sessionPackage.directory}`,
      );
      const chatEntries = await readdir(
        config.storage.getProjectChatsDir(),
      ).catch((error: unknown) => {
        if (
          typeof error === 'object' &&
          error !== null &&
          'code' in error &&
          error.code === 'ENOENT'
        ) {
          return [];
        }
        throw error;
      });

      expect(chatEntries).toEqual([]);
      expect(config.getSessionId()).toBe(originalSessionId);
      expect(historyText(history.getAll())).toContain(
        'original active history',
      );
      expect(
        await destinationStore.hasReservations(importedOnlyReference.contentId),
      ).toBe(false);
      expect(await destinationStore.getStoredByteLength()).toBe(
        deduplicatedBytes.byteLength,
      );
      expect(await destinationStore.readVerified(preExistingReference)).toEqual(
        deduplicatedBytes,
      );
      await expect(
        destinationStore.readVerified(importedOnlyReference),
      ).rejects.toThrow(importedOnlyReference.contentId);
      expect(messages.some((message) => message.type === 'error')).toBe(true);
    } finally {
      await disposeActiveState(state);
      await config.dispose();
      await rm(projectTemp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
