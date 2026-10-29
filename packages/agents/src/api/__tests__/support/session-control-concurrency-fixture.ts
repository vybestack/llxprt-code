/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { join } from 'node:path';
import { Storage } from '@vybestack/llxprt-code-settings';
import { LocalMediaStore } from '@vybestack/llxprt-code-core';
import type { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type { IContent } from '@vybestack/llxprt-code-core/services/history/IContent.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import { createTestAgentClient } from '@vybestack/llxprt-code-test-utils/core/config.js';
import { SessionConversationBinding } from '../../../session/session-conversation-binding.js';
import type { SessionControl } from '../../control/sessionControl.js';
import { trackTestHistories } from './test-histories.js';
const createTrackedHistory = trackTestHistories();
class IsolatedTestStorage extends Storage {
  constructor(private readonly projectTempDir: string) {
    super(projectTempDir);
  }

  override getProjectTempDir(): string {
    return this.projectTempDir;
  }
}

/**
 * Minimal in-memory Config projection exposing ONLY the surface SessionControl
 * touches: a fixed project root, a storage whose getProjectChatsDir() drives
 * the chats-dir derivation, a workspace context, and persistence inputs.
 * Recording ownership is observable through the real SessionControl and JSONL.
 */
export interface FakeConfig {
  readonly getSessionId: () => string;
  readonly adoptSessionId: (sessionId: string) => void;
  readonly getProjectRoot: () => string;
  readonly projectTempDir: string;
  readonly projectChatsDir: string;

  readonly getLocalMediaStore: () => LocalMediaStore;
  readonly getSessionRecordingQueueByteLimit: () => number;
  readonly getPersistenceChatsDir: () => string;
}

export function buildFakeConfig(
  projectRoot: string,
  persistenceRoot = projectRoot,
  _persistenceQueueBytes = 1024 * 1024,
  initialSessionId = 'fake-recording-id',
): FakeConfig {
  const mediaStore = new LocalMediaStore({
    rootDirectory: join(projectRoot, 'media'),
    quotaBytes: 1024 * 1024,
  });
  const persistenceStorage = new IsolatedTestStorage(persistenceRoot);
  let sessionId = initialSessionId;
  return {
    getSessionId: () => sessionId,
    adoptSessionId: (next) => {
      sessionId = next;
    },
    getProjectRoot: () => projectRoot,
    projectTempDir: projectRoot,
    projectChatsDir: join(projectRoot, 'chats'),

    getLocalMediaStore: () => mediaStore,
    getSessionRecordingQueueByteLimit: () => 1024 * 1024,
    getPersistenceChatsDir: () =>
      join(persistenceStorage.getProjectTempDir(), 'chats'),
  };
}

/**
 * Honest fake client: exposes a swappable HistoryService and records history
 * replacement calls. getHistory() returns whatever seed was configured (as
 * Gemini-ish content the ContentConverters bridge accepts). This is a genuine
 * collaborator, not a call-spy assertion target.
 */
export interface FakeClient {
  contract: AgentClientContract;
  setHistoryService: (hs: HistoryService | null) => void;
  replacementCount: () => number;
}

export function buildFakeClient(seed: readonly IContent[] = []): FakeClient {
  let historyService: HistoryService | null = createTrackedHistory();
  historyService.addAll(seed);
  let history = [...seed];
  let replacementCalls = 0;
  const contract = createTestAgentClient({
    async *getHistory() {
      if (historyService !== null) yield* historyService.streamRawHistory();
      else yield* history;
    },
    getHistoryService: () => historyService,
    setHistory: async (nextHistory: IContent[]) => {
      history = [...nextHistory];
      await historyService?.replaceAll(nextHistory);
      replacementCalls += 1;
    },
    setHistoryFromSource: async (source: AsyncIterable<IContent>) => {
      history = await Array.fromAsync(source);
      await historyService?.replaceAll(history);
      replacementCalls += 1;
    },
    resetChat: async (
      preserveHistory?: readonly IContent[] | AsyncIterable<IContent>,
    ) => {
      const next =
        preserveHistory === undefined
          ? []
          : await Array.fromAsync(preserveHistory);
      await historyService?.replaceBatch(next);
      await historyService?.waitForCommit();
      history = [...next];
      replacementCalls += 1;
    },
    discardDeferredHistory: async () => undefined,
    restoreHistory: async (nextHistory: IContent[]) => {
      history = [...nextHistory];
      await historyService?.replaceAll(nextHistory);
      replacementCalls += 1;
    },
  });
  return {
    contract,
    setHistoryService: (hs) => {
      historyService = hs;
    },
    replacementCount: () => replacementCalls,
  };
}

export function createSessionControl(
  config: FakeConfig,
  client: AgentClientContract,
  sessionId: string,
  mediaStore: LocalMediaStore,
): SessionControl {
  const conversation = new SessionConversationBinding({
    readClient: () => client,
    assertOpen: () => {},
  });
  return conversation.createSessionControl(
    {
      storageRoot: config.getProjectRoot(),
      projectRoot: config.getProjectRoot(),
      projectTempDir: config.projectTempDir,
      projectChatsDir: config.projectChatsDir,
      persistenceQueueBytes: 1024 * 1024,
    },
    mediaStore,
    () => config.getSessionRecordingQueueByteLimit(),
    () => [config.getProjectRoot()],
    'config',
    () => sessionId,
    (operation) => operation(),
    () => {},
    async () => {
      await client.resetChat();
      return {
        publish: () => {},
        retire: async () => {},
        discard: async () => {},
        attachRecording: async (integration, origin) => {
          await conversation.subscribeRecording(integration, origin);
        },
      };
    },
    () => 'fake',
    () => 'fake-model',
    config.getSessionId,
    config.adoptSessionId,
  );
}
