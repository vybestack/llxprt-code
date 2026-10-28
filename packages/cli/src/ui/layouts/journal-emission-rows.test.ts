/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import { describe, expect, it } from 'bun:test';
import { settledTranscriptPrefix } from './journal-emission-rows.js';
import { ToolCallStatus, type HistoryItemWithoutId } from '../types.js';

describe('journal emissions', () => {
  it('does not hide a cancellation notice behind a tool with no result after the turn ends', () => {
    const rows: Array<{ item: HistoryItemWithoutId }> = [
      {
        item: {
          type: 'tool_group',
          tools: [
            {
              callId: 'cancelled-call',
              name: 'lookup',
              description: 'Lookup',
              status: ToolCallStatus.Pending,
              resultDisplay: undefined,
              confirmationDetails: undefined,
            },
          ],
        },
      },
      { item: { type: 'info', text: 'Request cancelled.' } },
    ];
    expect(settledTranscriptPrefix(rows, true)).toStrictEqual([]);
    expect(settledTranscriptPrefix(rows, false)).toStrictEqual([rows[1]]);
  });
});
