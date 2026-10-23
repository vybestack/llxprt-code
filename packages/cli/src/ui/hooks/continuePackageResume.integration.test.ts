/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { buildSettingsRuntime } from '../../runtime/createRuntimeOwnerFeatures.js';

import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';
import {
  createTestFilesystem,
  installTestWorkspaceFilesystem,
  testConfigInitialization,
} from '@vybestack/llxprt-code-test-utils/core/config.js';
import { afterEach, describe, expect, it } from 'bun:test';
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}
const composeFixtureRuntime = installWorkspaceRuntimeFixture();

import {
  Config,
  DebugLogger,
  emptyModelOutput,
  getProjectHash,
  LocalMediaStore,
  PerformCompressionResult,
  SessionDiscovery,
  type AgentChatContract,
  type AgentClientContract,
  type IContent,
  type LockHandle,
  type RecordingIntegration,
  type RuntimeProviderManager,
  type SessionMetadata,
  type SessionRecordingPort,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { configureProviderRuntimeFactories } from '@vybestack/llxprt-code-providers/composition.js';
import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  writeFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import { createPortablePackage as createPackage } from '../../__tests__/support/portable-package.js';
import { continueCommand } from '../commands/continueCommand.js';
import {
  processSlashCommand,
  type SlashCommandHandlerDeps,
} from './slashCommandHandlers.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';

import { SESSION_FILE_EXTENSION } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { recordedRows } from '../../../../agents/src/api/__tests__/support/recorded-rows.js';

import { setupSessionRecording } from '../../cliSessionBootstrap.js';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';
import type { RecordingSwapCallbacks } from '../../services/performResume.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
} from '../../utils/cleanup.js';
import { MessageType, type Message } from '../types.js';

interface ActiveRecordingState {
  recording: SessionRecordingPort | null;
  integration: RecordingIntegration | null;
  lock: LockHandle | null;
  metadata: SessionMetadata | null;
}

