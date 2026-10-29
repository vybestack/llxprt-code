/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

describe('history response arrival', () => {
  it('publishes one sealed response with ordinary chronology and token accounting', async () => {
    const history = new HistoryService();
    const ordinary = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'attempt',
        submissionId: 'prompt',
      });
      await arrival.append({ type: 'text', text: 'hello ' });
      await arrival.append({ type: 'text', text: 'world' });
      expect(history.length()).toBe(0);
      await arrival.seal({});
      ordinary.add({
        speaker: 'ai',
        blocks: [{ type: 'text', text: 'hello world' }],
      });
      await history.waitForTokenUpdates();
      await ordinary.waitForTokenUpdates();
      expect(history.length()).toBe(ordinary.length());
      expect(history.getTotalTokens()).toBe(ordinary.getTotalTokens());
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows.length).toBe(1);
      expect(rows[0].blocks).toStrictEqual([
        { type: 'text', text: 'hello world' },
      ]);
      expect(rows[0].metadata?.chronology?.seq).toBe(1);
    } finally {
      await history.dispose();
      await ordinary.dispose();
    }
  });
});
