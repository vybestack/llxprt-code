/**
 * @license
 * Copyright 2025 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { globalOAuthUI, MAX_PENDING_ITEMS } from '../global-oauth-ui.js';
import type {
  HistoryItemWithoutId,
  HistoryItemOAuthURL,
} from '../../ui/types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ItemData = Omit<HistoryItemWithoutId, 'id'>;

function makeOAuthItem(text: string): ItemData {
  const item: HistoryItemOAuthURL = {
    type: 'oauth_url',
    text,
    url: `https://example.com/${text}`,
  };
  return item;
}

function makeInfoItem(text: string): ItemData {
  return { type: 'info', text };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GlobalOAuthUI buffering', () => {
  beforeEach(() => {
    globalOAuthUI.clearAddItem();
    globalOAuthUI.clearPendingItems();
  });

  // Test 1.1
  it('buffers items when no handler is attached', () => {
    const item = makeOAuthItem('auth-url-1');

    const result = globalOAuthUI.callAddItem(item, 1000);

    expect(result).toBeUndefined();
    expect(globalOAuthUI.getPendingCount()).toBe(1);
  });

  // Test 1.2
  it('flushes buffered items in FIFO order when handler attaches', () => {
    const received: Array<{ itemData: ItemData; ts?: number }> = [];
    const handler = vi.fn((itemData: ItemData, ts?: number) => {
      received.push({ itemData, ts });
      return received.length;
    });

    globalOAuthUI.callAddItem(makeOAuthItem('first'), 100);
    globalOAuthUI.callAddItem(makeOAuthItem('second'), 200);
    globalOAuthUI.callAddItem(makeOAuthItem('third'), 300);

    expect(globalOAuthUI.getPendingCount()).toBe(3);

    globalOAuthUI.setAddItem(handler);

    expect(handler).toHaveBeenCalledTimes(3);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
    expect(received[2]?.ts).toBe(300);
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  // Test 1.3
  it('delivers items directly to handler when one is attached', () => {
    const handler = vi.fn((_itemData: ItemData, _ts?: number) => 42);
    globalOAuthUI.setAddItem(handler);

    const result = globalOAuthUI.callAddItem(makeOAuthItem('direct'), 500);

    expect(result).toBe(42);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  // Test 1.4
  it('clearAddItem does NOT clear the buffer', () => {
    globalOAuthUI.callAddItem(makeOAuthItem('item-a'), 100);
    globalOAuthUI.callAddItem(makeOAuthItem('item-b'), 200);

    expect(globalOAuthUI.getPendingCount()).toBe(2);

    globalOAuthUI.clearAddItem();

    expect(globalOAuthUI.getPendingCount()).toBe(2);

    const received: Array<{ itemData: ItemData; ts?: number }> = [];
    globalOAuthUI.setAddItem((itemData, ts) => {
      received.push({ itemData, ts });
      return received.length;
    });

    expect(received).toHaveLength(2);
    expect(received[0]?.ts).toBe(100);
    expect(received[1]?.ts).toBe(200);
  });

  // Test 1.5
  it('clearPendingItems empties the buffer', () => {
    globalOAuthUI.callAddItem(makeOAuthItem('a'));
    globalOAuthUI.callAddItem(makeOAuthItem('b'));
    globalOAuthUI.callAddItem(makeOAuthItem('c'));

    expect(globalOAuthUI.getPendingCount()).toBe(3);

    globalOAuthUI.clearPendingItems();

    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  // Test 1.6
  it('stable global bridge is registered at module load and buffers', () => {
    const bridge = (global as Record<string, unknown>).__oauth_add_item as
      | ((itemData: ItemData, ts?: number) => number | undefined)
      | undefined;

    expect(typeof bridge).toBe('function');

    bridge?.(makeOAuthItem('via-bridge'), 999);

    expect(globalOAuthUI.getPendingCount()).toBe(1);

    const received: Array<{ itemData: ItemData; ts?: number }> = [];
    globalOAuthUI.setAddItem((itemData, ts) => {
      received.push({ itemData, ts });
      return received.length;
    });

    expect(received).toHaveLength(1);
    expect(received[0]?.ts).toBe(999);
  });

  // Test 1.7
  it('delivers multiple rapid events in exact buffer order', () => {
    for (let i = 0; i < 10; i++) {
      globalOAuthUI.callAddItem(makeOAuthItem(`event-${i}`), i);
    }

    expect(globalOAuthUI.getPendingCount()).toBe(10);

    const received: number[] = [];
    globalOAuthUI.setAddItem((_itemData, ts) => {
      received.push(ts ?? -1);
      return received.length;
    });

    expect(received).toStrictEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  // Test 1.8
  it('caps buffer at MAX_PENDING_ITEMS with drop-oldest', () => {
    const totalItems = MAX_PENDING_ITEMS + 5;
    for (let i = 1; i <= totalItems; i++) {
      globalOAuthUI.callAddItem(makeOAuthItem(`item-${i}`), i);
    }

    expect(globalOAuthUI.getPendingCount()).toBe(MAX_PENDING_ITEMS);

    const received: number[] = [];
    globalOAuthUI.setAddItem((_itemData, ts) => {
      received.push(ts ?? -1);
      return received.length;
    });

    expect(received).toHaveLength(MAX_PENDING_ITEMS);
    // Items 1-5 were dropped (oldest); first item is 6
    expect(received[0]).toBe(6);
    expect(received[received.length - 1]).toBe(totalItems);
  });

  // Test 1.9
  it('handler throwing during flush does not block other items', () => {
    globalOAuthUI.callAddItem(makeInfoItem('item-1'), 100);
    globalOAuthUI.callAddItem(makeInfoItem('item-2'), 200);
    globalOAuthUI.callAddItem(makeInfoItem('item-3'), 300);

    const delivered: number[] = [];
    let callCount = 0;
    globalOAuthUI.setAddItem((_itemData, ts) => {
      callCount++;
      if (callCount === 2) {
        throw new Error('handler error on item 2');
      }
      delivered.push(ts ?? -1);
      return callCount;
    });

    // Items 1 and 3 were delivered; item 2 threw
    expect(delivered).toStrictEqual([100, 300]);
    expect(globalOAuthUI.getPendingCount()).toBe(0);
  });

  // Test 1.10
  it('reentrant callAddItem during flush goes directly to handler', () => {
    globalOAuthUI.callAddItem(makeInfoItem('buffered-1'), 100);
    globalOAuthUI.callAddItem(makeInfoItem('buffered-2'), 200);

    const deliveryOrder: string[] = [];
    let callCount = 0;
    globalOAuthUI.setAddItem((itemData, _ts) => {
      callCount++;
      const text = (itemData as { text: string }).text;
      deliveryOrder.push(text);

      // During flush of buffered-1, emit a reentrant event
      if (text === 'buffered-1') {
        globalOAuthUI.callAddItem(makeInfoItem('reentrant'), 150);
      }
      return callCount;
    });

    // Reentrant event is interleaved: buffered-1, reentrant, buffered-2
    expect(deliveryOrder).toStrictEqual([
      'buffered-1',
      'reentrant',
      'buffered-2',
    ]);
  });
});

describe('GlobalOAuthUI getAddItem (deprecated)', () => {
  beforeEach(() => {
    globalOAuthUI.clearAddItem();
    globalOAuthUI.clearPendingItems();
  });

  it('returns undefined when no handler is set', () => {
    expect(globalOAuthUI.getAddItem()).toBeUndefined();
  });

  it('returns the handler when set', () => {
    const handler = vi.fn((_itemData: ItemData, _ts?: number) => 1);
    globalOAuthUI.setAddItem(handler);
    expect(globalOAuthUI.getAddItem()).toBe(handler);
  });
});
