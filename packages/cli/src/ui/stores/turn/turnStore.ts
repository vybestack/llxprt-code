/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStore, type Store } from '../createStore.js';
import type { HistoryItem, HistoryItemWithoutId } from '../../types.js';
import { StreamingState } from '../../types.js';
import { ConversationContext } from '../../../utils/ConversationContext.js';
import type {
  ThoughtSummary,
  HistoryService,
} from '@vybestack/llxprt-code-core';
import type { QueuedSubmission } from '../../hooks/agentStream/types.js';
import { appendJournalUiItem } from '../../hooks/command-journal-output.js';

export interface TurnState {
  /** Committed transcript items rendered into Ink's <Static> region. */
  historyEpoch: number;
  displayError: string | null;
  /** Items still pending commit (streaming, confirmations). */
  pendingHistoryItems: HistoryItemWithoutId[];
  streamingState: StreamingState;
  thought: ThoughtSummary | null;
  queuedSubmissions: readonly QueuedSubmission[];
  elapsedTime: number;
  currentLoadingPhrase: string | undefined;
  /** Full-screen quit display; null while the app runs normally. */
  quittingMessages: HistoryItem[] | null;
  ctrlCPressedOnce: boolean;
  ctrlDPressedOnce: boolean;
  isProcessing: boolean;
  /** Key bumping Ink's <Static> remount for refreshes. */
  staticKey: number;
  /**
   * Side-effect channel for out-of-tree add requests (the former appReducer
   * ADD_ITEM action). A consumer subscribes and performs the add when the
   * request reference changes; `seq` guarantees consecutive identical
   * requests still notify.
   */
  pendingAddRequest: PendingAddRequest | null;
}

export interface PendingAddRequest {
  readonly seq: number;
  readonly itemData: HistoryItemWithoutId;
  readonly baseTimestamp?: number;
}

export interface TurnCommands {
  /** Same signature as useHistoryManager's addItem. */
  addItem: (
    itemData: HistoryItemWithoutId,
    baseTimestamp?: number,
    isResuming?: boolean,
  ) => number;
  clearItems: () => void;
  getJournalLength: () => number;
  bindJournal: (
    readHistory: () => Pick<HistoryService, 'appendDisplay' | 'length'> | null,
  ) => void;
  /** Records an out-of-tree add request for a subscriber to perform. */
  requestAddItem: (
    itemData: HistoryItemWithoutId,
    baseTimestamp?: number,
  ) => void;
  /** Claims a matching request once, including across effect replays. */
  consumePendingAddRequest: (seq: number) => PendingAddRequest | null;
  setPendingHistoryItems: (items: HistoryItemWithoutId[]) => void;
  setStreamingState: (state: StreamingState) => void;
  setThought: (thought: ThoughtSummary | null) => void;
  setQueuedSubmissions: (submissions: readonly QueuedSubmission[]) => void;
  setElapsedTime: (seconds: number) => void;
  setCurrentLoadingPhrase: (phrase: string | undefined) => void;
  setQuittingMessages: (messages: HistoryItem[] | null) => void;
  setCtrlCPressedOnce: (pressed: boolean) => void;
  setCtrlDPressedOnce: (pressed: boolean) => void;
  setIsProcessing: (processing: boolean) => void;
  /** Bumps staticKey so Ink's <Static> region remounts. */
  refreshStatic: () => void;
}

export interface TurnStore {
  store: Store<TurnState>;
  commands: TurnCommands;
}

function initialTurnState(): TurnState {
  return {
    historyEpoch: 0,
    displayError: null,
    pendingHistoryItems: [],
    streamingState: StreamingState.Idle,
    thought: null,
    queuedSubmissions: [],
    elapsedTime: 0,
    currentLoadingPhrase: undefined,
    quittingMessages: null,
    ctrlCPressedOnce: false,
    ctrlDPressedOnce: false,
    isProcessing: false,
    staticKey: 0,
    pendingAddRequest: null,
  };
}

type TurnAddRequestCommands = Pick<
  TurnCommands,
  'requestAddItem' | 'consumePendingAddRequest'
>;

type TurnStatusCommands = Pick<
  TurnCommands,
  | 'setPendingHistoryItems'
  | 'setStreamingState'
  | 'setThought'
  | 'setQueuedSubmissions'
  | 'setElapsedTime'
  | 'setCurrentLoadingPhrase'
  | 'setQuittingMessages'
  | 'setCtrlCPressedOnce'
  | 'setCtrlDPressedOnce'
  | 'setIsProcessing'
  | 'refreshStatic'
