/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'bun:test';
import { ConversationContext } from '../../../utils/ConversationContext.js';
import type {
  HistoryItem,
  HistoryItemUser,
  HistoryItemWithoutId,
} from '../../types.js';
import { StreamingState, ToolCallStatus } from '../../types.js';
import { createHistoryLedger } from './historyLedger.js';
import type { QueuedSubmission } from '../../hooks/agentStream/types.js';
import {
  createTurnStore,
  type PendingAddRequest,
  type TurnState,
} from './turnStore.js';

function userItem(text: string): HistoryItemUser {
  return { type: 'user', text };
}

describe('createTurnStore', () => {
  it('replaces cyclic tool metadata with a counted display notice', () => {
    const metadata: Record<string, unknown> = {};
    metadata.self = metadata;
    const ledger = createHistoryLedger({ maxItems: 10, maxBytes: 1024 });

    ledger.append({
      id: 42,
      type: 'tool_group',
      tools: [
        {
          callId: 'cyclic',
          name: 'read_file',
          description: 'read a file',
          status: ToolCallStatus.Success,
          confirmationDetails: undefined,
          resultDisplay: {
            content: 'result',
            fileName: 'test',
            filePath: '/test',
            metadata,
          },
        },
      ],
    });

    const state = ledger.getState();
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].item).toStrictEqual({
      id: 42,
      type: 'info',
      text: '[Item too large to display; full text is in the session transcript]',
    });
    expect(state.totalBytes).toBe(
      Buffer.byteLength(JSON.stringify(state.entries[0].item), 'utf8'),
    );
    expect(state.totalBytes).toBeGreaterThan(0);
    expect(state.totalBytes).toBeLessThanOrEqual(1024);
  });

  it('projects seeded history through ledger limits before the first read', () => {
    const history: HistoryItem[] = Array.from({ length: 401 }, (_, id) => ({
      id,
      type: 'info',
      text: String(id),
    }));
    const { store, commands } = createTurnStore({ history });
    expect(store.getState().history).toHaveLength(400);
    const first = store.getState().history[0];
    commands.updateItem(-1, { text: 'absent' });
    expect(store.getState().history[0]).toBe(first);
  });

  it('does not publish unchanged limits, identity updates or repeated clears', () => {
    const { store, commands } = createTurnStore();
    const id = commands.addItem({ type: 'info', text: 'retained' });
    const history = store.getState().history;
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });
    commands.setHistoryLimits({ maxItems: 400, maxBytes: 4 * 1024 * 1024 });
    commands.updateItem(id, (item) => item);
    expect(store.getState().history).toBe(history);
    expect(notifications).toBe(0);
    commands.clearItems();
    const clearedNotifications = notifications;
    commands.clearItems();
    expect(notifications).toBe(clearedNotifications);
  });

  it('starts with the documented defaults', () => {
    const { store } = createTurnStore();
    expect(store.getState()).toStrictEqual({
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
    } satisfies TurnState);
  });

  describe('history commands', () => {
    it('addItem assigns a timestamp-derived id and stores the constructed item', () => {
      const { store, commands } = createTurnStore();
      const itemData = userItem('Hello');
      const timestamp = 1_000;

      const id = commands.addItem(itemData, timestamp);

      expect(id).toBeGreaterThanOrEqual(timestamp);
      expect(store.getState().history).toHaveLength(1);
      expect(store.getState().history[0]).toStrictEqual({ ...itemData, id });
    });

    it('addItem puts the very same item object into state (Static identity)', () => {
      const { store, commands } = createTurnStore();
      const id = commands.addItem(userItem('Hello'), 1_000);
      const added = store.getState().history[0];

      // A subsequent unrelated item must not clone the earlier one.
      commands.addItem({ type: 'info', text: 'meta' }, 1_001);
      expect(store.getState().history[0]).toBe(added);
      expect(store.getState().history[0].id).toBe(id);
    });

    it('addItem rejects a consecutive duplicate user message without notifying', () => {
      const { store, commands } = createTurnStore();
      let notifications = 0;
      store.subscribe(() => {
        notifications += 1;
      });

      commands.addItem(userItem('again'), 1_000);
      const first = store.getState().history;
      const afterFirst = notifications;

      commands.addItem(userItem('again'), 1_001);
      expect(store.getState().history).toBe(first);
      expect(notifications).toBe(afterFirst);
    });

    it('updateItem replaces the entry with a new object and preserves order', () => {
      const { store, commands } = createTurnStore();
      const a = commands.addItem(userItem('question'), 1_000);
      const b = commands.addItem({ type: 'gemini', text: 'answer' }, 1_001);
      const originalB = store.getState().history[1];

      commands.updateItem(b, { text: 'better answer' });

      const history = store.getState().history;
      expect(history.map((item) => item.id)).toStrictEqual([a, b]);
      expect(history[1]).not.toBe(originalB);
      expect(history[1].text).toBe('better answer');
    });

    it('updateItem with an unknown id is a no-op preserving array identity', () => {
      const { store, commands } = createTurnStore();
      commands.addItem(userItem('question'), 1_000);
      const before = store.getState().history;

      commands.updateItem(987_654, { text: 'nothing' });

      expect(store.getState().history).toBe(before);
    });

    it('removeItems drops exactly the given ids and keeps the survivors untouched', () => {
      const { store, commands } = createTurnStore();
      commands.addItem(userItem('a'), 1_000);
      commands.addItem(userItem('b'), 1_001);
      commands.addItem(userItem('c'), 1_002);
      const survivor = store.getState().history[0];

      commands.removeItems([store.getState().history[1].id]);

      const history = store.getState().history;
      expect(history.map((item) => item.text)).toStrictEqual(['a', 'c']);
      expect(history[0]).toBe(survivor);
    });

    it('removeItems is a no-op for an empty list (state identity preserved)', () => {
      const { store, commands } = createTurnStore();
      commands.addItem(userItem('a'), 1_000);
      const before = store.getState().history;

      commands.removeItems([]);

      expect(store.getState().history).toBe(before);
    });

    for (const populated of [false, true]) {
      it(`clearItems resets the conversation context with ${populated ? 'populated' : 'empty'} history`, () => {
        const previousContext = ConversationContext.getContext();
        try {
          ConversationContext.startNewConversation();
          ConversationContext.setParentId('previous-message');
          const previousId = ConversationContext.getContext().conversationId;
          const { commands } = createTurnStore();
          if (populated) commands.addItem(userItem('previous turn'));

          commands.clearItems();

          const context = ConversationContext.getContext();
          expect(context.conversationId).toBeDefined();
          expect(context.conversationId).not.toBe(previousId);
          expect(context.parentId).toBeUndefined();

          commands.clearItems();
          expect(ConversationContext.getContext().conversationId).not.toBe(
            context.conversationId,
          );
        } finally {
          ConversationContext.setContext(previousContext);
        }
      });
    }

    it('clearItems empties history', () => {
      const { store, commands } = createTurnStore();
      commands.addItem(userItem('a'), 1_000);

      commands.clearItems();

      expect(store.getState().history).toStrictEqual([]);
    });

    it('loadHistory preserves the loaded item objects and re-projects the array', () => {
      const { store, commands } = createTurnStore();
      const first: HistoryItem = { id: 11, type: 'user', text: 'one' };
      const second: HistoryItem = { id: 12, type: 'info', text: 'two' };

      const seeded = [first, second];
      commands.loadHistory(seeded);

      const history = store.getState().history;
      expect(history).not.toBe(seeded);
      expect(history[0]).toBe(first);
      expect(history[1]).toBe(second);
    });

    it('setHistoryLimits trims the committed history to the newest maxItems', () => {
      const { store, commands } = createTurnStore();
      commands.addItem({ type: 'info', text: 'first' }, 1_000);
      commands.addItem({ type: 'info', text: 'second' }, 1_001);
      commands.addItem({ type: 'info', text: 'third' }, 1_002);

      commands.setHistoryLimits({
        maxItems: 2,
        maxBytes: Number.POSITIVE_INFINITY,
      });

      expect(store.getState().history.map((item) => item.text)).toStrictEqual([
        'second',
        'third',
      ]);
    });

    it('trims by the byte budget, bounding only the oversized item', () => {
      const { store, commands } = createTurnStore({ history: [] });
      commands.setHistoryLimits({ maxItems: 10, maxBytes: 400 });

      commands.addItem({ type: 'info', text: 'x'.repeat(500) }, 1_000);

      const text = store.getState().history[0].text as string;
      const serialized = JSON.stringify(store.getState().history[0]);
      expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(400);
      expect(text).toContain('full text is in the session transcript');
      expect(text).not.toContain('\uFFFD');
    });
  });

  describe('seeded history', () => {
    it('seeds flow through the ledger so later commands build on them', () => {
      const seeded: HistoryItem = { id: 7, type: 'user', text: 'seeded' };
      const { store, commands } = createTurnStore({ history: [seeded] });

      commands.addItem({ type: 'info', text: 'live' }, 2_000);

      const history = store.getState().history;
      expect(history[0]).toBe(seeded);
      expect(history).toHaveLength(2);
    });
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

    it('history writes do not disturb the once-state', () => {
      const { store, commands } = createTurnStore();
      commands.setCtrlCPressedOnce(true);
      commands.addItem(userItem('a'), 1_000);
      expect(store.getState().ctrlCPressedOnce).toBe(true);
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
      expect(store.getState().history).toStrictEqual([]);
    });

    it('consecutive identical requests get fresh references (effect refires)', () => {
      const { store, commands } = createTurnStore();
      const itemData = userItem('twice');

      commands.requestAddItem(itemData, 5_000);
      const first = store.getState().pendingAddRequest;
      commands.requestAddItem(itemData, 5_000);
      const second = store.getState().pendingAddRequest;

      expect(first).not.toBe(second);
      expect((second as PendingAddRequest).seq).toBeGreaterThan(
        (first as PendingAddRequest).seq,
      );
    });
  });

  describe('subscription semantics', () => {
    it('notifies a subscriber once per state-changing command', () => {
      const { store, commands } = createTurnStore();
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      commands.addItem(userItem('a'), 1_000);
      commands.setStreamingState(StreamingState.Responding);
      expect(calls).toBe(2);
    });

    it('no-op commands do not notify', () => {
      const { store, commands } = createTurnStore();
      let calls = 0;
      store.subscribe(() => {
        calls += 1;
      });
      commands.updateItem(424_242, { text: 'missing' });
      commands.removeItems([]);
      expect(calls).toBe(0);
    });

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

    it('a history write produces a fresh state reference so selectors re-run', () => {
      const { store, commands } = createTurnStore();
      const before = store.getState();
      commands.addItem(userItem('a'), 1_000);
      expect(store.getState()).not.toBe(before);
      // Unrelated fields survive the history write.
      expect(store.getState().streamingState).toBe(before.streamingState);
      expect(store.getState().staticKey).toBe(before.staticKey);
    });

    it('an unrelated write keeps the history array reference stable', () => {
      const { store, commands } = createTurnStore();
      commands.addItem(userItem('a'), 1_000);
      const history = store.getState().history;

      commands.setStreamingState(StreamingState.Responding);

      expect(store.getState().history).toBe(history);
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
