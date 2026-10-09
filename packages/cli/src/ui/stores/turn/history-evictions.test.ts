/**
 * @license
 * Copyright 2026 Vybestack LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'bun:test';
import { createHistoryLedger } from './historyLedger.js';
import { createTurnStore } from './turnStore.js';
import type { HistoryItem } from '../../types.js';

function item(id: number, text = '界'): HistoryItem {
  return { id, type: 'info', text };
}
function bytes(items: readonly HistoryItem[]): number {
  return items.reduce(
    (sum, entry) => sum + Buffer.byteLength(JSON.stringify(entry)),
    0,
  );
}

describe('history eviction metadata', () => {
  it('counts only budget head evictions, excluding retractions, duplicate suppression and body fitting', () => {
    const ledger = createHistoryLedger({ maxItems: 2, maxBytes: 400 });
    ledger.append(item(1));
    ledger.append(item(2));
    ledger.append(item(3));
    expect(ledger.getState().truncatedItems).toBe(1);
    ledger.remove([2]);
    ledger.append({ id: 4, type: 'user', text: 'duplicate' });
    ledger.append({ id: 5, type: 'user', text: 'duplicate' });
    expect(ledger.getState().truncatedItems).toBe(1);
    ledger.remove([3]);
    ledger.update(4, { text: 'x'.repeat(2000) });
    expect(ledger.getState().truncatedItems).toBe(1);
    expect(
      bytes(ledger.getState().entries.map((entry) => entry.item)),
    ).toBeLessThanOrEqual(400);
    ledger.setLimits({ maxItems: 0, maxBytes: 0 });
    expect(ledger.getState().truncatedItems).toBe(2);
    ledger.append(item(6));
    expect(ledger.getState().truncatedItems).toBe(2);
    ledger.load([item(7)]);
    expect(ledger.getState().truncatedItems).toBe(0);
    ledger.clear();
    expect(ledger.getState().truncatedItems).toBe(0);
  });

  it('counts exact and over UTF8 budgets, multi-head evictions on update and limit changes', () => {
    const initial = [item(1), item(2), item(3)];
    const ledger = createHistoryLedger({
      maxItems: 400,
      maxBytes: bytes(initial),
    });
    ledger.load(initial);
    expect(ledger.getState().truncatedItems).toBe(0);
    expect(ledger.getState().totalBytes).toBe(bytes(initial));
    ledger.append(item(4, '界界'));
    expect(ledger.getState().truncatedItems).toBe(2);
    ledger.update(4, { text: '界'.repeat(1000) });
    expect(ledger.getState().truncatedItems).toBe(3);
    ledger.setLimits({ maxItems: 0, maxBytes: 1000 });
    expect(ledger.getState().truncatedItems).toBe(4);
    ledger.load(initial);
    expect(ledger.getState().truncatedItems).toBe(0);
  });

  it('publishes resets for clear/load independently of overlapping IDs and static refresh', () => {
    const { store, commands } = createTurnStore({
      history: [item(1), item(2), item(3)],
    });
    expect(store.getState().historyEpoch).toBe(0);
    commands.setHistoryLimits({ maxItems: 2, maxBytes: 400 });
    expect(store.getState().historyTruncatedItems).toBe(1);
    expect(store.getState().historyEpoch).toBe(0);
    commands.removeItems([2]);
    expect(store.getState().historyTruncatedItems).toBe(1);
    commands.loadHistory([item(3), item(1)]);
    expect(store.getState().historyEpoch).toBe(1);
    expect(store.getState().historyTruncatedItems).toBe(0);
    commands.refreshStatic();
    expect(store.getState().historyEpoch).toBe(1);
    commands.clearItems();
    expect(store.getState().historyEpoch).toBe(2);
    expect(store.getState().historyTruncatedItems).toBe(0);
    expect(store.getState().staticKey).toBe(1);
  });
});
