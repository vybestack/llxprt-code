/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { SealedHistoryRow } from './sealed-history-row.js';

describe('sealed response notifications', () => {
  it('publishes row identity and chronology without a response payload', async () => {
    const history = new HistoryService();
    const receipts: SealedHistoryRow[] = [];
    history.on('contentSealed', (row: SealedHistoryRow) => receipts.push(row));
    try {
      const arrival = await history.openResponseArrival({
        id: 'sealed',
        submissionId: 'prompt',
      });
      await arrival.append({ type: 'text', text: 'answer '.repeat(10000) });
      await arrival.seal({ finishReason: 'stop' });
      expect(receipts).toHaveLength(1);
      expect(receipts[0].label).toBeGreaterThan(0n);
      expect(receipts[0].speaker).toBe('ai');
      expect(receipts[0].metadata?.chronology?.seq).toBe(1);
      expect(receipts[0].metadata?.finishReason).toBe('stop');
      expect('blocks' in receipts[0]).toBe(false);
      expect(history.getContextRange().totalEntries).toBe(1);
    } finally {
      await history.dispose();
    }
  });

  it('rolls back publication when a scalar observer rejects it', async () => {
    const history = new HistoryService();
    history.on('contentSealed', () => {
      throw new Error('receipt rejected');
    });
    try {
      const arrival = await history.openResponseArrival({
        id: 'rejected',
        submissionId: 'prompt',
      });
      await arrival.append({ type: 'text', text: 'discarded' });
      await expect(arrival.seal({})).rejects.toThrow('receipt rejected');
      await history.waitForTokenUpdates();
      expect(history.length()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
    } finally {
      await history.dispose();
    }
  });
});
