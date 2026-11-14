/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { act } from 'react';
import { StreamingState } from '../../../types.js';
import { withJournalStreamHook } from './journal-stream-hook-fixture.js';
import { gate, scriptProvider } from './journal-provider-test-helpers.js';

describe('journal response cancellation', () => {
  it('keeps the initial text but rejects provider output arriving after cancellation', async () => {
    await withJournalStreamHook([], async ({ agent, state, items }) => {
      const entered = gate();
      const finish = gate();
      const provider = scriptProvider(agent, async function* () {
        yield { speaker: 'ai', blocks: [{ type: 'text', text: 'Initial' }] };
        entered.release();
        await finish.promise;
        yield { speaker: 'ai', blocks: [{ type: 'text', text: ' Canceled' }] };
      });
      let running: Promise<void> = Promise.resolve();
      act(() => {
        running = state().submitQuery('long running query');
      });
      try {
        await entered.promise;
        expect(state().streamingState).toBe(StreamingState.Responding);
        act(() => state().cancelOngoingRequest());
      } finally {
        finish.release();
        await act(async () => {
          await running;
        });
        provider.mockRestore();
      }
      const replies = (await items()).filter((item) => item.type === 'gemini');
      expect(replies.map((item) => item.text)).toContain('Initial');
      expect(replies.map((item) => item.text).join('')).not.toContain(
        'Canceled',
      );
      expect(state().streamingState).toBe(StreamingState.Idle);
      expect(state().pendingHistoryItems).toStrictEqual([]);
    });
  });
});