function createAgentClient(
  history: HistoryService,
  mediaStore: LocalMediaStore,
  config: Config,
  manager: RuntimeProviderManager,
): AgentClientContract {
  async function* emptyStream() {}
  let deferredHistory: readonly IContent[] | undefined;
  const chat: AgentChatContract = {
    takeHistoryAdmissions: () => [],
    sendMessage: async () => emptyModelOutput(),
    sendMessageStream: async () => emptyStream(),
    generateDirectMessage: async () => emptyModelOutput(),
    getHistory: (_curated, signal) => history.streamRawHistory(signal),
    streamHistory: (signal) => history.streamRawHistory(signal),
    setHistory: (next) => history.replaceAll([...next]),
    clearHistory: () => history.clear(),
    getHistoryService: () => history,
    wasRecentlyCompressed: () => false,
    performCompression: async () => PerformCompressionResult.SKIPPED_EMPTY,
    recordCompletedToolCalls: () => {},
  };
  let tools: AgentClientContract['tools'] | undefined;
  return {
    get tools() {
      if (tools === undefined)
        throw new Error('Missing fixture tool selection');
      return tools;
    },
    bindRuntimeSettings: () => {},
    bindTelemetry: () => {},
    bindProviderInvocation: () => {},
    getContentGeneratorConfig: () => undefined,
    bindToolSelection: (selection) => {
      tools = selection;
    },
    mediaStore,
    assertConfig: (expected) => {
      if (expected !== config) throw new Error('Different fixture Config');
    },
    assertProviderManager: (expected) => {
      if (expected !== manager) throw new Error('Different fixture manager');
    },
    initialize: async () => {},
    isInitialized: () => true,
    hasChatInitialized: () => true,
    getChat: () => chat,
    getHistory: (_curated, signal) => history.streamRawHistory(signal),
    streamHistory: (signal) => history.streamRawHistory(signal),
    getHistoryService: () => history,
    storeHistoryServiceForReuse: () => {},
    prepareHistoryRebind: () => {
      throw new Error(
        'Profile history rebinding is not used by session resume tests',
      );
    },
    storeHistoryForLaterUse: async (next) => {
      const rows: IContent[] = [];
      for await (const row of next) rows.push(row);
      deferredHistory = rows;
      await history.replaceAll(deferredHistory);
    },
    discardDeferredHistory: async () => {
      deferredHistory = undefined;
    },
    dispose: async () => {},
    setTools: async () => {},
    clearTools: () => {},
    updateSystemInstruction: async () => {},
    addHistory: async (content) => history.add(content),
    resetChat: async (preserveHistory) => {
      const rows: IContent[] = [];
      for await (const row of preserveHistory ?? []) rows.push(row);
      await history.replaceAll(rows);
      deferredHistory = undefined;
    },
    resumeChat: (next) => history.replaceAll([...next]),
    setHistory: (next) => history.replaceAll([...next]),
    setHistoryFromSource: async () => {
      throw new Error('Streamed history requires a real agent client');
    },
    restoreHistory: (next) => history.replaceAll([...next]),
    addDirectoryContext: async () => {},
    getContentGenerator: () => {
      throw new Error('Content generation is not used by session resume tests');
    },
    startChat: async () => {
      if (deferredHistory !== undefined) {
        await history.replaceAll([...deferredHistory]);
        deferredHistory = undefined;
      }
      return chat;
    },
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
  continueSession?: string,
): Promise<{
  config: Config;
  sessionClient: SessionClientOwner;
  settingsOwner: SessionSettingsOwner;
  dispose(): Promise<void>;
}> {
  await mkdir(projectRoot, { recursive: true });
  const config = new Config({
    sessionId,
    targetDir: projectRoot,
    cwd: projectRoot,
    debugMode: false,
    model: 'resume-test-model',
    provider: 'resume-test-provider',
    interactive: true,
    continueSession,
  });
  const configPolicy = new RuntimePolicyOwner(config);
  const store = new LocalMediaStore({
    rootDirectory: join(new Storage(projectRoot).getProjectTempDir(), 'media'),
    quotaBytes: 1024 * 1024,
  });
  const settingsService = new SettingsService();
  const settingsOwner = new SessionSettingsOwner(settingsService);
  settingsOwner.bindTelemetry(config);
  const manager = new ProviderManager({
    config,
    settingsService,
  });
  const client = createAgentClient(history, store, config, manager);
  const factories = configureProviderRuntimeFactories(config, manager);
  const sessionClient = await SessionClientOwner.create(
    config,
    assembleTaskSchemaPolicy(settingsService),
    manager,
    () => client,
    store,
    () => undefined,
    fixturePaths(),
    settingsOwner,
    factories.contentGeneratorFactory,
    factories.tokenizerFactory,
    client,
  );
  await config.initialize(
    testConfigInitialization(
      config,
      configPolicy.session.messageBus,
      configPolicy,
      createTestFilesystem(config),
    ),
  );
  return {
    config,
    sessionClient,
    settingsOwner,
    dispose: async () => {
      await history.dispose();
      await sessionClient.dispose();
      await settingsOwner.dispose();
      await client.dispose();
      manager.dispose();
      await configPolicy.dispose();
      await config.dispose();
      await store.close();
    },
  };
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
    getCurrentMetadata: () => state.metadata,
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
  sessionClient: SessionClientOwner,
  callbacks: RecordingSwapCallbacks,
  messages: Message[],
  persistence: CliSessionPersistence,
  settingsOwner: SessionSettingsOwner,
): SlashCommandHandlerDeps {
  const commandContext = createMockCommandContext({
    services: {
      config,
      agent: {
        get agentClient() {
          return sessionClient.getAgentClient();
        },
        setHistory: async (next: readonly IContent[]) =>
          sessionClient.getAgentClient().setHistory(next),
      },
    },
    recordingSwapCallbacks: callbacks,
  });
  return {
    commands: [continueCommand],
    config: {
      ...composeFixtureRuntime(config),
      ...buildSettingsRuntime(config, createUiSessionOwner(), settingsOwner),
    },
    sessionPersistence: persistence,
    commandContext,
    actions: createActions(),
    addItem: (item) => {
      commandContext.ui.addItem(item);
      if (item.type === MessageType.ERROR || item.type === MessageType.INFO) {
        messages.push({
          type:
            item.type === MessageType.ERROR
              ? MessageType.ERROR
              : MessageType.INFO,
          content: item.text,
          timestamp: new Date(),
        });
      }
    },
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

async function readHistoryText(history: HistoryService): Promise<string> {
  let text = '';
  await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
    text = historyText(rows);
  });
  return text;
}

describe('continue package perform_resume integration', () => {
  afterEach(() => {
    fixtureFilesystem = undefined;
  });

  it('publishes the validated package and assigns it only after real resume activation succeeds', async () => {
    const root = await mkdtemp(join(tmpdir(), 'continue-package-resume-'));
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'prior session history' }],
    });
    const originalSessionId = randomUUID();
    const built = await createConfig(
      join(root, 'destination-workspace'),
      originalSessionId,
      history,
    );
    const config = built.config;
    const projectTemp = config.projectTempDir;
    const state: ActiveRecordingState = {
      recording: null,
      integration: null,
      lock: null,
      metadata: null,
    };
    const messages: Message[] = [];
    const persistence = new CliSessionPersistence(
      { projectRoot: config.storageRoot, chatsDir: config.projectChatsDir },
      {
        mediaStore: requireMediaStore(built.sessionClient.getAgentClient()),
        maxQueueBytes: config.getSessionPersistenceQueueByteLimit(),
      },
    );
    Object.defineProperty(config, 'createSessionPersistenceService', {
      value: () => {
        throw new Error('Config persistence factory must not be used');
      },
    });

    try {
      const mediaBytes = new Uint8Array([3, 1, 4, 1, 5]);
      const sessionPackage = await createPackage(root, [mediaBytes]);
      const result = await processSlashCommand(
        createHandlerDeps(
          config,
          built.sessionClient,
          createRecordingCallbacks(state, false),
          messages,
          persistence,
          built.settingsOwner,
        ),
        `/continue import ${sessionPackage.directory}`,
      );
      const sessions = await SessionDiscovery.listSessions(
        config.projectChatsDir,
        getProjectHash(config.getProjectRoot()),
      );

      expect(result).toStrictEqual({ type: 'handled' });
      expect(sessions).toHaveLength(1);
      expect(sessions[0]).toMatchObject({
        projectHash: getProjectHash(config.getProjectRoot()),
        ...{ title: 'Portable title', name: 'portable-name' },
      });
      expect(config.getSessionId()).toBe(sessions[0]?.sessionId);
      expect(state.recording?.getSessionId()).toBe(config.getSessionId());
      const path = state.recording?.getFilePath();
      if (path === undefined || path === null)
        throw new Error('Missing imported recording');
      expect(path.endsWith(SESSION_FILE_EXTENSION)).toBe(true);
      const persisted = await recordedRows(
        path,
        getProjectHash(config.getProjectRoot()),
        requireMediaStore(built.sessionClient.getAgentClient()),
      );
      expect(historyText(persisted)).toContain(
        'history restored through perform_resume',
      );
      expect(state.metadata?.title).toBe('Portable title');
      const reference = sessionPackage.references[0];
      assertDefined(reference, 'Expected portable media');
      expect(persisted[0]?.blocks).toContainEqual(reference);
      expect(
        await requireMediaStore(
          built.sessionClient.getAgentClient(),
        ).readVerified(reference),
      ).toStrictEqual(mediaBytes);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(historyText(rows)).not.toContain('prior session history');
      });
      expect(await readHistoryText(history)).toContain(
        'history restored through perform_resume',
      );
      expect(messages).toStrictEqual([]);
    } finally {
      await disposeActiveState(state);
      persistence.close();
      await built.dispose();
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
    const built = await createConfig(
      join(root, 'destination-workspace'),
      originalSessionId,
      history,
    );
    const config = built.config;
    const projectTemp = config.projectTempDir;
    const destinationStore = requireMediaStore(
      built.sessionClient.getAgentClient(),
    );
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
    assertDefined(
      importedOnlyReference,
      'Expected imported-only package reference',
    );
    const state: ActiveRecordingState = {
      recording: null,
      integration: null,
      lock: null,
      metadata: null,
    };
    const messages: Message[] = [];
    const persistence = new CliSessionPersistence(
      { projectRoot: config.storageRoot, chatsDir: config.projectChatsDir },
      {
        mediaStore: requireMediaStore(built.sessionClient.getAgentClient()),
        maxQueueBytes: config.getSessionPersistenceQueueByteLimit(),
      },
    );

    try {
      await processSlashCommand(
        createHandlerDeps(
          config,
          built.sessionClient,
          createRecordingCallbacks(state, true),
          messages,
          persistence,
          built.settingsOwner,
        ),
        `/continue import ${sessionPackage.directory}`,
      );
      const chatEntries = await readdir(config.projectChatsDir).catch(
        (error: unknown) => {
          if (
            typeof error === 'object' &&
            error !== null &&
            'code' in error &&
            error.code === 'ENOENT'
          ) {
            return [];
          }
          throw error;
        },
      );

      expect(chatEntries).toStrictEqual([]);
      expect(config.getSessionId()).toBe(originalSessionId);
      await collectRowsForAssertions(history.streamRawHistory(), (rows) => {
        expect(historyText(rows)).not.toContain(
          'history restored through perform_resume',
        );
      });
      expect(await readHistoryText(history)).toContain(
        'original active history',
      );
      expect(
        await destinationStore.hasReservations(importedOnlyReference.contentId),
      ).toBe(false);
      expect(await destinationStore.getStoredByteLength()).toBe(
        deduplicatedBytes.byteLength,
      );
      expect(
        await destinationStore.readVerified(preExistingReference),
      ).toStrictEqual(deduplicatedBytes);
      await expect(
        destinationStore.readVerified(importedOnlyReference),
      ).rejects.toThrow(importedOnlyReference.contentId);
      expect(messages.some((message) => message.type === 'error')).toBe(true);
    } finally {
      await disposeActiveState(state);
      persistence.close();
      await built.dispose();
      await rm(projectTemp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('rejects a retired JSONL package through the slash front door without changing history or media', async () => {
    const root = await mkdtemp(join(tmpdir(), 'continue-package-retired-'));

    const source = await createPackage(root, [new Uint8Array([8, 6, 7])]);

    const manifestPath = join(source.directory, 'manifest.json');
    const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (typeof manifest !== 'object' || manifest === null)
      throw new Error('Missing package manifest');
    await writeFile(
      manifestPath,
      JSON.stringify({ ...manifest, recording: 'session.jsonl' }),
    );
    const history = new HistoryService();
    history.add({
      speaker: 'human',
      blocks: [{ type: 'text', text: 'keep current history' }],
    });
    const id = randomUUID();
    const built = await createConfig(join(root, 'workspace'), id, history);
    const config = built.config;
    const store = requireMediaStore(built.sessionClient.getAgentClient());
    const persistence = new CliSessionPersistence(
      { projectRoot: config.storageRoot, chatsDir: config.projectChatsDir },
      {
        mediaStore: store,
        maxQueueBytes: config.getSessionPersistenceQueueByteLimit(),
      },
    );
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
          built.sessionClient,
          createRecordingCallbacks(state, false),
          messages,
          persistence,
          built.settingsOwner,
        ),
        `/continue import ${source.directory}`,
      );
      expect(
        messages.map((message) =>
          'content' in message ? message.content : undefined,
        ),
      ).toStrictEqual([
        `Session file ${join(source.directory, 'session.jsonl')} was recorded in the retired JSONL journal format (versions 1 and 2) and cannot be resumed. Start a new session.`,
      ]);
      expect(config.getSessionId()).toBe(id);
      expect(state.recording).toBeNull();
      expect(await readHistoryText(history)).toBe('keep current history');
      expect(await store.getStoredByteLength()).toBe(0);
      expect(
        await SessionDiscovery.listSessions(
          config.projectChatsDir,
          getProjectHash(config.getProjectRoot()),
        ),
      ).toStrictEqual([]);
    } finally {
      await disposeActiveState(state);
      persistence.close();
      await built.dispose();
      await rm(config.projectTempDir, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('resumes before Agent construction and releases the lock and journal on exit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'legacy-cli-resume-'));
    const workspace = join(root, 'workspace');
    const first = await createConfig(
      workspace,
      randomUUID(),
      new HistoryService(),
    );
    const projectTemp = first.config.projectTempDir;
    let resumed: Awaited<ReturnType<typeof createConfig>> | undefined;
    try {
      Object.defineProperty(first.config, 'createSessionPersistenceService', {
        value: () => {
          throw new Error('Config persistence factory must not be used');
        },
      });
      const started = await setupSessionRecording(
        first.config,
        { listSessions: false, deleteSession: undefined },
        null,
        first.sessionClient,
      );
      const sessionId = started.recordingService.getSessionId();
      const firstHistory = first.sessionClient
        .getAgentClient()
        .getHistoryService();
      if (firstHistory === null) throw new Error('Missing startup history');
      await started.recordingIntegration.subscribeToJournal(firstHistory);
      firstHistory.add({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'legacy early resume' }],
      });
      await firstHistory.waitForCommit();
      await started.recordingService.flush();
      const oldJournal = started.sessionPersistence
        .forRecording(sessionId)
        .getSessionFilePath();
      await runExitCleanup();
      __resetCleanupStateForTesting();
      expect(() => started.sessionPersistence.forRecording(sessionId)).toThrow(
        'CLI session persistence is closed',
      );
      expect(
        (await readdir(first.config.projectChatsDir)).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
      const resumedHistoryService = new HistoryService();
      resumed = await createConfig(
        workspace,
        randomUUID(),
        resumedHistoryService,
        sessionId,
      );
      const resumedSetup = await setupSessionRecording(
        resumed.config,
        { listSessions: false, deleteSession: undefined },
        null,
        resumed.sessionClient,
      );
      expect(await readHistoryText(resumedHistoryService)).toContain(
        'legacy early resume',
      );
      expect(resumedSetup.recordingService.getSessionId()).toBe(sessionId);
      expect(
        resumedSetup.sessionPersistence
          .forRecording(sessionId)
          .getSessionFilePath(),
      ).not.toBe(oldJournal);
    } finally {
      await runExitCleanup();
      __resetCleanupStateForTesting();
      await resumed?.dispose();
      await first.dispose();
      await rm(projectTemp, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });
});
