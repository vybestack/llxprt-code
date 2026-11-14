/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import type {
  HistoryItem,
  HistoryItemUser,
  HistoryItemWithoutId,
} from '../../types.js';
import { StreamingState } from '../../types.js';
import {
  readJournalItems,
  withJournalTurn,
} from './journal-turn-test-helpers.js';
import { ConversationContext } from '../../../utils/ConversationContext.js';
import type { QueuedSubmission } from '../../hooks/agentStream/types.js';
import { createTurnStore, type TurnState } from './turnStore.js';

function userItem(text: string): HistoryItemUser {
  return { type: 'user', text };
}

describe('createTurnStore', () => {
  it('starts with the documented defaults', () => {
    const { store } = createTurnStore();
    expect(store.getState()).toStrictEqual({
      displayError: null,
      historyEpoch: 0,
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
    } satisfies TurnState);
  });

  describe('turn field setters', () => {
    it('setPendingHistoryItems stores the given array reference', () => {
      const { store, commands } = createTurnStore();
      const pending: HistoryItemWithoutId[] = [
        { type: 'gemini', text: 'streaming' },
      ];

      commands.setPendingHistoryItems(pending);

      expect(store.getState().pendingHistoryItems).toBe(pending);
    });

    it('setStreamingState writes the streaming phase', () => {
      const { store, commands } = createTurnStore();
      commands.setStreamingState(StreamingState.Responding);
      expect(store.getState().streamingState).toBe(StreamingState.Responding);
    });

    it('setThought writes and clears the thought summary', () => {
      const { store, commands } = createTurnStore();
      const thought = { subject: 'reasoning', description: 'about it' };
      commands.setThought(thought);
      expect(store.getState().thought).toBe(thought);
      commands.setThought(null);
      expect(store.getState().thought).toBeNull();
    });

    it('setQueuedSubmissions stores the queue reference', () => {
      const { store, commands } = createTurnStore();
      const queue: QueuedSubmission[] = [{ query: 'queued' }];
      commands.setQueuedSubmissions(queue);
      expect(store.getState().queuedSubmissions).toBe(queue);
    });

    it('setElapsedTime and setCurrentLoadingPhrase write loading indicators', () => {
      const { store, commands } = createTurnStore();
      commands.setElapsedTime(4.5);
      commands.setCurrentLoadingPhrase('Pondering');
      expect(store.getState().elapsedTime).toBe(4.5);
      expect(store.getState().currentLoadingPhrase).toBe('Pondering');
    });

    it('setQuittingMessages toggles the quit display state', () => {
      const { store, commands } = createTurnStore();
      const messages: HistoryItem[] = [{ id: 1, type: 'info', text: 'bye' }];
      commands.setQuittingMessages(messages);
      expect(store.getState().quittingMessages).toBe(messages);
      commands.setQuittingMessages(null);
      expect(store.getState().quittingMessages).toBeNull();
    });
  });

  describe('cancellation once-state', () => {
    it('ctrl+C once-state resets after the second press consumed it', () => {
      const { store, commands } = createTurnStore();
      commands.setCtrlCPressedOnce(true);
      expect(store.getState().ctrlCPressedOnce).toBe(true);
      commands.setCtrlCPressedOnce(false);
      expect(store.getState().ctrlCPressedOnce).toBe(false);
    });

    it('ctrl+C and ctrl+D once-states are independent', () => {
      const { store, commands } = createTurnStore();
      commands.setCtrlCPressedOnce(true);
      commands.setCtrlDPressedOnce(true);
      commands.setCtrlCPressedOnce(false);
      expect(store.getState().ctrlDPressedOnce).toBe(true);
      expect(store.getState().ctrlCPressedOnce).toBe(false);
    });

    it('setIsProcessing flips the processing flag', () => {
      const { store, commands } = createTurnStore();
      commands.setIsProcessing(true);
      expect(store.getState().isProcessing).toBe(true);
      commands.setIsProcessing(false);
      expect(store.getState().isProcessing).toBe(false);
    });
  });

  describe('static refresh', () => {
    it('refreshStatic bumps staticKey by one per call', () => {
      const { store, commands } = createTurnStore();
      commands.refreshStatic();
      commands.refreshStatic();
      expect(store.getState().staticKey).toBe(2);
    });
  });

  describe('pending add-request channel', () => {
    it('requestAddItem records the payload without touching history', () => {
      const { store, commands } = createTurnStore();
      const itemData = userItem('from a command');

      commands.requestAddItem(itemData, 5_000);

      const request = store.getState().pendingAddRequest;
      expect(request).not.toBeNull();
      expect(request?.itemData).toBe(itemData);
      expect(request?.baseTimestamp).toBe(5_000);
      expect(commands.getJournalLength()).toBe(0);
    });

    it('consecutive identical requests get fresh references (effect refires)', () => {
      const { store, commands } = createTurnStore();
      const itemData = userItem('twice');

      commands.requestAddItem(itemData, 5_000);
      const first = store.getState().pendingAddRequest;
      commands.requestAddItem(itemData, 5_000);
      const second = store.getState().pendingAddRequest;

      expect(first).not.toBe(second);
      if (!first || !second) throw new Error('Expected pending requests');
      expect(second.seq).toBeGreaterThan(first.seq);
    });
  });

  describe('subscription semantics', () => {
    it('unsubscribe stops notifications', () => {
      const { store, commands } = createTurnStore();
      let calls = 0;
      const unsubscribe = store.subscribe(() => {
        calls += 1;
      });
      commands.refreshStatic();
      unsubscribe();
      commands.refreshStatic();
      expect(calls).toBe(1);
    });
  });
});

