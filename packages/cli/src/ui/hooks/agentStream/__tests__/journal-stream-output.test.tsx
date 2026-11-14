/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { StreamingState } from '../../../types.js';
import { withJournalStreamHook } from './journal-stream-hook-fixture.js';

describe('journal-backed stream output', () => {
  it('keeps response text and thinking on disk and starts the next response without old thinking', async () => {
    await withJournalStreamHook(
      [
        [
          {
            speaker: 'ai',
            blocks: [
              {
                type: 'thinking',
                thought: 'First response planning',
                sourceField: 'thought',
              },
              { type: 'text', text: 'First response' },
            ],
          },
        ],
        [
          {
            speaker: 'ai',
            blocks: [{ type: 'text', text: 'Second response' }],
          },
        ],
      ],
      async ({ submit, items, state }) => {
        await submit('first query');
        const first = (await items()).filter((item) => item.type === 'gemini');
        expect(first).toHaveLength(1);
        expect(first[0]?.text).toBe('First response');
        expect(first[0]?.thinkingBlocks).toMatchObject([
          {
            type: 'thinking',
            thought: 'First response planning',
            sourceField: 'thought',
          },
        ]);
        expect(state().pendingHistoryItems).toStrictEqual([]);
        expect(state().streamingState).toBe(StreamingState.Idle);
        await submit('second query');
        const both = (await items()).filter((item) => item.type === 'gemini');
        expect(both.map((item) => item.text)).toStrictEqual([
          'First response',
          'Second response',
        ]);
        expect(both[1]?.thinkingBlocks ?? []).toStrictEqual([]);
        expect(state().pendingHistoryItems).toStrictEqual([]);
        expect(state().streamingState).toBe(StreamingState.Idle);
      },
    );
  });
});
