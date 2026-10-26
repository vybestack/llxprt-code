/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { HistoryService } from './HistoryService.js';
import type { IContent } from './IContent.js';
import type { SealedHistoryRow } from './sealed-history-row.js';

async function* auxiliary(label: string): AsyncGenerator<IContent> {
  yield {
    speaker: 'ai',
    blocks: [
      {
        type: 'tool_call',
        id: label,
        name: 'lookup',
        parameters: { query: label },
      },
    ],
  };
  yield {
    speaker: 'tool',
    blocks: [
      {
        type: 'tool_response',
        callId: label,
        toolName: 'lookup',
        result: label.toUpperCase(),
      },
    ],
  };
}
describe('AFC journal row staging', () => {
  it('publishes only the newest snapshot with ordinary token and observer effects', async () => {
    const history = new HistoryService();
    const ordinary = new HistoryService();
    const observed: string[] = [];
    history.on('contentSealed', (row: SealedHistoryRow) =>
      observed.push(row.speaker),
    );
    try {
      const arrival = await history.openResponseArrival(
        { id: 'afc', submissionId: 'prompt' },
        { model: 'fixture-model', providerBaseURL: 'https://fixture.invalid' },
      );
      await arrival.replaceAfcHistory(auxiliary('superseded'));
      await arrival.replaceAfcHistory(auxiliary('selected'));
      expect(history.length()).toBe(0);
      await arrival.append({ type: 'text', text: 'done' });
      await arrival.seal({});
      for await (const row of auxiliary('selected')) ordinary.add(row);
      ordinary.add({ speaker: 'ai', blocks: [{ type: 'text', text: 'done' }] });
      await history.waitForTokenUpdates();
      await ordinary.waitForTokenUpdates();
      const rows = await Array.fromAsync(history.streamRawHistory());
      expect(rows.map((row) => row.blocks)).toStrictEqual(
        (await Array.fromAsync(ordinary.streamRawHistory())).map(
          (row) => row.blocks,
        ),
      );
      expect(observed).toStrictEqual(['ai', 'tool', 'ai']);
      expect(history.getTotalTokens()).toBe(ordinary.getTotalTokens());
      expect(rows[0].metadata?.model).toBe('fixture-model');
      expect(rows[0].metadata?.providerBaseURL).toBe('https://fixture.invalid');
      expect(
        new Set(rows.map((row) => row.metadata?.chronology?.seq)).size,
      ).toBe(3);
    } finally {
      await history.dispose();
      await ordinary.dispose();
    }
  });
  it('compensates the whole response publication when an AFC observer fails', async () => {
    const history = new HistoryService();
    const arrival = await history.openResponseArrival({
      id: 'rejected-afc',
      submissionId: 'prompt',
    });
    try {
      await arrival.replaceAfcHistory(auxiliary('rejected'));
      await arrival.append({ type: 'text', text: 'done' });
      history.on('contentSealed', () => {
        throw new Error('rejected auxiliary');
      });
      await expect(arrival.seal({})).rejects.toThrow('rejected auxiliary');
      await arrival.interrupt('error');
      await history.waitForCommit();
      expect(history.length()).toBe(0);
      expect(history.getTotalTokens()).toBe(0);
    } finally {
      await arrival.interrupt('error');
      await history.dispose();
    }
  });
});
