import type { SessionControl } from '../../../../agents/src/api/control/sessionControl.js';
import { afterEach, describe, expect, it } from 'bun:test';

import { createCapturedSessionOwner } from '../../../../agents/src/api/__tests__/helpers/session-client-capture.js';
import type { CommandHandlerFixture as SlashCommandHandlerDeps } from './slash-command-handler-deps-test-helpers.js';
import { bindCommandRawResume } from './commandRawResumeHost.js';
import { buildSettingsRuntime } from '../../runtime/createRuntimeOwnerFeatures.js';
import { createUiSessionOwner } from '../../__tests__/uiSessionOwner.js';
import { SessionSettingsOwner } from '@vybestack/llxprt-code-core/session/session-settings-owner.js';
import { SettingsService, Storage } from '@vybestack/llxprt-code-settings';
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { assembleTaskSchemaPolicy } from '@vybestack/llxprt-code-core/config/task-schema-policy-assembly.js';

import { installTestWorkspaceFilesystem } from '@vybestack/llxprt-code-test-utils/core/config.js';
const makeFixtureFilesystem = installTestWorkspaceFilesystem();
let fixtureFilesystem: ReturnType<typeof makeFixtureFilesystem> | undefined;
function fixturePaths() {
  fixtureFilesystem ??= makeFixtureFilesystem({
    targetDir: process.cwd(),
    isTrusted: () => true,
  });
  return fixtureFilesystem.paths;
}
import { installWorkspaceRuntimeFixture } from '../../__tests__/workspace-runtime-fixture.js';
const composeFixtureRuntime = installWorkspaceRuntimeFixture();
import { RuntimePolicyOwner } from '@vybestack/llxprt-code-core/policy/policy-owner.js';

