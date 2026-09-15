/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { createStore, type Store } from '../createStore.js';
import type { HistoryItem, HistoryItemWithoutId } from '../../types.js';
import { StreamingState } from '../../types.js';
import { ConversationContext } from '../../../utils/ConversationContext.js';
import type { ThoughtSummary } from '@vybestack/llxprt-code-core';
import type { QueuedSubmission } from '../../hooks/agentStream/types.js';
import {
  createHistoryLedger,
  nextHistoryItemId,
  projectHistory,
  type HistoryItemUpdater,
  type HistoryLedger,
  type HistoryLimits,
} from './historyLedger.js';

/**
 * Streamed and committed turn data plus cancellation state for the
 * interactive UI. History lives in a {@link HistoryLedger} behind the
 * `history` projection, so <Static> item identity is preserved: the same
 * item objects flow through commands, and the array reference changes only
 * when the committed set changes. Writers are the domain hooks (writer
 * effects preserve dispatch -> effect ordering); components read through
 * useStoreSelector with narrow selectors.
 */
export interface TurnState {
  /** Committed transcript items rendered into Ink's <Static> region. */
  history: HistoryItem[];
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
  readonly itemData: Omit<HistoryItem, 'id'>;
  readonly baseTimestamp?: number;
}

export interface TurnCommands {
  /** Same signature as useHistoryManager's addItem. */
  addItem: (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp?: number,
    isResuming?: boolean,
  ) => number;
  /** Same signature as useHistoryManager's updateItem. */
  updateItem: (
    id: number,
    updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
  ) => void;
  /** Same signature as useHistoryManager's removeItems. */
  removeItems: (ids: readonly number[]) => void;
  /** Same signature as useHistoryManager's clearItems. */
  clearItems: () => void;
  /** Same signature as useHistoryManager's loadHistory. */
  loadHistory: (newHistory: HistoryItem[]) => void;
  /** Applies new display limits and trims the committed history. */
  setHistoryLimits: (limits: HistoryLimits) => void;
  /** Records an out-of-tree add request for a subscriber to perform. */
  requestAddItem: (
    itemData: Omit<HistoryItem, 'id'>,
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
    history: [],
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

type TurnHistoryCommands = Pick<
  TurnCommands,
  | 'addItem'
  | 'updateItem'
  | 'removeItems'
  | 'clearItems'
  | 'loadHistory'
  | 'setHistoryLimits'
>;

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

/**
 * History-ledger writers. Every mutator publishes only when the ledger state
 * reference changed, preserving <Static> item identity on no-ops, and the
 * before/after comparison keeps cancel-race ordering intact.
 */
function createTurnHistoryCommands(
  ledger: HistoryLedger,
  publishHistory: () => void,
): TurnHistoryCommands {
  const addItem = (
    itemData: Omit<HistoryItem, 'id'>,
    baseTimestamp: number = Date.now(),
    _isResuming: boolean = false,
  ): number => {
    const id = nextHistoryItemId(baseTimestamp);
    const newItem = { ...itemData, id } as HistoryItem;
    const before = ledger.getState();
    ledger.append(newItem);
    if (ledger.getState() !== before) {
      publishHistory();
    }
    return id;
  };

  const updateItem = (
    id: number,
    updates: Partial<Omit<HistoryItem, 'id'>> | HistoryItemUpdater,
  ): void => {
    const before = ledger.getState();
    ledger.update(id, updates);
    if (ledger.getState() !== before) {
      publishHistory();
    }
  };

  const removeItems = (ids: readonly number[]): void => {
    const before = ledger.getState();
    ledger.remove(ids);
    if (ledger.getState() !== before) {
      publishHistory();
    }
  };

  const clearItems = (): void => {
    const before = ledger.getState();
    ledger.clear();
    if (ledger.getState() !== before) publishHistory();
    // The conversation-id reset travels with the command so every caller
    // (hook, keybinding, slash command) gets the same semantics.
    ConversationContext.startNewConversation();
  };

  const loadHistory = (newHistory: HistoryItem[]): void => {
    ledger.load(newHistory);
    publishHistory();
  };

  const setHistoryLimits = (limits: HistoryLimits): void => {
    const before = ledger.getState();
    ledger.setLimits(limits);
    if (ledger.getState() !== before) {
      publishHistory();
    }
  };

  return {
    addItem,
    updateItem,
    removeItems,
    clearItems,
    loadHistory,
    setHistoryLimits,
  };
}

/** Out-of-tree add request writer; seq lets identical requests still notify. */
function createTurnAddRequestCommands(
  store: Store<TurnState>,
): TurnAddRequestCommands {
  let addRequestSeq = 0;

  const requestAddItem = (
    itemData: Omit<HistoryItem, 'id'>,
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

export function createTurnStore(initial?: Partial<TurnState>): TurnStore {
  const ledger: HistoryLedger = createHistoryLedger();
  if (initial?.history !== undefined) {
    ledger.load(initial.history);
  }
  const store = createStore<TurnState>({
    ...initialTurnState(),
    ...initial,
    history: projectHistory(ledger.getState()),
  });

  const publishHistory = (): void => {
    store.setState((prev) => ({
      ...prev,
      history: projectHistory(ledger.getState()),
    }));
  };

  return {
    store,
    commands: {
      ...createTurnHistoryCommands(ledger, publishHistory),
      ...createTurnAddRequestCommands(store),
      ...createTurnStatusCommands(store),
    },
  };
}
