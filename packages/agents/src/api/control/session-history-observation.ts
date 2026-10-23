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
import type { AgentSessionControl } from '../agent.js';

export interface SessionNativeHistory {
  getHistory(): Promise<readonly IContent[]>;
  setHistory(
    history: readonly IContent[],
    options?: { readonly historyOrigin?: object },
  ): Promise<void>;
  restoreHistory(history: readonly IContent[], origin?: object): Promise<void>;
  resetChat(): Promise<void>;
  hasChatInitialized(): boolean;
  hasHistory(): boolean;
  historyRevision(): number;
  subscribeRecording(recording: RecordingIntegration, origin: object): boolean;
  seedRecording(
    recording: SessionRecordingService,
    history: readonly IContent[],
    origin: object,
  ): void;
  readHistorySnapshot: AgentSessionControl['readHistorySnapshot'];
  readInitializedHistory(): readonly IContent[] | null;
  replaceNativeHistory(
    history: readonly IContent[],
    origin: object,
    prepareRecording: () => Promise<void>,
  ): Promise<void>;
  subscribeHistoryTokens(
    observers: Set<() => void>,
    publish: (count: number) => void,
  ): () => void;
  attachRecordingHistory(recording: RecordingIntegration): void;
  connectRecordingHistory(
    observers: Set<() => void>,
    readRecording: () => RecordingIntegration | null,
  ): () => void;
}