import { SessionClientOwner } from '../../../../agents/src/session/session-client-owner.js';
import {
  configureProviderTokenizer,
  createRuntimeContentGeneratorFactory,
} from '@vybestack/llxprt-code-providers/composition.js';
import { ProviderManager } from '@vybestack/llxprt-code-providers';
import { requireMediaStore } from '@vybestack/llxprt-code-core/storage/local-media-store.js';
import { assertDefined } from '@vybestack/llxprt-code-test-utils';
import { createPortablePackage as createPackage } from '../../__tests__/support/portable-package.js';
import { recordedRows } from '../../../../agents/src/api/__tests__/support/recorded-rows.js';
import { SESSION_FILE_EXTENSION } from '@vybestack/llxprt-code-core/recording/sessionFileExtension.js';
import { collectRowsForAssertions } from '@vybestack/llxprt-code-test-utils/core/collect-rows-for-assertions.js';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  rm,
  readFile,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  Config,
  DebugLogger,
  LocalMediaStore,
  PerformCompressionResult,
  SessionDiscovery,
  type SessionRecordingPort,
  emptyModelOutput,
  getProjectHash,
  type AgentChatContract,
  type AgentClientContract,
  type IContent,
  type RuntimeProviderManager,
  type LockHandle,
  type RecordingIntegration,
  type SessionMetadata,
} from '@vybestack/llxprt-code-core';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import { createContinueCommandForTest } from '../commands/__tests__/continue-command-test-owner.js';
import type { SlashCommandProcessorActions } from './slashCommandProcessor.js';
import { processSlashCommand } from './slashCommandHandlers.js';
import { createMockCommandContext } from '../../__tests__/mockCommandContext.js';
import {
  performResume,
  type RecordingSwapCallbacks,
} from '../../services/performResume.js';
import { MessageType, type Message } from '../types.js';
import { CliSessionPersistence } from '../../cliSessionPersistence.js';
import { setupOwnerSessionRecording } from '../../cliSessionBootstrap.js';
import {
  __resetCleanupStateForTesting,
  runExitCleanup,
  registerCleanup,
} from '../../utils/cleanup.js';

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
  const chat: AgentChatContract = {
    appendGeneration: async () => {
      throw new Error('Fixture chat does not publish detached generation');
    },
    takeHistoryAdmissions: () => [],
    sendMessage: async (_params, promptId) => ({
      status: 'empty',
      promptId,
      turnId: 'unused',
    }),
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
    bindTokenization: () => {},
    bindProviderSelection: () => {},
    get tools() {
      if (tools === undefined)
        throw new Error('Missing fixture tool selection');
      return tools;
    },
    bindModelNotifications: () => {},
    bindIdeContext: () => {},
    bindWorkspaceDefinitions: () => {},
    bindProviderFiles: () => {},
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
    storeHistoryForLaterUse: async (source) => {
      await history.replaceAll(await Array.fromAsync(source));
    },
    discardDeferredHistory: async () => {},
    setHistoryFromSource: async (source) => {
      await history.replaceAll(await Array.fromAsync(source));
    },
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
  continueSession?: string,
): Promise<{
  config: Config;
  client: AgentClientContract;
  sessionClient: SessionClientOwner;
  settingsOwner: SessionSettingsOwner;
  session: SessionControl;
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
  const manager = new ProviderManager(
    undefined,
    undefined,
    undefined,
    undefined,
    settingsService,
    config,
  );
  const client = createAgentClient(history, store, config, manager);
  const factoriesTokenizer = configureProviderTokenizer(manager);
  const factoriesContent = createRuntimeContentGeneratorFactory();
  const sessionClient = await createCapturedSessionOwner(
    config,
    assembleTaskSchemaPolicy(settingsService),
    manager,
    () => client,
    store,
    () => undefined,
    fixturePaths(),
    settingsOwner,
    factoriesContent,
    factoriesTokenizer,
  );

  sessionClient.clients.conversationBinding.initializeConversation();
  const session = sessionClient.createSessionControl(
    'config',
    () => config.getSessionId(),
    (operation) => operation(),
    () => {},
    () => {},
    () => config.getProvider() ?? '',
    () => config.getModel(),
  );
  return {
    config,
    client,
    sessionClient,
    settingsOwner,
    session,
    dispose: async () => {
      await session.dispose();
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

async function createHandlerDeps(
  config: Config,
  client: AgentClientContract,
  callbacks: RecordingSwapCallbacks,
  messages: Message[],
  persistence: CliSessionPersistence,
  settingsOwner: SessionSettingsOwner,
): Promise<SlashCommandHandlerDeps> {
  const commandContext = createMockCommandContext({
    services: {
      config,
      agent: {
        session: {
          getHistory: async () => Array.fromAsync(client.getHistory()),
          replaceHistory: async (next: readonly IContent[]) =>
            client.setHistory(next),
          attachRecordingHistory: async (recording: RecordingIntegration) => {
            const current = client.getHistoryService();
            if (!current) throw new Error('Missing fixture history');
            await recording.subscribeToJournal(current);
          },
        },
        setHistory: async (next: readonly IContent[]) =>
          client.setHistory(next),
      },
    },
    recordingSwapCallbacks: callbacks,
  });
  const continueCommand = createContinueCommandForTest(
    () => commandContext,
    () => persistence.mediaStore,
  );
  const resumeRuntime = {
    ...composeFixtureRuntime(config),
    ...buildSettingsRuntime(
      config,
      await createUiSessionOwner(),
      settingsOwner,
    ),
  };
  const deps: SlashCommandHandlerDeps = {
    commands: [continueCommand],
    config: resumeRuntime,
    commandContext,
    actions: createActions(),
    addItem: commandContext.ui.addItem,
    addMessage: (message) => messages.push(message),
    setIsProcessing: () => {},
    setLocalIsProcessing: () => {},
    setPendingItem: () => {},
    setSessionShellAllowlist: () => {},
    setConfirmationRequest: () => {},
    confirmationLogger: new DebugLogger('continue-package-confirmation-test'),
    slashCommandLogger: new DebugLogger('continue-package-resume-test'),
    beginSlashCommandAction: () => new AbortController(),
    endSlashCommandAction: () => {},
    resumeOwnedSession: null,
    isMcpDiscoveryPending: () => false,
    resumeRawSession: null,
    refreshResumedHistory: () => {},
    writeOutput: async (item) => {
      if (item.type === MessageType.ERROR || item.type === MessageType.INFO)
        messages.push({
          type:
            item.type === MessageType.ERROR
              ? MessageType.ERROR
              : MessageType.INFO,
          content: item.text,
          timestamp: new Date(),
        });
    },
    recordCommandError: async () => {},
  };
  deps.resumeRawSession = bindCommandRawResume(
    resumeRuntime,
    persistence,
    {
      adoptResumeBoot: async (recording, boot, publish) => {
        const history = client.getHistoryService();
        if (history === null) throw new Error('Missing native history');
        return history.adoptResumeBoot(recording, boot, publish);
      },
      attachRecording: async (integration) => {
        const history = client.getHistoryService();
        if (history === null) throw new Error('Missing native history');
        await integration.subscribeToJournal(history);
      },
    },
    callbacks,
    deps.slashCommandLogger,
    performResume,
  );
  return deps;
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
      {
        projectRoot: config.getProjectRoot(),
        chatsDir: config.projectChatsDir,
      },
      { mediaStore: requireMediaStore(built.client) },
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
        await createHandlerDeps(
          config,
          built.client,
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
      );
      expect(historyText(persisted)).toContain(
        'history restored through perform_resume',
      );
      expect(state.metadata?.title).toBe('Portable title');
      const reference = sessionPackage.references[0];
      assertDefined(reference, 'Expected portable media');
      expect(persisted[0]?.blocks).toContainEqual(reference);
      expect(
        await requireMediaStore(built.client).readVerified(reference),
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
    const destinationStore = requireMediaStore(built.client);
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
      {
        projectRoot: config.getProjectRoot(),
        chatsDir: config.projectChatsDir,
      },
      { mediaStore: requireMediaStore(built.client) },
    );

    try {
      await processSlashCommand(
        await createHandlerDeps(
          config,
          built.client,
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
    const store = requireMediaStore(built.client);
    const persistence = new CliSessionPersistence(
      {
        projectRoot: config.getProjectRoot(),
        chatsDir: config.projectChatsDir,
      },
      { mediaStore: store },
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
        await createHandlerDeps(
          config,
          built.client,
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
      registerCleanup(() => first.session.dispose());
      await setupOwnerSessionRecording(
        first.config,
        first.session,
        first.session.listBrowserTargetsDetailed.bind(first.session),
        { listSessions: false, deleteSession: undefined },
        null,
      );
      const sessionId = first.session.getSessionId();
      await first.client.addHistory({
        speaker: 'human',
        blocks: [{ type: 'text', text: 'legacy early resume' }],
      });
      await first.session.flushRecording();
      const oldJournal = first.session.getRecording().path;
      await runExitCleanup();
      __resetCleanupStateForTesting();
      expect(first.session.getRecording().enabled).toBe(false);
      expect(
        (await readdir(first.config.projectChatsDir)).filter((file) =>
          file.endsWith('.lock'),
        ),
      ).toStrictEqual([]);
      resumed = await createConfig(
        workspace,
        randomUUID(),
        new HistoryService(),
        sessionId,
      );
      registerCleanup(() => resumed?.session.dispose());
      const resumedHistory = await setupOwnerSessionRecording(
        resumed.config,
        resumed.session,
        resumed.session.listBrowserTargetsDetailed.bind(resumed.session),
        { listSessions: false, deleteSession: undefined },
        null,
      ).then(({ resumedBoot }) => resumedBoot);
      expect(
        historyText(
          resumedHistory === null
            ? []
            : await Array.fromAsync(resumedHistory.streamRows()),
        ),
      ).toContain('legacy early resume');
      expect(resumed.session.getSessionId()).toBe(sessionId);
      expect(resumed.session.getRecording().path).toBe(oldJournal);
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
