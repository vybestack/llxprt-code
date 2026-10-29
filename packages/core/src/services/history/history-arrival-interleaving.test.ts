/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';

describe('interleaved thinking arrival', () => {
  it('updates original thinking ordinals across text and other reasoning streams', async () => {
    const history = new HistoryService();
    try {
      const arrival = await history.openResponseArrival({
        id: 'attempt',
        submissionId: 'prompt',
      });
      await arrival.append({
        type: 'thinking',
        streamId: 'a',
        thought: 'First',
      });
      await arrival.append({ type: 'text', text: 'Visible' });
      await arrival.append({
        type: 'thinking',
        streamId: 'b',
        thought: 'Other',
      });
      await arrival.append({
        type: 'thinking',
        streamId: 'a',
        thought: 'First conclusion',
        signature: 'signed-a',
        streamStatus: 'complete',
      });
      await arrival.append({
        type: 'thinking',
        streamId: 'b',
        thought: 'Other conclusion',
        signature: 'signed-b',
      });
      await arrival.seal({});
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows).toHaveLength(1);
      expect(rows[0].blocks).toStrictEqual([
        {
          type: 'thinking',
          streamId: 'a',
          thought: 'First conclusion',
          signature: 'signed-a',
          streamStatus: 'complete',
        },
        { type: 'text', text: 'Visible' },
        {
          type: 'thinking',
          streamId: 'b',
          thought: 'Other conclusion',
          signature: 'signed-b',
        },
      ]);
    } finally {
      await history.dispose();
    }
  });
});