describe('add request consumption', () => {
  // A retained store can outlive an effect subscription or StrictMode replay.
  it('claims an add request once and preserves newer requests', () => {
    const { store, commands } = createTurnStore();
    commands.requestAddItem(userItem('once'), 100);
    const first = store.getState().pendingAddRequest;
    if (!first) throw new Error('Expected pending request');
    expect(commands.consumePendingAddRequest(first.seq)).toBe(first);
    expect(commands.consumePendingAddRequest(first.seq)).toBeNull();
    commands.requestAddItem(userItem('once'), 100);
    const second = store.getState().pendingAddRequest;
    if (!second) throw new Error('Expected second request');
    expect(second.seq).toBeGreaterThan(first.seq);
    expect(commands.consumePendingAddRequest(first.seq)).toBeNull();
    expect(store.getState().pendingAddRequest).toBe(second);
  });
});

describe('journal-backed turn writes', () => {
  it('writes notices in order without replacing scalar turn state', async () => {
    await withJournalTurn(async ({ store, commands }, agent) => {
      commands.setCtrlCPressedOnce(true);
      const before = store.getState();
      const first = commands.addItem({ type: 'info', text: 'first' });
      const second = commands.addItem({ type: 'warning', text: 'second' });
      const items = await readJournalItems(agent);
      expect(items.map((item) => item.text)).toStrictEqual(['first', 'second']);
      expect(second).toBeGreaterThan(first);
      expect(store.getState()).toBe(before);
      expect(store.getState().ctrlCPressedOnce).toBe(true);
    });
  });
  it('clear invalidates the viewport and resets conversation identity even when empty', () => {
    const previous = ConversationContext.getContext();
    try {
      ConversationContext.startNewConversation();
      ConversationContext.setParentId('previous');
      const id = ConversationContext.getContext().conversationId;
      const { store, commands } = createTurnStore();
      commands.clearItems();
      expect(store.getState().historyEpoch).toBe(1);
      expect(ConversationContext.getContext().conversationId).not.toBe(id);
      expect(ConversationContext.getContext().parentId).toBeUndefined();
      const next = ConversationContext.getContext().conversationId;
      commands.clearItems();
      expect(store.getState().historyEpoch).toBe(2);
      expect(ConversationContext.getContext().conversationId).not.toBe(next);
    } finally {
      ConversationContext.setContext(previous);
    }
  });
});
