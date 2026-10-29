/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  IContent,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { SessionNativeHistory } from '../api/control/session-history-observation.js';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentSessionControl } from '../api/agent.js';
import type { SessionHookOwner } from '@vybestack/llxprt-code-core/hooks/session-hook-owner.js';
import { HistoryService } from '@vybestack/llxprt-code-core/services/history/HistoryService.js';
import type {
  SessionMetricReads,
  SessionMetricSubscriptions,
} from '@vybestack/llxprt-code-telemetry';
import type { Agent, AgentHistoryItem, AgentMessage } from '../api/agent.js';
import {
  projectSessionStats,
  subscribeSessionStats,
} from '../api/agentStatsProjector.js';
import { executeCompression } from '../api/compression-execution.js';
import { SessionControl } from '../api/control/sessionControl.js';
import { createCompressionRecordingOptions } from '../api/recordingExecution.js';

export class SessionConversationBinding {
  constructor(
    private readonly access: {
      readonly readClient: () => AgentClientContract;
      readonly assertOpen: () => void;
    },
  ) {}
  private get client(): AgentClientContract {
    return this.access.readClient();
  }
  private initialHistory: HistoryService | undefined;
  initializeConversation(): void {
    this.access.assertOpen();
    this.initialHistory =
      this.client.getHistoryService() ?? new HistoryService();
    this.client.storeHistoryServiceForReuse(this.initialHistory);
  }
  private observedHistory: HistoryService | null = null;
  private historyVersion = 0;
  get #activeClient(): AgentClientContract {
    this.access.assertOpen();
    return this.client;
  }
  createSessionControl(
    paths: ConstructorParameters<typeof SessionControl>[0],
    mediaStore: ConstructorParameters<typeof SessionControl>[1],
    readRecordingQueueLimit: ConstructorParameters<typeof SessionControl>[2],
    directories: ConstructorParameters<typeof SessionControl>[3],
    identityOwnership: ConstructorParameters<typeof SessionControl>[4],
    sessionId: ConstructorParameters<typeof SessionControl>[5],
    transition: ConstructorParameters<typeof SessionControl>[7],
    closeAdmission: ConstructorParameters<typeof SessionControl>[8],
    prepareNewSession: ConstructorParameters<typeof SessionControl>[9],
    readProvider: ConstructorParameters<typeof SessionControl>[10],
    readModel: ConstructorParameters<typeof SessionControl>[11],
    readOwnedSessionId: ConstructorParameters<typeof SessionControl>[12],
    adoptOwnedSessionId: ConstructorParameters<typeof SessionControl>[13],
  ): SessionControl {
    return new SessionControl(
      paths,
      mediaStore,
      readRecordingQueueLimit,
      directories,
      identityOwnership,
      sessionId,
      this.nativeHistory,
      transition,
      closeAdmission,
      prepareNewSession,
      readProvider,
      readModel,
      readOwnedSessionId,
      adoptOwnedSessionId,
    );
  }
  readonly subscribeContextRange: SessionNativeHistory['subscribeContextRange'] =
    (...args) => this.nativeHistory.subscribeContextRange(...args);
  readonly subscribeRecording: SessionNativeHistory['subscribeRecording'] = (
    ...args
  ) => this.nativeHistory.subscribeRecording(...args);
  private readonly nativeHistory: SessionNativeHistory = {
    getHistoryService: () => this.#activeClient.getHistoryService(),
    streamHistory: (signal) => this.#activeClient.streamHistory(signal),
    resumeChat: (history) => this.#activeClient.resumeChat(history),
    discardDeferredHistory: () => this.#activeClient.discardDeferredHistory(),
    setHistoryFromSource: (source, options) =>
      this.#activeClient.setHistoryFromSource(source, options),
    subscribeContextRange: (observers, publish) => {
      let current: HistoryService | null = null;
      const changed = (
        range: ReturnType<HistoryService['getContextRange']>,
      ): void => publish(range);
      const bind = (): void => {
        const history = this.#activeClient.getHistoryService();
        if (history === current) return;
        current?.off('contextRangeChanged', changed);
        current = history;
        if (history !== null) {
          history.on('contextRangeChanged', changed);
          publish(history.getContextRange());
        }
      };
      bind();
      const interval = setInterval(bind, 100);
      const stop = (): void => {
        clearInterval(interval);
        current?.off('contextRangeChanged', changed);
        current = null;
        observers.delete(stop);
      };
      observers.add(stop);
      return stop;
    },
    subscribeHistoryTokens: (
      observers: Set<() => void | Promise<void>>,
      publish: (count: number) => void,
    ): (() => void) => {
      let current: ReturnType<AgentClientContract['getHistoryService']> = null;
      let lastPublished: number | null = null;
      const changed = (event: { totalTokens: number }): void => {
        if (event.totalTokens !== lastPublished) {
          lastPublished = event.totalTokens;
          publish(event.totalTokens);
        }
      };
      const bind = (): void => {
        const history = this.#activeClient.hasChatInitialized()
          ? this.#activeClient.getHistoryService()
          : null;
        if (history === current) return;
        current?.off('tokensUpdated', changed);
        current = history;
        if (history !== null) {
          history.on('tokensUpdated', changed);
          lastPublished = history.getTotalTokens();
          publish(lastPublished);
        }
      };
      bind();
      const interval = setInterval(bind, 100);
      const stop = (): void => {
        clearInterval(interval);
        current?.off('tokensUpdated', changed);
        current = null;
        observers.delete(stop);
      };
      observers.add(stop);
      return stop;
    },
    attachRecordingHistory: async (
      recording: RecordingIntegration,
    ): Promise<void> => {
      const history = this.#activeClient.getHistoryService();
      if (history !== null) await recording.subscribeToJournal(history);
    },
    connectRecordingHistory: (
      observers: Set<() => void | Promise<void>>,
      readRecording: () => RecordingIntegration | null,
    ): (() => Promise<void>) => {
      let current: ReturnType<AgentClientContract['getHistoryService']> = null;
      let recording: RecordingIntegration | null = null;
      let pending = Promise.resolve();
      const failures: unknown[] = [];
      const interval = setInterval(() => {
        const nextRecording = readRecording();
        const history = this.#activeClient.hasChatInitialized()
          ? this.#activeClient.getHistoryService()
          : null;
        if (
          history === null ||
          (history === current && nextRecording === recording)
        )
          return;
        current = history;
        recording = nextRecording;
        pending = pending
          .then(async () => {
            await nextRecording?.subscribeToJournal(history);
          })
          .then(undefined, (error: unknown) => {
            failures.push(error);
          });
      }, 100);
      const stop = async (): Promise<void> => {
        clearInterval(interval);
        observers.delete(stop);
        await pending;
        if (failures.length > 0)
          throw new AggregateError(
            failures,
            'Recording history observation failed',
          );
      };
      observers.add(stop);
      return stop;
    },
    readHistorySnapshot: (): ReturnType<
      AgentSessionControl['readHistorySnapshot']
    > => {
      const history = this.#activeClient.getHistoryService();
      return history === null
        ? null
        : {
            messages: this.#activeClient.streamHistory(),
            chronology: history.getChronologyTrace(),
          };
    },
    replaceNativeHistory: async (
      history: readonly IContent[],
      origin: object,
      prepareRecording: () => Promise<void>,
    ): Promise<void> => {
      await this.restoreChatVisibility();
      await prepareRecording();
      await this.#activeClient.setHistory(history, { historyOrigin: origin });
    },
    readInitializedHistory: (): AsyncIterable<IContent> | null =>
      this.#activeClient.hasChatInitialized()
        ? this.#activeClient.getChat().getHistory()
        : null,
    getHistory: (_curated, signal) =>
      this.#activeClient.getHistory(false, signal),
    setHistory: (
      history: readonly IContent[],
      options?: { readonly historyOrigin?: object },
    ) => {
      this.access.assertOpen();
      return this.#activeClient.setHistory(history, options);
    },
    restoreHistory: (history: readonly IContent[], origin?: object) => {
      this.access.assertOpen();
      return this.#activeClient.restoreHistory([...history], origin);
    },
    resetChat: (preserved) => this.#activeClient.resetChat(preserved),
    hasChatInitialized: () => this.#activeClient.hasChatInitialized(),
    hasHistory: () => this.#activeClient.getHistoryService() !== null,
    historyRevision: (): number => {
      const history = this.#activeClient.getHistoryService();
      if (history !== this.observedHistory) {
        this.observedHistory = history;
        this.historyVersion++;
      }
      return this.historyVersion;
    },
    subscribeRecording: async (
      integration: RecordingIntegration,
      origin: object,
    ): Promise<boolean> => {
      const history = this.#activeClient.getHistoryService();
      if (history === null) return false;
      await integration.subscribeToJournal(history, origin);
      return true;
    },
  };
  readonly conversation = {
    streamHistory: (signal?: AbortSignal) => {
      this.access.assertOpen();
      return this.client.streamHistory(signal);
    },
    setHistory: async (
      history: readonly AgentMessage[],
      opts?: { readonly stripThoughts?: boolean },
    ): Promise<void> => {
      this.access.assertOpen();
      await this.client.setHistory([...history], opts);
    },
    addHistory: async (message: AgentMessage): Promise<void> => {
      this.access.assertOpen();
      await this.client.addHistory(message);
    },
    restoreHistory: async (
      items: readonly AgentHistoryItem[],
    ): Promise<void> => {
      this.access.assertOpen();
      await this.client.restoreHistory([...items]);
    },
    resetChat: async (): Promise<void> => {
      this.access.assertOpen();
      await this.client.resetChat();
    },
    updateSystemInstruction: async (): Promise<void> => {
      this.access.assertOpen();
      await this.client.updateSystemInstruction();
    },
    addDirectoryContext: async (): Promise<void> => {
      this.access.assertOpen();
      await this.client.addDirectoryContext();
    },
    getCurrentSequenceModel: (): string | null => {
      this.access.assertOpen();
      return this.client.getCurrentSequenceModel() ?? null;
    },
  };
  async restoreChatVisibility(): Promise<void> {
    this.access.assertOpen();
    if (!this.client.hasChatInitialized()) {
      await this.client.startChat();
    }
  }
  isClientInitialized(): boolean {
    this.access.assertOpen();
    return this.client.isInitialized();
  }
  readStats(metrics: SessionMetricReads): ReturnType<Agent['getStats']> {
    return projectSessionStats(
      this.client.getHistoryService() ?? this.initialHistory ?? null,
      metrics,
    );
  }
  observeStats(
    cb: Parameters<Agent['onStats']>[0],
    metrics: SessionMetricReads & SessionMetricSubscriptions,
  ): () => void {
    return subscribeSessionStats(
      () => this.client.getHistoryService() ?? this.initialHistory ?? null,
      cb,
      metrics,
    );
  }
  compressHistory(
    promptId: string,
    session: SessionControl,
    hooks: Pick<SessionHookOwner, 'execution'>,
  ): ReturnType<Agent['compress']> {
    return executeCompression(
      promptId,
      async () => {
        await this.restoreChatVisibility();
        if (this.client.getChat().getHistoryService() === null)
          throw new Error('Chat instance not available for compression.');
      },
      () =>
        this.client.getChat().performCompression(
          promptId,
          createCompressionRecordingOptions(
            session,
            () => session.getSessionId(),
            hooks,
          ),
        ),
      () =>
        (
          this.client.getHistoryService() ?? this.initialHistory
        )?.getTotalTokens() ?? 0,
      () => this.client.getChat().wasRecentlyCompressed(),
    );
  }
}
