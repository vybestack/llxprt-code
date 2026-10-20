/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  IContent,
  RecordingIntegration,
  SessionRecordingService,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentSessionControl } from '../api/agent.js';
import { AgentBootstrapError } from '../api/agentBootstrap.js';
import { seedOwnerRecording } from '../api/control/recordedHistoryPersistence.js';
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
import type { SessionControl } from '../api/control/sessionControl.js';
import { createCompressionRecordingOptions } from '../api/recordingExecution.js';

export abstract class SessionConversationBinding {
  protected client!: AgentClientContract;
  private initialHistory: HistoryService | undefined;
  protected abstract assertConversationOpen(): void;
  initializeConversation(): void {
    this.assertConversationOpen();
    this.initialHistory =
      this.client.getHistoryService() ?? new HistoryService();
    this.client.storeHistoryServiceForReuse(this.initialHistory);
  }
  private observedHistory: HistoryService | null = null;
  private historyVersion = 0;
  get #activeClient(): AgentClientContract {
    this.assertConversationOpen();
    return this.client;
  }
  readonly nativeHistory = {
    subscribeHistoryTokens: (
      observers: Set<() => void>,
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
      const interval = setInterval(() => {
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
      }, 100);
      const stop = (): void => {
        clearInterval(interval);
        current?.off('tokensUpdated', changed);
        current = null;
        observers.delete(stop);
      };
      observers.add(stop);
      return stop;
    },
    attachRecordingHistory: (recording: RecordingIntegration): void => {
      const history = this.#activeClient.getHistoryService();
      if (history !== null) recording.onHistoryServiceReplaced(history);
    },
    connectRecordingHistory: (
      observers: Set<() => void>,
      readRecording: () => RecordingIntegration | null,
    ): (() => void) => {
      let current: ReturnType<AgentClientContract['getHistoryService']> = null;
      let recording: RecordingIntegration | null = null;
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
        recording?.onHistoryServiceReplaced(history);
      }, 100);
      const stop = (): void => {
        clearInterval(interval);
        current = null;
        recording = null;
        observers.delete(stop);
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
            messages: history.getAll(),
            chronology: history.getChronologyTrace(),
          };
    },
    replaceNativeHistory: async (
      history: readonly IContent[],
      origin: object,
      prepareRecording: () => Promise<void>,
    ): Promise<void> => {
      if (!this.#activeClient.hasChatInitialized())
        await this.#activeClient.startChat(
          await this.#activeClient.getHistory(),
        );
      await prepareRecording();
      await this.#activeClient.setHistory(history, { historyOrigin: origin });
    },
    readInitializedHistory: (): readonly IContent[] | null =>
      this.#activeClient.hasChatInitialized()
        ? this.#activeClient.getChat().getHistory()
        : null,
    getHistory: () => this.conversation.getHistory(),
    setHistory: (
      history: readonly IContent[],
      options?: { readonly historyOrigin?: object },
    ) => {
      this.assertConversationOpen();
      return this.#activeClient.setHistory(history, options);
    },
    restoreHistory: (history: readonly IContent[], origin?: object) => {
      this.assertConversationOpen();
      return this.#activeClient.restoreHistory([...history], origin);
    },
    resetChat: () => this.conversation.resetChat(),
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
    subscribeRecording: (
      integration: RecordingIntegration,
      origin: object,
    ): boolean => {
      const history = this.#activeClient.getHistoryService();
      if (history === null) return false;
      integration.subscribeToHistory(history, origin);
      return true;
    },
    seedRecording: (
      recording: SessionRecordingService,
      history: readonly IContent[],
      origin: object,
    ): void => {
      seedOwnerRecording(
        recording,
        history,
        this.#activeClient.getHistoryService(),
        origin,
      );
    },
  };
  readonly conversation = {
    getHistory: async (): Promise<readonly AgentMessage[]> => {
      this.assertConversationOpen();
      return this.client.getHistory();
    },
    setHistory: async (
      history: readonly AgentMessage[],
      opts?: { readonly stripThoughts?: boolean },
    ): Promise<void> => {
      this.assertConversationOpen();
      await this.client.setHistory([...history], opts);
    },
    addHistory: async (message: AgentMessage): Promise<void> => {
      this.assertConversationOpen();
      await this.client.addHistory(message);
    },
    restoreHistory: async (
      items: readonly AgentHistoryItem[],
    ): Promise<void> => {
      this.assertConversationOpen();
      await this.client.restoreHistory([...items]);
    },
    resetChat: async (): Promise<void> => {
      this.assertConversationOpen();
      await this.client.resetChat();
    },
    updateSystemInstruction: async (): Promise<void> => {
      this.assertConversationOpen();
      await this.client.updateSystemInstruction();
    },
    addDirectoryContext: async (): Promise<void> => {
      this.assertConversationOpen();
      await this.client.addDirectoryContext();
    },
    getCurrentSequenceModel: (): string | null => {
      this.assertConversationOpen();
      return this.client.getCurrentSequenceModel() ?? null;
    },
  };
  async restoreChatVisibility(): Promise<void> {
    this.assertConversationOpen();
    if (!this.client.hasChatInitialized()) {
      const history = await this.client.getHistory();
      await this.client.startChat(history.length > 0 ? history : undefined);
    }
  }
  isClientInitialized(): boolean {
    this.assertConversationOpen();
    return this.client.isInitialized();
  }
  assertPreflightClient(client: AgentClientContract | undefined): void {
    if (client !== undefined && client !== this.client)
      throw new AgentBootstrapError(
        'Borrowed client differs from the preflight session client',
      );
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