>;

/** Out-of-tree add request writer; seq lets identical requests still notify. */
function createTurnAddRequestCommands(
  store: Store<TurnState>,
): TurnAddRequestCommands {
  let addRequestSeq = 0;

  const requestAddItem = (
    itemData: HistoryItemWithoutId,
    baseTimestamp?: number,
  ): void => {
    addRequestSeq += 1;
    store.setState((prev) => ({
      ...prev,
      pendingAddRequest: { seq: addRequestSeq, itemData, baseTimestamp },
    }));
  };

  const consumePendingAddRequest = (seq: number): PendingAddRequest | null => {
    const request = store.getState().pendingAddRequest;
    if (request?.seq !== seq) return null;
    store.setState((prev) => ({ ...prev, pendingAddRequest: null }));
    return request;
  };

  return { requestAddItem, consumePendingAddRequest };
}

/** Streaming and turn-status writers backed directly by store state. */
function createTurnStatusCommands(store: Store<TurnState>): TurnStatusCommands {
  const setPendingHistoryItems = (items: HistoryItemWithoutId[]): void => {
    store.setState((prev) => ({ ...prev, pendingHistoryItems: items }));
  };

  const setStreamingState = (state: StreamingState): void => {
    store.setState((prev) => ({ ...prev, streamingState: state }));
  };

  const setThought = (thought: ThoughtSummary | null): void => {
    store.setState((prev) => ({ ...prev, thought }));
  };

  const setQueuedSubmissions = (
    submissions: readonly QueuedSubmission[],
  ): void => {
    store.setState((prev) => ({ ...prev, queuedSubmissions: submissions }));
  };

  const setElapsedTime = (seconds: number): void => {
    store.setState((prev) => ({ ...prev, elapsedTime: seconds }));
  };

  const setCurrentLoadingPhrase = (phrase: string | undefined): void => {
    store.setState((prev) => ({ ...prev, currentLoadingPhrase: phrase }));
  };

  const setQuittingMessages = (messages: HistoryItem[] | null): void => {
    store.setState((prev) => ({ ...prev, quittingMessages: messages }));
  };

  const setCtrlCPressedOnce = (pressed: boolean): void => {
    store.setState((prev) => ({ ...prev, ctrlCPressedOnce: pressed }));
  };

  const setCtrlDPressedOnce = (pressed: boolean): void => {
    store.setState((prev) => ({ ...prev, ctrlDPressedOnce: pressed }));
  };

  const setIsProcessing = (processing: boolean): void => {
    store.setState((prev) => ({ ...prev, isProcessing: processing }));
  };

  const refreshStatic = (): void => {
    store.setState((prev) => ({ ...prev, staticKey: prev.staticKey + 1 }));
  };

  return {
    setPendingHistoryItems,
    setStreamingState,
    setThought,
    setQueuedSubmissions,
    setElapsedTime,
    setCurrentLoadingPhrase,
    setQuittingMessages,
    setCtrlCPressedOnce,
    setCtrlDPressedOnce,
    setIsProcessing,
    refreshStatic,
  };
}

let nextDisplayId = 0;

export function createTurnStore(initial?: Partial<TurnState>): TurnStore {
  const store = createStore<TurnState>({ ...initialTurnState(), ...initial });
  let readHistory:
    | (() => Pick<HistoryService, 'appendDisplay' | 'length'> | null)
    | null = null;
  return {
    store,
    commands: {
      getJournalLength: () => readHistory?.()?.length() ?? 0,
      bindJournal: (read) => {
        readHistory = read;
      },
      addItem: (item) => {
        if (readHistory === null) throw new Error('UI journal is not bound');
        void appendJournalUiItem(readHistory(), undefined, item).catch(
          (error: unknown) => {
            store.setState((previous) => ({
              ...previous,
              displayError:
                error instanceof Error ? error.message : String(error),
            }));
          },
        );
        return ++nextDisplayId;
      },
      clearItems: () => {
        store.setState((previous) => ({
          ...previous,
          historyEpoch: previous.historyEpoch + 1,
        }));
        ConversationContext.startNewConversation();
      },
      ...createTurnAddRequestCommands(store),
      ...createTurnStatusCommands(store),
    },
  };
}
