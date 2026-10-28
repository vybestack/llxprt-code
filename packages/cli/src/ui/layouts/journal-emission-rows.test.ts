/** Copyright 2026 Vybestack LLC. Licensed under the Apache License, Version 2.0. */
import type { ScrollbackRow } from '../stores/turn/scrollbackPager.js';
import { describe, expect, it } from 'bun:test';
import { settledTranscriptPrefix, unprinted } from './journal-emission-rows.js';
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

describe('transcript print watermark', () => {
  it('prints newer logical rows after compaction lowers their byte offsets', () => {
    const row: ScrollbackRow = {
      key: 'transcript:101:text',
      seq: null,
      offset: 64,
      identity: {
        kind: 'journal',
        offset: 64,
        transcriptId: '101',
        discriminator: 'text',
      },
      item: { id: 1, type: 'user', text: 'after compaction' },
    };
    expect(
      unprinted(row, {
        transcriptId: 100n,
        keys: new Set(['transcript:100:text']),
      }),
    ).toBe(true);
    expect(
      unprinted(row, { transcriptId: 101n, keys: new Set([row.key]) }),
    ).toBe(false);
    expect(
      unprinted(
        {
          ...row,
          offset: 200000,
          identity: {
            ...row.identity,
            kind: 'journal',
            offset: 200000,
            transcriptId: '99',
            discriminator: 'text',
          },
        },
        { transcriptId: 100n, keys: new Set() },
      ),
    ).toBe(false);
  });
});
