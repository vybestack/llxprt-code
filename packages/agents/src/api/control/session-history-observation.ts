/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type {
  IContent,
  RecordingIntegration,
} from '@vybestack/llxprt-code-core';
import type { AgentClientContract } from '@vybestack/llxprt-code-core/core/clientContract.js';
import type { AgentSessionControl } from '../agent.js';

export interface SessionNativeHistory
  extends Pick<
    AgentClientContract,
    | 'getHistory'
    | 'streamHistory'
    | 'getHistoryService'
    | 'setHistory'
    | 'setHistoryFromSource'
    | 'restoreHistory'
    | 'resetChat'
    | 'resumeChat'
    | 'discardDeferredHistory'
    | 'hasChatInitialized'
  > {
  subscribeContextRange(
    observers: Set<() => void | Promise<void>>,
    publish: Parameters<AgentSessionControl['subscribeContextRange']>[0],
  ): () => void;
  hasHistory(): boolean;
  historyRevision(): number;
  subscribeRecording(
    recording: RecordingIntegration,
    origin: object,
  ): Promise<boolean>;
  readHistorySnapshot: AgentSessionControl['readHistorySnapshot'];
  readInitializedHistory(): AsyncIterable<IContent> | null;
  replaceNativeHistory(
    history: readonly IContent[],
    origin: object,
    prepareRecording: () => Promise<void>,
  ): Promise<void>;
  subscribeHistoryTokens(
    observers: Set<() => void | Promise<void>>,
    publish: (count: number) => void,
  ): () => void;
  attachRecordingHistory(recording: RecordingIntegration): Promise<void>;
  connectRecordingHistory(
    observers: Set<() => void | Promise<void>>,
    readRecording: () => RecordingIntegration | null,
  ): () => Promise<void>;
}
